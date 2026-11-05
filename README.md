# Rolloutproof

Exercise old and new application contracts through PostgreSQL migration and rollback, including data written by the new application.

[![CI](https://github.com/CVamsi27/rolloutproof/actions/workflows/ci.yml/badge.svg)](https://github.com/CVamsi27/rolloutproof/actions/workflows/ci.yml)

Public alpha for synthetic/local testing. Use Node 24.22.1 (`.node-version`). Installation from source and local tarballs is supported; the scoped package names are not published to npm. [GitHub releases](https://github.com/CVamsi27/rolloutproof/releases) provide verified alpha tarballs when a release is available.

## Clone and run

```sh
git clone https://github.com/CVamsi27/rolloutproof.git
cd rolloutproof
npm ci --ignore-scripts
npm run check
node src/cli.js --help
```

The example target must be new. Container-backed commands below require OrbStack and explicit local image preparation. They use the Docker-compatible CLI connected to OrbStack; Docker Desktop is not required. Missing engine, browser, image, collector or cleanup evidence remains a failure.

To use a tarball in another project, download this project's `.tgz` from its release and run `npm install --save-dev /absolute/path/to/the-downloaded.tgz`. The installed tarball exposes `rolloutproof`; prepare application images and synthetic contracts explicitly.

See [contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), [changes](CHANGELOG.md) and [verification](docs/verification.md). Platform and adoption claims remain limited to recorded observations. These are ESM packages; the verified type-consumer profile is ESM/NodeNext. CommonJS compatibility is not promised; use dynamic import where needed.

An experimental PostgreSQL/image adapter for migration-first deployment rehearsals, including **an old reader against data written by the new application**. This is a local prototype, not a migration engine or a production safety certificate.

## Current evidence

On 5 November 2026 the real PostgreSQL suite passed on macOS arm64 with OrbStack: all four scenarios (16 cells), expected broken/fixed assertions, complete declared coverage and successful cleanup. Every migration applied successfully; the new-data rollback failure appeared only when the old reader consumed the new writer's data. These are synthetic observations, not performance, independent integration or adoption evidence. Control-boundary tests remain separate from real SQL execution.

## Run the synthetic examples

Requires Node 22+, a working Docker-compatible Linux-container engine, and the two local images below. From this standalone project folder:

```sh
npm ci --ignore-scripts
npm run check
npm run pack:check
node src/cli.js --help
node src/cli.js doctor --json

# Explicit preparation; the rehearsal does not pull images or install dependencies.
docker pull postgres:17-bookworm
docker build --tag rolloutproof-fixture:local examples/fixture

node src/cli.js run --scenario examples/rename.json --json
node src/cli.js run --scenario examples/expand-contract.json --json
node src/cli.js run --scenario examples/new-data-rollback.json --json
node src/cli.js run --scenario examples/new-data-compatible.json --json
npm run test:integration
npm run measure
```

For OrbStack on macOS, start its Linux engine with `orbctl start docker`, set `CONTAINER_CLI=/absolute/path/to/docker` to a Docker-compatible client and `CONTAINER_HOST="unix://${HOME}/.orbstack/run/docker.sock"` before the Node commands. For manual image commands, use `env -u DOCKER_CONTEXT DOCKER_HOST="$CONTAINER_HOST" "$CONTAINER_CLI"` in place of `docker` above. The endpoint is passed only to the client subprocess and overrides its `DOCKER_CONTEXT`; workers receive no host environment. Without overrides, normal `docker` client/context selection remains available. This macOS/OrbStack combination is verified; other engines, operating systems and Node versions remain unverified.

The broken cases should exit `1`; their corrected controls should exit `0`. Missing Docker/images exit `2` and remain unobserved. `measure` emits JSON with real per-phase wall time when executable, otherwise an explicit blocked gate with no measurements. It does not substitute simulated timings.

For an independent local consumer, pack this package (`npm pack`), install the resulting `.tgz` in a new project, then use `npx rolloutproof --help`. The package has not been published to a registry.

## What runs

Every row starts with its own internal network and fresh PostgreSQL database:

| Phase | Setup | Application contract |
| --- | --- | --- |
| `old-old` | schema + seed | old reader |
| `old-new` | schema + seed + migration | old reader |
| `new-new` | schema + seed + migration | new reader |
| `rollback-after-new-write` | schema + seed + migration | new reader → new writer → old reader, in the **same cell** |

The final row keeps the writer's data when starting the old reader. A migration accepting a new `archived` status can pass all three ordinary read combinations and still fail this final old-reader contract. Returning the writer to an old-compatible `paused` status supplies its healthy control. The expand-and-contract example preserves both name columns and dual-writes them; it does not claim every possible old/new write pattern is covered.

`setupOperations` records successful schema, seed and migration operations separately from application assertions. This makes a successful migration and a failing application contract distinguishable facts.

## Scenario and application-owned assertions

Use one of the JSON examples as the starter. Configuration accepts only schema version 1, a bounded identifier, contained synthetic SQL fixtures, prebuilt old/new application images, argument arrays for `oldRead`, `newRead`, `newWrite`, optional `timeoutMs` (100–120000; default 15000), and optional `postgresImage`.

SQL/config files are bounded to 1 MiB each; escaping fixture paths/symlinks, unknown settings and shell command strings are rejected. No production configuration, environment pass-through, host application boot file, or production database URL is accepted. The application receives only its disposable `DATABASE_URL` and `NODE_ENV=test`.

Each command writes exactly one JSON object to stdout:

```json
{"schemaVersion":1,"assertions":[{"id":"one-record","passed":true}]}
```

Use exit `0` when every assertion passes and exit `1` when any declared assertion fails. Assertions must be nonempty, bounded, uniquely identified booleans. Missing/malformed output, other exits, OOM, timeout, and exit/assertion disagreement are incomplete evidence, not a finding or pass. Raw application logs and environment values are not copied into reports. Commands must describe the behavior that matters; an assertion reporting true without exercising anything is not a useful contract.

```js
import { runScenario, exitCode } from '@developer-pain-lab/rolloutproof';
const report = await runScenario('./my-synthetic/scenario.json');
console.log(report);
process.exitCode = exitCode(report);
```

The advanced `rehearse(loaded, backend)` seam supports orchestrator testing; a non-Docker backend is explicitly labelled `evidenceKind: simulated`. Only the real Docker runner produces observed image/SQL execution evidence. It cannot replace the container gate.

## Isolation, cleanup and limits

Application commands execute in non-root, read-only containers with all capabilities dropped, `no-new-privileges`, init, CPU/memory/PID limits, a bounded tmpfs and only the cell's internal network. There are no published ports, host paths, host environment values, or Docker sockets inside workers. SQL goes to `psql` over stdin in the disposable database container. The application role has fixture DML privileges rather than database administration grants.

The targeted PostgreSQL profile is **PostgreSQL 17 Debian/bookworm, UID/GID 999**, `/var/lib/postgresql/data`. Any `postgresImage` override must preserve this UID/layout/major-version profile. Alpine and PostgreSQL 18 storage layouts are not supported profiles. Image tags resolve to immutable local IDs before phases begin. The fixture Docker build copies its own manifest and application contract, installing its dependency closure inside the image rather than copying a workspace symlink tree.

Resources carry random run ownership labels. Cleanup verifies each resource's ownership and attempts all known removals; foreign resources are refused and cleanup failures remain visible. Supervisor SIGKILL or a daemon outage can leave labelled resources. There is no global prune or automatic orphan cleanup; inspect `io.rolloutproof.owner=rolloutproof` and the exact `io.rolloutproof.run` label before any manual removal.

Exit precedence: `2` blocked/setup/cleanup failure, `1` an observed assertion failure, `3` incomplete evidence, `0` only completed declared coverage, passing assertions and successful cleanup. Each phase retains its own dimensions. No production data, load/lock-duration behavior, other database major, arbitrary application path, or undeclared operation is assessed.

## Existing tools and next gate

Read the [SchemaProof evaluation](docs/upstream.md). Compatibility matrices already exist; the candidate contribution here is a PostgreSQL/image backend and explicit newly-written-data rollback contract. Prefer an upstream adapter if that fits the existing project.

The synthetic real suite passes; the next gate is integrating application-owned contracts with five independent developers. Target three successful integrations and two retained uses on a later change. There are zero trial participants and all adoption gates are currently **unvalidated**. No outreach or npm registry publication is automated.

## Standalone project

This folder owns its source, tests, synthetic SQL, fixture-image recipe, npm lockfile and development scripts. No lab checkout or sibling dependency is required. See [verification](docs/verification.md) and the [validation plan](docs/validation-plan.md).
