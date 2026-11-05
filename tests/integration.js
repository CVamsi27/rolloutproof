import { measureProofs } from '../examples/proof-suite.js';
import { verifyIsolation } from './isolation.integration.js';
try {
  const result = await measureProofs();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.exitCode;
  if (result.exitCode === 0) process.stdout.write(`${JSON.stringify(await verifyIsolation())}\n`);
} catch {
  process.stderr.write('Rolloutproof integration failed before complete evidence was collected.\n');
  process.exitCode = 2;
}
