// Synthetic application contract. This file is executed only inside the fixture image.
import pg from 'pg';
const [operation, column, status] = process.argv.slice(2);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, statement_timeout: 3000 });
let assertions;
try {
  if (!['old-read', 'new-read', 'new-write'].includes(operation) || !['name', 'full_name', 'both'].includes(column)) throw new Error('Invalid fixture command');
  await client.connect();
  if (operation === 'new-write') {
    if (!['active', 'paused', 'archived'].includes(status)) throw new Error('Invalid synthetic status');
    const assignments = column === 'both' ? 'name=$2,full_name=$2' : `${column}=$2`;
    const result = await client.query(`UPDATE users SET status=$1,${assignments} WHERE id=1 RETURNING status`, [status, 'Synthetic Grace']);
    assertions = [{ id: 'one-user-updated', passed: result.rowCount === 1 }, { id: 'new-data-written', passed: result.rows[0]?.status === status }];
  } else {
    const result = await client.query(`SELECT ${column},status FROM users WHERE id=1`);
    const supported = operation === 'old-read' ? ['active', 'paused'] : ['active', 'paused', 'archived'];
    assertions = [{ id: 'one-user', passed: result.rowCount === 1 }, { id: 'name-present', passed: typeof result.rows[0]?.[column] === 'string' && result.rows[0][column].length > 0 }, { id: 'known-status', passed: supported.includes(result.rows[0]?.status) }];
  }
} catch {
  // Do not print connection strings, SQL contents, or environment values.
  assertions = [{ id: 'query-succeeded', passed: false }];
} finally {
  await client.end().catch(() => {});
}
process.stdout.write(`${JSON.stringify({ schemaVersion: 1, assertions })}\n`);
process.exitCode = assertions.every(assertion => assertion.passed) ? 0 : 1;
