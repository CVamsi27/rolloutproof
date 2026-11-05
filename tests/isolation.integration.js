import assert from 'node:assert/strict';
import { createDockerBackend } from '../src/docker.js';

/** Exercise the declared boundary using only a trusted synthetic probe inside the worker. */
export async function verifyIsolation() {
  const backend = createDockerBackend();
  const prepared = await backend.prepare({ postgresImage: 'postgres:17-bookworm', images: { old: 'rolloutproof-fixture:local', new: 'rolloutproof-fixture:local' } });
  const cell = backend.allocate({ phase: 'isolation-probe', scenario: { postgresImage: prepared.postgresImage, timeoutMs: 15000 } });
  try {
    await backend.start(cell);
    const program = `
      const fs=require('node:fs');
      const routes=fs.readFileSync('/proc/net/route','utf8').trim().split('\\n').slice(1).map(line=>line.trim().split(/\\s+/));
      let rootWriteBlocked=false;
      try{fs.writeFileSync('/app/synthetic-write-probe','synthetic');}catch{rootWriteBlocked=true;}
      const assertions=[
        {id:'non-root-worker',passed:process.getuid()===10001},
        {id:'no-default-route',passed:!routes.some(row=>row[1]==='00000000')},
        {id:'no-engine-socket',passed:!fs.existsSync('/var/run/docker.sock')&&!fs.existsSync('/run/docker.sock')},
        {id:'no-supervisor-settings',passed:process.env.CONTAINER_HOST===undefined&&process.env.CONTAINER_CLI===undefined&&process.env.DOCKER_HOST===undefined},
        {id:'read-only-root',passed:rootWriteBlocked}
      ];
      console.log(JSON.stringify({schemaVersion:1,assertions}));
      process.exitCode=assertions.every(item=>item.passed)?0:1;
    `;
    const observed = await backend.contract(cell, prepared.images.new, ['node', '-e', program], 'synthetic-isolation');
    assert.equal(observed.exitCode, 0);
    assert.equal(observed.assertions.length, 5);
    assert.ok(observed.assertions.every(item => item.passed));
    return { gate: 'real-worker-isolation', assertions: observed.assertions, cleanup: 'completed' };
  } finally { await backend.destroy(cell); }
}
