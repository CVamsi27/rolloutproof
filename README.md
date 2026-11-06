# Rolloutproof

Exercise old and new application contracts through PostgreSQL migration and rollback, including data written by the new application.

[![CI](https://github.com/CVamsi27/rolloutproof/actions/workflows/ci.yml/badge.svg)](https://github.com/CVamsi27/rolloutproof/actions/workflows/ci.yml)

Public alpha for synthetic/local testing. Use Node 24.22.1 (`.node-version`). Installation from source and local tarballs is supported; the scoped package names are not published to npm. [GitHub releases](https://github.com/CVamsi27/rolloutproof/releases) provide verified alpha tarballs when a release is available.

## Install from GitHub

Use Node 24.22.1 in a test project. Copy the shipped fixtures to a new directory so you can adapt them to your application contract.

```sh
npm install --save-dev --ignore-scripts https://github.com/CVamsi27/rolloutproof/releases/download/v0.1.0-alpha.1/developer-pain-lab-rolloutproof-0.1.0-alpha.1.tgz
test ! -e ./rollout-example && cp -R node_modules/@developer-pain-lab/rolloutproof/examples ./rollout-example
```

Use the OrbStack steps below to prepare the local images. See [the pilot guide](docs/pilot.md), [contributing](CONTRIBUTING.md), and [verification](docs/verification.md).

## Current evidence

On 5 November 2026 the real PostgreSQL suite passed on macOS arm64 with OrbStack: all four scenarios (16 cells), expected broken/fixed assertions, complete declared coverage and successful cleanup. Every migration applied successfully; the new-data rollback failure appeared only when the old reader consumed the new writer's data. These are synthetic observations, not performance, independent integration or adoption evidence. Control-boundary tests remain separate from real SQL execution.

## Run the installed example on OrbStack

```sh
orbctl start docker
export CONTAINER_CLI=/absolute/path/to/docker
export CONTAINER_HOST="unix://${HOME}/.orbstack/run/docker.sock"
env -u DOCKER_CONTEXT DOCKER_HOST="$CONTAINER_HOST" "$CONTAINER_CLI" pull postgres:17-bookworm
env -u DOCKER_CONTEXT DOCKER_HOST="$CONTAINER_HOST" "$CONTAINER_CLI" build --tag rolloutproof-fixture:local ./rollout-example/fixture
npx --no-install rolloutproof doctor --scenario ./rollout-example/new-data-compatible.json --json
npx --no-install rolloutproof run --scenario ./rollout-example/new-data-compatible.json --json
```

`doctor` validates the scenario and contained SQL, then inspects the engine and resolves the three image roles to local immutable IDs. It exits 2 for invalid setup or unavailable prerequisites. Without `--scenario`, it checks engine availability only. The preflight is read-only.

The compatible scenario exits 0. Run `new-data-rollback.json` to observe exit 1 when the old reader encounters the new writer's data. Use `rename.json` and `expand-contract.json` to compare the earlier old-code/new-schema failure with the compatible change. Source contributors can run `npm run check`, `npm run pack:check`, `npm run test:integration` and `npm run measure` from the checkout.

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

The advanced `rehearse(loaded, backend)` seam supports orchestrator testing; injected backends are labelled `evidenceKind: simulated`. Observed image/SQL evidence comes from the internal runner used by `runScenario(path)`. It cannot replace the container gate.

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

## Verified alpha profiles

| Profile | Verified scope |
| --- | --- |
| Ubuntu 24.04, Node 24.22.1, hosted GitHub CI | Source checks and independent packed consumers |
| macOS arm64, Node 24.22.1, OrbStack | Local declared container/browser integration described in verification |

This hosted job does not run a Linux container engine. Real container compatibility remains the local macOS arm64 OrbStack profile. See [public alpha readiness](docs/public-alpha.md) for immutable CI evidence, distribution and remaining gates. Other runtime/OS/engine combinations remain unverified.
