import { loadScenario } from './scenario.js';
import { PHASES, rehearse } from './rehearse.js';
import { createDockerBackend } from './docker.js';

export async function doctor() { return createDockerBackend().doctor(); }
export async function runScenario(path, { backend = createDockerBackend() } = {}) {
  const loaded = await loadScenario(path);
  const prerequisites = await backend.doctor();
  let resolved;
  if (prerequisites.available) {
    try { resolved = await backend.prepare(loaded.scenario); }
    catch { prerequisites.available = false; prerequisites.reason = 'Required local images unavailable or could not be resolved to immutable IDs; build the fixture image and pull the declared PostgreSQL image first'; }
  }
  if (!prerequisites.available) return { schemaVersion: 1, scenarioId: loaded.scenario.id, policy: 'migration-first-with-new-data-rollback', evidenceKind: 'not_observed', execution: 'blocked', coverage: 'partial', assertions: 'not_evaluated', cleanup: 'completed', fixtureDigests: loaded.digests, missing: [prerequisites.reason], phases: PHASES.map(phase => ({ id: phase.id, execution: 'blocked', coverage: 'partial', assertions: 'not_evaluated', cleanup: 'completed', setupOperations: [], operations: [], missing: [prerequisites.reason], durationMs: 0 })), durationMs: 0 };
  return { ...await rehearse({ ...loaded, scenario: { ...loaded.scenario, ...resolved } }, backend), images: resolved, prerequisites };
}
