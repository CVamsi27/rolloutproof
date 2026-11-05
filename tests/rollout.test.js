import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadScenario, rehearse, runScenario, exitCode } from '../src/index.js';

function scenario() {
  return { schemaVersion: 1, id: 'synthetic', fixtures: { schema: 'schema.sql', seed: 'seed.sql', migration: 'migration.sql' }, images: { old: 'fixture:old', new: 'fixture:new' }, commands: { oldRead: ['node', '/app/contract.js', 'old-read'], newRead: ['node', '/app/contract.js', 'new-read'], newWrite: ['node', '/app/contract.js', 'new-write'] } };
}

async function withFiles(run) {
  const root = await mkdtemp(join(tmpdir(), 'rolloutproof-test-'));
  try {
    await Promise.all(['schema.sql', 'seed.sql', 'migration.sql'].map(file => writeFile(join(root, file), '-- synthetic\n')));
    await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario()));
    return await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

// This backend models the orchestrator boundary only. It is deliberately not evidence of SQL or Docker behavior.
function backend(options = {}) {
  const events = [];
  let next = 0;
  return {
    events,
    allocate() { return { id: ++next, data: 'old' }; },
    async start(cell) { events.push([cell.id, 'start']); if (options.startFails) throw new Error('start failed'); },
    async sql(cell, kind) { events.push([cell.id, kind]); },
    async contract(cell, _image, _command, operation) {
      events.push([cell.id, operation, cell.data]);
      if (operation === 'new-write') cell.data = 'new';
      if (options.collectorFails) return undefined;
      const passed = !(options.rejectNewData && operation === 'old-read' && cell.data === 'new');
      return { exitCode: passed ? 0 : 1, assertions: [{ id: 'reads-known-data', passed }] };
    },
    async destroy(cell) { events.push([cell.id, 'destroy']); if (options.cleanupFails) throw new Error('cleanup failed'); },
  };
}

test('loads bounded synthetic SQL and rejects commands supplied as shell strings', async () => {
  await withFiles(async root => {
    const loaded = await loadScenario(join(root, 'scenario.json'));
    assert.equal(loaded.scenario.postgresImage, 'postgres:17-bookworm');
    assert.equal(loaded.sql.seed, '-- synthetic\n');
    const invalid = scenario(); invalid.commands.oldRead = 'node contract.js';
    await writeFile(join(root, 'bad.json'), JSON.stringify(invalid));
    await assert.rejects(loadScenario(join(root, 'bad.json')), /array/);
  });
});

test('refuses fixture traversal, escaped symlinks and unknown configuration keys', async () => {
  await withFiles(async root => {
    for (const change of [value => { value.fixtures.seed = '../seed.sql'; }, value => { value.env = { DATABASE_URL: 'not-allowed' }; }]) {
      const invalid = scenario(); change(invalid);
      await writeFile(join(root, 'bad.json'), JSON.stringify(invalid));
      await assert.rejects(loadScenario(join(root, 'bad.json')));
    }
    await symlink('/etc/hosts', join(root, 'escape.sql'));
    const invalid = scenario(); invalid.fixtures.seed = 'escape.sql';
    await writeFile(join(root, 'bad.json'), JSON.stringify(invalid));
    await assert.rejects(loadScenario(join(root, 'bad.json')), /outside/);
  });
});

test('keeps new writes in the rollback cell while other combinations get independent cells', async () => {
  await withFiles(async root => {
    const executor = backend();
    const report = await rehearse(await loadScenario(join(root, 'scenario.json')), executor);
    assert.equal(exitCode(report), 0);
    assert.deepEqual(report.phases.map(p => p.id), ['old-old', 'old-new', 'new-new', 'rollback-after-new-write']);
    assert.deepEqual(executor.events.filter(e => e[1] === 'old-read'), [[1, 'old-read', 'old'], [2, 'old-read', 'old'], [4, 'old-read', 'new']]);
    assert.equal(executor.events.filter(e => e[1] === 'destroy').length, 4);
  });
});

test('a successful migration cannot hide a rollback reader rejecting new-version data', async () => {
  await withFiles(async root => {
    const report = await rehearse(await loadScenario(join(root, 'scenario.json')), backend({ rejectNewData: true }));
    assert.equal(report.assertions, 'failed');
    assert.equal(exitCode(report), 1);
    assert.deepEqual(report.phases.map(p => p.assertions), ['passed', 'passed', 'passed', 'failed']);
    assert.equal(report.phases[3].operations.at(-1).id, 'old-read');
  });
});

test('missing observations and failed cleanup never become a complete passing result', async () => {
  await withFiles(async root => {
    const loaded = await loadScenario(join(root, 'scenario.json'));
    const missing = await rehearse(loaded, backend({ collectorFails: true }));
    assert.equal(missing.coverage, 'partial');
    assert.equal(missing.assertions, 'not_evaluated');
    assert.notEqual(exitCode(missing), 0);
    const cleanup = await rehearse(loaded, backend({ cleanupFails: true }));
    assert.equal(cleanup.cleanup, 'failed');
    assert.equal(exitCode(cleanup), 2);
  });
});

test('partial setup still attempts scoped cleanup and leaves every required phase unpassed', async () => {
  await withFiles(async root => {
    const executor = backend({ startFails: true });
    const report = await rehearse(await loadScenario(join(root, 'scenario.json')), executor);
    assert.equal(report.execution, 'setup_failed');
    assert.equal(report.assertions, 'not_evaluated');
    assert.equal(executor.events.filter(e => e[1] === 'destroy').length, 4);
    assert.equal(exitCode(report), 2);
  });
});

test('empty assertion lists or exit/assertion disagreement are incomplete evidence', async () => {
  await withFiles(async root => {
    for (const result of [{ exitCode: 0, assertions: [] }, { exitCode: 0, assertions: [{ id: 'bad', passed: false }] }, { exitCode: 1, assertions: [{ id: 'bad', passed: true }] }]) {
      const executor = backend(); executor.contract = async () => result;
      const report = await rehearse(await loadScenario(join(root, 'scenario.json')), executor);
      assert.equal(report.coverage, 'partial');
      assert.notEqual(exitCode(report), 0);
    }
  });
});

test('a failing new writer keeps its finding but does not claim the skipped old-reader observation', async () => {
  await withFiles(async root => {
    const executor = backend();
    executor.contract = async (_cell, _image, _command, operation) => ({ exitCode: operation === 'new-write' ? 1 : 0, assertions: [{ id: 'write-supported', passed: operation !== 'new-write' }] });
    const report = await rehearse(await loadScenario(join(root, 'scenario.json')), executor);
    assert.equal(report.evidenceKind, 'simulated');
    assert.equal(report.assertions, 'failed');
    assert.equal(report.coverage, 'partial');
    assert.deepEqual(report.phases[3].operations.map(operation => operation.id), ['new-read', 'new-write']);
    assert.equal(exitCode(report), 1);
  });
});

test('blocked prerequisites leave all contracts unobserved without allocating resources', async () => {
  await withFiles(async root => {
    let allocations = 0;
    const report = await runScenario(join(root, 'scenario.json'), { backend: { doctor: async () => ({ available: false, reason: 'synthetic unavailable daemon' }), allocate() { allocations++; } } });
    assert.equal(report.execution, 'blocked');
    assert.equal(report.evidenceKind, 'not_observed');
    assert.equal(report.phases.every(phase => phase.operations.length === 0 && phase.assertions === 'not_evaluated'), true);
    assert.equal(allocations, 0);
    assert.equal(exitCode(report), 2);
  });
});

test('missing prebuilt images block before any cell is created', async () => {
  await withFiles(async root => {
    let allocations = 0;
    const report = await runScenario(join(root, 'scenario.json'), { backend: { doctor: async () => ({ available: true }), prepare: async () => { throw new Error('missing image'); }, allocate() { allocations++; } } });
    assert.equal(report.execution, 'blocked');
    assert.equal(allocations, 0);
    assert.equal(exitCode(report), 2);
  });
});

test('image references are frozen before phases so retagging cannot change later contracts', async () => {
  await withFiles(async root => {
    const executor = backend();
    executor.doctor = async () => ({ available: true });
    executor.prepare = async () => ({ postgresImage: `sha256:${'a'.repeat(64)}`, images: { old: `sha256:${'b'.repeat(64)}`, new: `sha256:${'c'.repeat(64)}` } });
    const original = executor.contract;
    const images = [];
    executor.contract = async (cell, image, command, operation) => { images.push(image); return original(cell, image, command, operation); };
    const report = await runScenario(join(root, 'scenario.json'), { backend: executor });
    assert.equal(exitCode(report), 0);
    assert.deepEqual([...new Set(images)], [`sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`]);
  });
});
