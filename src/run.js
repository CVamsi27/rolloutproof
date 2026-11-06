import { loadScenario } from './scenario.js';
import { PHASES, rehearse } from './rehearse.js';
import { createDockerBackend } from './docker.js';

const MISSING_IMAGES = 'Required local images unavailable or could not be resolved to immutable IDs; build the fixture image and pull the declared PostgreSQL image first';

export async function doctor(path) {
  const loaded = path === undefined ? undefined : await loadScenario(path);
  const backend = createDockerBackend();
  const prerequisites = await backend.doctor();
  if (!loaded || !prerequisites.available) return prerequisites;
  const scenarioId = loaded.scenario.id;
  try {
    return { ...prerequisites, scenarioId, images: await backend.prepare(loaded.scenario) };
  } catch {
    return { ...prerequisites, scenarioId, available: false, reason: MISSING_IMAGES };
  }
}

export async function runScenario(path, { backend } = {}) {
  const loaded = await loadScenario(path);
  const observed = backend === undefined;
  if (observed) backend = createDockerBackend();
  const prerequisites = await backend.doctor();
  let resolved;
  if (prerequisites.available) {
    try { resolved = await backend.prepare(loaded.scenario); }
    catch { prerequisites.available = false; prerequisites.reason = MISSING_IMAGES; }
  }
  if (!prerequisites.available) return { schemaVersion: 1, scenarioId: loaded.scenario.id, policy: 'migration-first-with-new-data-rollback', evidenceKind: 'not_observed', execution: 'blocked', coverage: 'partial', assertions: 'not_evaluated', cleanup: 'completed', fixtureDigests: loaded.digests, missing: [prerequisites.reason], phases: PHASES.map(phase => ({ id: phase.id, execution: 'blocked', coverage: 'partial', assertions: 'not_evaluated', cleanup: 'completed', setupOperations: [], operations: [], missing: [prerequisites.reason], durationMs: 0 })), durationMs: 0 };
  const report = await rehearse({ ...loaded, scenario: { ...loaded.scenario, ...resolved } }, backend);
  return { ...report, evidenceKind: observed ? 'observed' : 'simulated', images: resolved, prerequisites };
}
