import { fileURLToPath } from 'node:url';
import { doctor, runScenario, exitCode } from '../src/index.js';

export async function measureProofs() {
  const prerequisites = await doctor();
  if (!prerequisites.available) return { schemaVersion: 1, gate: 'blocked', prerequisites, measurements: [], comparison: { ordinaryMigration: 'not_run', rolloutContracts: 'not_run' }, adoption: 'not_validated', exitCode: 2 };
  const cases = [['rename.json', 1], ['expand-contract.json', 0], ['new-data-rollback.json', 1], ['new-data-compatible.json', 0]];
  const measurements = [];
  for (const [fixture, expectedExit] of cases) {
    const report = await runScenario(fileURLToPath(new URL(`./${fixture}`, import.meta.url)));
    const oldNew = report.phases.find(phase => phase.id === 'old-new');
    const observedExit = exitCode(report);
    measurements.push({ fixture, expectedExit, observedExit, durationMs: report.durationMs, execution: report.execution, coverage: report.coverage, cleanup: report.cleanup, ordinaryMigration: oldNew.setupOperations.some(operation => operation.id === 'migration' && operation.execution === 'completed') ? 'completed' : 'not_completed', phases: report.phases });
    if (report.execution === 'blocked') return { schemaVersion: 1, gate: 'blocked', prerequisites, measurements, comparison: { ordinaryMigration: 'incomplete', rolloutContracts: 'incomplete' }, adoption: 'not_validated', exitCode: 2 };
  }
  const expected = measurements.every(measurement => measurement.observedExit === measurement.expectedExit && measurement.execution === 'completed' && measurement.coverage === 'complete_for_declared_contracts' && measurement.cleanup === 'completed' && measurement.ordinaryMigration === 'completed');
  const rollback = measurements.find(measurement => measurement.fixture === 'new-data-rollback.json');
  const rollbackShape = rollback.phases.slice(0, 3).every(phase => phase.assertions === 'passed') && rollback.phases[3].assertions === 'failed';
  return { schemaVersion: 1, gate: expected && rollbackShape ? 'passed' : 'failed', prerequisites, measurements, comparison: { ordinaryMigration: 'See each measured migration exit independently of application contracts; all four migrations must apply successfully.', rolloutContracts: 'Breaking rename must fail old/new; new-data rollback must pass the first three phases and fail only the old reader after the new write.' }, adoption: 'not_validated', exitCode: expected && rollbackShape ? 0 : 1 };
}
