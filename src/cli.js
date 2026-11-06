#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runScenario, doctor } from './run.js';
import { exitCode } from './rehearse.js';

const HELP = `rolloutproof run --scenario <synthetic.json> [--json]
rolloutproof doctor [--scenario <synthetic.json>] [--json]

Runs prebuilt application images only in disposable Docker cells.
Exit: 0 declared contracts passed; 1 contract violation; 2 blocked/setup/cleanup failure; 3 incomplete.
`;
try {
  const { values, positionals } = parseArgs({ options: { scenario: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true });
  if (values.help) { process.stdout.write(HELP); }
  else if (positionals.length === 1 && positionals[0] === 'doctor') {
    const result = await doctor(values.scenario);
    const scope = result.scenarioId ? `; local images resolved for ${result.scenarioId}` : '';
    process.stdout.write(values.json ? `${JSON.stringify(result)}\n` : result.available ? `Engine available (${result.version})${scope}\n` : `BLOCKED: ${result.reason}\n`);
    process.exitCode = result.available ? 0 : 2;
  } else if (positionals.length === 1 && positionals[0] === 'run' && values.scenario) {
    const report = await runScenario(values.scenario);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.scenarioId}: execution=${report.execution} coverage=${report.coverage} assertions=${report.assertions} cleanup=${report.cleanup}\n${report.phases.map(p => `${p.id}: ${p.execution}/${p.assertions}/${p.cleanup}${p.missing.length ? ` (${p.missing.join('; ')})` : ''}`).join('\n')}\n`);
    process.exitCode = exitCode(report);
  } else throw new Error(HELP.trim());
} catch (error) {
  const message = String(error?.message ?? 'Invalid setup').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 800);
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, execution: 'setup_failed', coverage: 'partial', assertions: 'not_evaluated', cleanup: 'completed', message })}\n`);
  else process.stderr.write(`rolloutproof: ${message}\n`);
  process.exitCode = 2;
}
