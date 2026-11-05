import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const OWNER = 'io.rolloutproof.owner';
const RUN = 'io.rolloutproof.run';
const MAX_OUTPUT = 65536;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function runDocker(args, { input = '', timeoutMs = 10000, executable } = {}) {
  return new Promise((resolve, reject) => {
    const client = executable ?? process.env.CONTAINER_CLI ?? 'docker';
    const env = { ...process.env };
    if (process.env.CONTAINER_HOST !== undefined) {
      env.DOCKER_HOST = process.env.CONTAINER_HOST;
      delete env.DOCKER_CONTEXT;
    }
    const child = spawn(client, args, { env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    let stdout = '', stderr = '', failure;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => { failure = Object.assign(new Error('Docker operation exceeded its deadline'), { code: 'TIMEOUT' }); kill(); }, timeoutMs);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.on('data', chunk => {
      if (key === 'stdout') stdout += chunk; else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT) { failure = new Error('Docker output exceeded 64 KiB'); kill(); }
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Docker executable could not be started')); });
    child.once('close', code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ code: code ?? -1, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
function required(result, operation) {
  if (result.code !== 0) throw new Error(`Docker ${operation} failed (exit ${result.code}); verify the daemon and required prebuilt images`);
  return result.stdout.trim();
}
function labels(runId) { return ['--label', `${OWNER}=rolloutproof`, '--label', `${RUN}=${runId}`]; }
export function createDockerBackend({ docker = runDocker } = {}) {
  const must = async (args, options) => required(await docker(args, options), args.slice(0, 2).join(' '));
  async function identity(image) {
    const id = await must(['image', 'inspect', '--format', '{{.Id}}', image]);
    if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error('Image did not resolve to an immutable local image ID');
    return id;
  }
  async function owned(cell, resource) {
    const args = resource.kind === 'network' ? ['network', 'inspect', resource.name] : ['inspect', resource.name];
    const result = await docker(args, { timeoutMs: 5000 });
    if (result.code !== 0) {
      if (/No such (?:object|container|network)/i.test(result.stderr)) return false;
      throw new Error('Could not verify Docker resource ownership');
    }
    let record;
    try { record = JSON.parse(result.stdout)[0]; } catch { throw new Error('Malformed Docker ownership observation'); }
    const metadata = record?.Config?.Labels ?? record?.Labels;
    if (metadata?.[OWNER] !== 'rolloutproof' || metadata?.[RUN] !== cell.runId) throw new Error('Docker resource ownership mismatch; foreign resource was not removed');
    return true;
  }
  async function remove(cell, resource) {
    if (await owned(cell, resource)) await must(resource.kind === 'network' ? ['network', 'rm', resource.name] : ['rm', '--force', resource.name]);
  }
  return {
    kind: 'docker',
    async prepare(scenario) {
      return { postgresImage: await identity(scenario.postgresImage), images: { old: await identity(scenario.images.old), new: await identity(scenario.images.new) } };
    },
    async doctor() {
      try {
        const version = JSON.parse(await must(['info', '--format', '{{json .ServerVersion}}'], { timeoutMs: 8000 }));
        if (typeof version !== 'string' || version.length > 100 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z][0-9A-Za-z.+-]*)?$/.test(version)) throw new Error('Docker returned no valid formatted server version');
        return { available: true, version };
      } catch { return { available: false, reason: 'Docker daemon unavailable, returned invalid server-version evidence, or did not answer within 8 seconds' }; }
    },
    allocate({ phase, scenario }) {
      const runId = `rp-${randomBytes(8).toString('hex')}`;
      return { runId, phase, scenario, network: `${runId}-net`, postgres: `${runId}-pg`, password: randomBytes(24).toString('hex'), appPassword: randomBytes(24).toString('hex'), resources: [], worker: 0 };
    },
    async start(cell) {
      const pgImage = await identity(cell.scenario.postgresImage);
      cell.resources.push({ kind: 'network', name: cell.network });
      await must(['network', 'create', '--internal', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', ...labels(cell.runId), cell.network]);
      cell.resources.push({ kind: 'container', name: cell.postgres });
      await must(['run', '--detach', '--name', cell.postgres, ...labels(cell.runId), '--network', cell.network, '--network-alias', 'postgres', '--user', '999:999', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,uid=999,gid=999,mode=0700,size=256m', '--tmpfs', '/var/run/postgresql:rw,nosuid,nodev,uid=999,gid=999,mode=0775,size=16m', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--env', 'PGDATA=/var/lib/postgresql/data/pgdata', '--env', 'POSTGRES_DB=rolloutproof', '--env', `POSTGRES_PASSWORD=${cell.password}`, pgImage]);
      const deadline = Date.now() + 30000;
      for (;;) {
        // The entrypoint's temporary initialization server listens only on its Unix socket.
        // TCP readiness waits for that server to finish creating POSTGRES_DB and exit.
        const ready = await docker(['exec', cell.postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'rolloutproof'], { timeoutMs: 3000 });
        if (ready.code === 0) break;
        if (Date.now() >= deadline) throw Object.assign(new Error('Disposable PostgreSQL did not become ready'), { code: 'TIMEOUT' });
        await delay(200);
      }
      await this.sql(cell, 'role', `CREATE ROLE rolloutproof_app LOGIN PASSWORD '${cell.appPassword}';`);
    },
    async sql(cell, kind, text) {
      // SQL is already bounded and read from contained synthetic fixtures; it is passed on stdin, never interpolated into a shell.
      await must(['exec', '-i', cell.postgres, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'rolloutproof'], { input: text, timeoutMs: cell.scenario.timeoutMs });
      if (kind === 'seed' || kind === 'migration') {
        await must(['exec', '-i', cell.postgres, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'rolloutproof'], { input: 'GRANT USAGE ON SCHEMA public TO rolloutproof_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO rolloutproof_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO rolloutproof_app;', timeoutMs: cell.scenario.timeoutMs });
      }
    },
    async contract(cell, image, command, operation) {
      const resolved = await identity(image);
      const name = `${cell.runId}-worker-${++cell.worker}`;
      const resource = { kind: 'container', name };
      cell.resources.push(resource);
      try {
        await must(['run', '--detach', '--name', name, ...labels(cell.runId), '--init', '--network', cell.network, '--user', '10001:10001', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--cpus', '0.5', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--workdir', '/app', '--env', `DATABASE_URL=postgresql://rolloutproof_app:${cell.appPassword}@postgres:5432/rolloutproof`, '--env', 'NODE_ENV=test', '--entrypoint', command[0], resolved, ...command.slice(1)]);
        const waited = await must(['wait', name], { timeoutMs: cell.scenario.timeoutMs });
        if (!/^\d+$/.test(waited)) throw new Error('Worker did not produce a valid exit observation');
        const inspection = JSON.parse(await must(['inspect', name]));
        const state = inspection?.[0]?.State;
        if (!state || state.Running !== false || state.OOMKilled !== false || state.ExitCode !== Number(waited)) throw new Error('Worker state was missing, inconsistent, or OOM killed');
        const output = await must(['logs', '--tail', '100', name]);
        let record;
        try { record = JSON.parse(output); } catch { throw new Error(`${operation} returned no valid JSON assertion observation`); }
        if (record?.schemaVersion !== 1) throw new Error(`${operation} assertion observation has an unsupported schema`);
        return { exitCode: state.ExitCode, assertions: record.assertions, imageId: resolved };
      } finally { await remove(cell, resource); }
    },
    async destroy(cell) {
      const failures = [];
      for (const resource of [...cell.resources].reverse()) {
        try { await remove(cell, resource); }
        catch (error) { failures.push(error.message); }
      }
      if (failures.length) throw new Error(failures.join('; '));
    },
  };
}
