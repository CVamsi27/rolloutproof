import { open, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';

const LIMIT = 1024 * 1024;
function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} has an unsupported key`);
  return value;
}
function command(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > 32 || value.some(arg => typeof arg !== 'string' || !arg.length || arg.length > 4096 || arg.includes('\0'))) throw new Error(`${label} must be a non-empty bounded array of arguments`);
  return [...value];
}
function image(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]{0,255}$/.test(value)) throw new Error(`${label} must be a prebuilt image reference`);
  return value;
}
async function bounded(path) {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > LIMIT) throw new Error('Scenario and SQL fixtures must be regular files of at most 1 MiB');
    const buffer = Buffer.alloc(LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > LIMIT) throw new Error('Fixture exceeds 1 MiB');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
export async function loadScenario(path) {
  const actual = await realpath(path);
  const root = dirname(actual);
  const value = object(JSON.parse(await bounded(actual)), 'scenario', ['schemaVersion', 'id', 'fixtures', 'images', 'commands', 'postgresImage', 'timeoutMs']);
  if (value.schemaVersion !== 1) throw new Error('Only scenario schemaVersion 1 is supported');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value.id)) throw new Error('Scenario id must be a bounded identifier');
  const fixtures = object(value.fixtures, 'fixtures', ['schema', 'seed', 'migration']);
  const images = object(value.images, 'images', ['old', 'new']);
  const commands = object(value.commands, 'commands', ['oldRead', 'newRead', 'newWrite']);
  const timeoutMs = value.timeoutMs ?? 15000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('timeoutMs must be between 100 and 120000');
  const sql = {}, digests = {};
  for (const kind of ['schema', 'seed', 'migration']) {
    const file = fixtures[kind];
    if (typeof file !== 'string' || !file || file.includes('\\') || file.includes('\0') || isAbsolute(file) || file.split('/').some(part => part === '..')) throw new Error(`fixtures.${kind} must be a contained relative SQL path`);
    const fixturePath = await realpath(resolve(root, file));
    const within = relative(root, fixturePath);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`fixtures.${kind} points outside the scenario directory`);
    sql[kind] = await bounded(fixturePath);
    if (!sql[kind].trim()) throw new Error(`fixtures.${kind} must not be empty`);
    digests[kind] = createHash('sha256').update(sql[kind]).digest('hex');
  }
  return { scenario: { schemaVersion: 1, id: value.id, fixtures: { ...fixtures }, postgresImage: image(value.postgresImage ?? 'postgres:17-bookworm', 'postgresImage'), timeoutMs, images: { old: image(images.old, 'images.old'), new: image(images.new, 'images.new') }, commands: { oldRead: command(commands.oldRead, 'commands.oldRead'), newRead: command(commands.newRead, 'commands.newRead'), newWrite: command(commands.newWrite, 'commands.newWrite') } }, sql, digests };
}
