import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('installed command help exits successfully without contacting Docker', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /rolloutproof run --scenario/);
});
test('invalid scenario and unsupported flags fail setup with parseable JSON', () => {
  for (const args of [['run', '--scenario', '/nonexistent/synthetic.json', '--json'], ['run', '--unexpected', '--json']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).execution, 'setup_failed');
  }
});
