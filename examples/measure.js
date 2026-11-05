import { measureProofs } from './proof-suite.js';
try {
  const result = await measureProofs();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.exitCode;
} catch {
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, gate: 'failed', reason: 'Proof execution failed before complete measurements were collected', measurements: [], adoption: 'not_validated' })}\n`);
  process.exitCode = 2;
}
