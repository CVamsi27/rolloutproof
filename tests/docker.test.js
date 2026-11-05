import test from 'node:test';
import assert from 'node:assert/strict';
import { createDockerBackend, runDocker } from '../src/docker.js';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the selected OrbStack client receives its endpoint without changing the parent context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rolloutproof-client-'));
  const original = Object.fromEntries(['PATH', 'CONTAINER_CLI', 'CONTAINER_HOST', 'DOCKER_CONTEXT', 'DOCKER_HOST'].map(key => [key, process.env[key]]));
  try {
    for (const [name, marker] of [['docker', 'default'], ['orb-client', 'selected']]) {
      const path = join(root, name);
      await writeFile(path, `#!${process.execPath}\nconsole.log(JSON.stringify({marker:${JSON.stringify(marker)},host:process.env.DOCKER_HOST??null,context:process.env.DOCKER_CONTEXT??null}));\n`);
      await chmod(path, 0o755);
    }
    process.env.PATH = `${root}:${original.PATH}`;
    process.env.CONTAINER_CLI = join(root, 'orb-client');
    process.env.CONTAINER_HOST = 'unix:///synthetic/orbstack.sock';
    process.env.DOCKER_CONTEXT = 'unrelated-context';
    process.env.DOCKER_HOST = 'unix:///synthetic/other.sock';
    const selected = await runDocker(['info'], { timeoutMs: 1000 });
    assert.equal(selected.code, 0);
    assert.deepEqual(JSON.parse(selected.stdout), { marker: 'selected', host: 'unix:///synthetic/orbstack.sock', context: null });
    assert.equal(process.env.DOCKER_CONTEXT, 'unrelated-context');
    assert.equal(process.env.DOCKER_HOST, 'unix:///synthetic/other.sock');
    const explicit = await runDocker(['info'], { executable: join(root, 'docker'), timeoutMs: 1000 });
    assert.equal(JSON.parse(explicit.stdout).marker, 'default');
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root, { recursive: true, force: true });
  }
});

test('the normal client keeps existing Docker context when no endpoint override is requested', async () => {
  const original = Object.fromEntries(['CONTAINER_CLI', 'CONTAINER_HOST', 'DOCKER_CONTEXT'].map(key => [key, process.env[key]]));
  try {
    delete process.env.CONTAINER_CLI;
    delete process.env.CONTAINER_HOST;
    process.env.DOCKER_CONTEXT = 'existing-context';
    const result = await runDocker(['-e', 'console.log(process.env.DOCKER_CONTEXT)'], { executable: process.execPath });
    assert.equal(result.stdout.trim(), 'existing-context');
  } finally { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('doctor rejects successful OrbStack wrapper chatter as unavailable daemon evidence', async () => {
  const backend = createDockerBackend({ docker: async () => ({ code: 0, stdout: 'App is already running\n', stderr: '' }) });
  const result = await backend.doctor();
  assert.equal(result.available, false);
  assert.equal(result.version, undefined);
});

test('doctor accepts only a formatted JSON Docker server version', async () => {
  const valid = createDockerBackend({ docker: async () => ({ code: 0, stdout: '"29.8.2"\n', stderr: '' }) });
  assert.deepEqual(await valid.doctor(), { available: true, version: '29.8.2' });
  for (const stdout of ['App is already running', '"App is already running"', '29.8.2', '"29.8"', '{}', 'null', '""']) {
    const invalid = createDockerBackend({ docker: async () => ({ code: 0, stdout, stderr: '' }) });
    assert.equal((await invalid.doctor()).available, false);
  }
});

test('Docker command deadline terminates a hung owned subprocess', async () => {
  const started = Date.now();
  await assert.rejects(runDocker(['-e', 'setInterval(()=>{},1000)'], { executable: process.execPath, timeoutMs: 50 }), error => error.code === 'TIMEOUT');
  assert.ok(Date.now() - started < 3000);
});

test('application launch uses only the internal network and synthetic configuration, with no host mounts', async () => {
  const calls = [];
  const driver = async (args, options = {}) => {
    calls.push({ args, input: options.input });
    if (args[0] === 'image') return { code: 0, stdout: `sha256:${'a'.repeat(64)}\n`, stderr: '' };
    if (args[0] === 'wait') return { code: 0, stdout: '0\n', stderr: '' };
    if (args[0] === 'logs') return { code: 0, stdout: JSON.stringify({ schemaVersion: 1, assertions: [{ id: 'read', passed: true }] }), stderr: '' };
    if (args[0] === 'inspect') return { code: 0, stdout: JSON.stringify([{ State: { ExitCode: 0, Running: false, OOMKilled: false }, Config: { Labels: { 'io.rolloutproof.owner': 'rolloutproof', 'io.rolloutproof.run': active.runId } } }]), stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const backend = createDockerBackend({ docker: driver });
  const active = backend.allocate({ phase: 'old-old', scenario: { postgresImage: 'postgres:17-alpine', timeoutMs: 500 } });
  await backend.start(active);
  const result = await backend.contract(active, 'synthetic:old', ['node', '/app/contract.js'], 'old-read');
  assert.equal(result.assertions[0].passed, true);
  const launch = calls.find(call => call.args[0] === 'run' && call.args.includes('--read-only') && call.args.includes('10001:10001')).args;
  assert.equal(launch[launch.indexOf('--network') + 1], active.network);
  assert.ok(launch.includes('--init'));
  assert.ok(launch.includes('ALL'));
  for (const bad of ['--mount', '-v', '--volume', '--privileged', '--publish', '-p', '--add-host']) assert.equal(launch.includes(bad), false);
  assert.equal(launch.includes(process.env.HOME), false);
  assert.equal(launch[launch.indexOf('--entrypoint') + 1], 'node');
  assert.ok(calls.some(call => call.args[0] === 'network' && call.args[1] === 'create' && call.args.includes('--internal')));
  assert.ok(calls.some(call => call.args[0] === 'network' && call.args[1] === 'create' && call.args.includes('com.docker.network.bridge.gateway_mode_ipv4=isolated')),
    'an internal bridge must not expose its host gateway');
  const readiness = calls.find(call => call.args[0] === 'exec' && call.args.includes('pg_isready')).args;
  assert.equal(readiness[readiness.indexOf('-h') + 1], '127.0.0.1', 'readiness must wait for the final TCP server, not the temporary initialization socket');
});

test('cleanup refuses foreign resources while attempting removal of other owned resources', async () => {
  const removed = [];
  const driver = async args => {
    if (args[0] === 'inspect') return { code: 0, stdout: JSON.stringify([{ Config: { Labels: { 'io.rolloutproof.owner': 'someone-else' } } }]), stderr: '' };
    if (args[0] === 'network' && args[1] === 'inspect') return { code: 0, stdout: JSON.stringify([{ Labels: { 'io.rolloutproof.owner': 'rolloutproof', 'io.rolloutproof.run': active.runId } }]), stderr: '' };
    removed.push(args); return { code: 0, stdout: '', stderr: '' };
  };
  const backend = createDockerBackend({ docker: driver });
  const active = backend.allocate({ phase: 'old-old', scenario: { timeoutMs: 100 } });
  active.resources.push({ kind: 'network', name: active.network }, { kind: 'container', name: 'foreign' });
  await assert.rejects(backend.destroy(active), /ownership/);
  assert.equal(removed.some(args => args.includes('foreign')), false);
  assert.ok(removed.some(args => args[0] === 'network' && args[1] === 'rm'));
});
