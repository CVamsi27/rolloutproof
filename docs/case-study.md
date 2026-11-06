# The migration succeeds, then rolling back the application fails

This example uses Rolloutproof alpha.1 and disposable PostgreSQL 17. The old application accepts user statuses `active` and `paused`. The migration extends the constraint to allow `archived`. Both application versions can read the seeded `active` user. The incompatibility appears only after the new version writes `archived` and the old version reads that row.

## How the rehearsal works

Rolloutproof creates a fresh database and network for each phase. It runs the application-owned commands against that phase's database and captures their declared assertions.

| Phase | Application commands | Broken scenario |
| --- | --- | --- |
| `old-old` | Old reader on the original schema | Passes |
| `old-new` | Old reader after migration | Passes |
| `new-new` | New reader after migration | Passes |
| `rollback-after-new-write` | New reader, new writer, then old reader on the same migrated database | Old reader rejects the status |

The new writer verifies that it updated the row and that PostgreSQL returned the requested status. The old reader then checks that it recognizes the stored value. In the broken case, `new-data-written` passes and `known-status` fails. All four phases use synthetic data. The [fixture image](../examples/fixture/contract.js) contains distinct old and new contract commands.

## Run the broken and compatible controls

Use Node 24.22.1 in a new empty directory. Install the pinned package and copy its fixtures.

```sh
npm init -y
npm install --save-dev --ignore-scripts https://github.com/CVamsi27/rolloutproof/releases/download/v0.1.0-alpha.1/developer-pain-lab-rolloutproof-0.1.0-alpha.1.tgz
test ! -e ./rollout-example && cp -R node_modules/@developer-pain-lab/rolloutproof/examples ./rollout-example
```

Use the [OrbStack image setup](../README.md#run-the-installed-example-on-orbstack) to prepare PostgreSQL and build the local fixture image, then run the preflight and broken case.

```sh
npx --no-install rolloutproof doctor --scenario ./rollout-example/new-data-rollback.json --json
npx --no-install rolloutproof run --scenario ./rollout-example/new-data-rollback.json --json > broken-rollout.json
```

`doctor` checks the SQL paths and local images without allocating a cell. The broken rehearsal is expected to exit 1. In `broken-rollout.json`, look in the last phase for completed migration under `setupOperations` and the failed `old-read` under `operations`. The observed report retains the successful write and cleanup alongside the failure.

```sh
npx --no-install rolloutproof run --scenario ./rollout-example/new-data-compatible.json --json
```

The compatible control uses the same migration but writes `paused`. All four phases pass and the command exits 0.

## Apply it to your rollout

Copy the compatible scenario, supply prebuilt old and new test images, and replace the SQL and commands with one real application contract exercised on synthetic data. Have the new writer check the value it changed and the old reader consume that same value during the rollback phase. Use the command's exit in CI and retain the JSON for diagnosis. The result applies to the declared sequence and assertions. Read the [scenario contract](../README.md#scenario-and-application-owned-assertions) and [verification record](verification.md).
