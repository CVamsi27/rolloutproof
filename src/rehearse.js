import { performance } from 'node:perf_hooks';

export const PHASES = Object.freeze([
  { id: 'old-old', migrate: false, steps: ['old-read'] },
  { id: 'old-new', migrate: true, steps: ['old-read'] },
  { id: 'new-new', migrate: true, steps: ['new-read'] },
  { id: 'rollback-after-new-write', migrate: true, steps: ['new-read', 'new-write', 'old-read'] },
].map(phase => Object.freeze({ ...phase, steps: Object.freeze(phase.steps) })));
function reason(error) {
  return String(error?.message ?? 'Unknown execution failure').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database URL redacted]').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400);
}
function checkedResult(result) {
  if (!result || !Number.isInteger(result.exitCode) || !Array.isArray(result.assertions) || !result.assertions.length || result.assertions.length > 100) throw new Error('Contract did not return a non-empty bounded assertion observation');
  const seen = new Set();
  const assertions = result.assertions.map(assertion => {
    if (!assertion || typeof assertion.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/.test(assertion.id) || typeof assertion.passed !== 'boolean' || seen.has(assertion.id)) throw new Error('Contract returned malformed or duplicate assertions');
    seen.add(assertion.id);
    return { id: assertion.id, passed: assertion.passed };
  });
  const passed = assertions.every(assertion => assertion.passed);
  if ((passed && result.exitCode !== 0) || (!passed && result.exitCode !== 1)) throw new Error('Contract exit code disagrees with its assertion observations');
  return { exitCode: result.exitCode, assertions, ...(typeof result.imageId === 'string' && /^sha256:[a-f0-9]{64}$/.test(result.imageId) ? { imageId: result.imageId } : {}) };
}
export function exitCode(report) {
  if (report.cleanup === 'failed' || report.execution === 'blocked' || report.execution === 'setup_failed') return 2;
  if (report.assertions === 'failed') return 1;
  if (report.execution !== 'completed' || report.coverage !== 'complete_for_declared_contracts' || report.assertions !== 'passed' || report.cleanup !== 'completed') return 3;
  return 0;
}
export async function rehearse(loaded, backend) {
  const started = performance.now();
  const phases = [];
  for (const definition of PHASES) {
    const phaseStarted = performance.now();
    const phase = { id: definition.id, execution: 'completed', coverage: 'complete_for_declared_contracts', assertions: 'not_evaluated', cleanup: 'completed', setupOperations: [], operations: [], missing: [] };
    let cell;
    let setup = true;
    try {
      cell = backend.allocate({ phase: definition.id, scenario: loaded.scenario });
      await backend.start(cell);
      for (const kind of ['schema', 'seed', ...(definition.migrate ? ['migration'] : [])]) {
        await backend.sql(cell, kind, loaded.sql[kind]);
        phase.setupOperations.push({ id: kind, execution: 'completed' });
      }
      setup = false;
      for (const operation of definition.steps) {
        const key = operation === 'old-read' ? 'oldRead' : operation === 'new-read' ? 'newRead' : 'newWrite';
        const image = operation === 'old-read' ? loaded.scenario.images.old : loaded.scenario.images.new;
        const result = checkedResult(await backend.contract(cell, image, loaded.scenario.commands[key], operation));
        phase.operations.push({ id: operation, ...result });
        if (result.exitCode !== 0) { phase.assertions = 'failed'; break; }
      }
      if (phase.operations.length !== definition.steps.length) {
        phase.coverage = 'partial';
        phase.missing.push('Required operations after the failing contract were not executed');
        if (phase.assertions !== 'failed') throw new Error('Required contract operation was not executed');
      }
      if (phase.assertions !== 'failed') phase.assertions = 'passed';
    } catch (error) {
      phase.execution = error?.code === 'TIMEOUT' ? 'timed_out' : setup ? 'setup_failed' : 'interrupted';
      phase.coverage = 'partial';
      phase.missing.push(reason(error));
    } finally {
      if (cell) {
        try { await backend.destroy(cell); }
        catch (error) { phase.cleanup = 'failed'; phase.missing.push(`Cleanup: ${reason(error)}`); }
      }
    }
    phase.durationMs = Math.round(performance.now() - phaseStarted);
    phases.push(phase);
  }
  const rank = { completed: 0, interrupted: 1, timed_out: 2, setup_failed: 3, blocked: 4 };
  const execution = phases.reduce((worst, phase) => rank[phase.execution] > rank[worst] ? phase.execution : worst, 'completed');
  return { schemaVersion: 1, scenarioId: loaded.scenario.id, policy: 'migration-first-with-new-data-rollback', evidenceKind: 'simulated', execution, coverage: phases.every(p => p.coverage === 'complete_for_declared_contracts') ? 'complete_for_declared_contracts' : 'partial', assertions: phases.some(p => p.assertions === 'failed') ? 'failed' : phases.every(p => p.assertions === 'passed') ? 'passed' : 'not_evaluated', cleanup: phases.some(p => p.cleanup === 'failed') ? 'failed' : 'completed', fixtureDigests: loaded.digests, phases, durationMs: Math.round(performance.now() - started), limitation: 'Only the supplied images, SQL fixtures, commands and declared assertions were exercised. No production or universal migration-safety claim.' };
}
