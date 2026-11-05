# SchemaProof evaluation

Inspected 5 November 2026, without executing upstream repository code.

- [README](https://github.com/terrizoaguimor/schema-proof/blob/2cd03ee38cd649413bab1a90de4bf5c69a8243ec/README.md)
- [Runner](https://github.com/terrizoaguimor/schema-proof/blob/2cd03ee38cd649413bab1a90de4bf5c69a8243ec/plugins/schema-proof/scripts/lib/runner.mjs)
- Runner file's latest commit observed through the GitHub API: `2cd03ee38cd649413bab1a90de4bf5c69a8243ec`, committed 16 July 2026.

SchemaProof already creates isolated Git snapshots, invokes real setup/contract commands, evaluates migration-first/app-first/rollback-safe policies and reports evidence. Its included demo is SQLite-only; the README explicitly limits that MVP's fixture scope. This is not evidence that the generic runner could never be extended to PostgreSQL.

In the inspected runner, each required quadrant chooses schema/app roots, creates a new `${quadrant.id}.sqlite` path, invokes setup and then a contract. Consequently that implementation does not itself sequence a new application's data writes followed by an old application's reads on the very same retained database. A developer could add such behavior to an application-owned contract; the claim is about the inspected orchestration, not an impossible capability.

Rolloutproof's experiment is a bounded adapter, not a novel policy engine: explicit PostgreSQL services, prebuilt application images, internal network isolation and a `new-read → new-write → old-read` row retaining the new data. The new-status fixture is intended to show why ordinary migration success and static schema quadrants are insufficient for that supplied rollback contract.

The real PostgreSQL suite now passes on macOS arm64 using OrbStack: four synthetic scenarios, including an old reader failing only after the new writer, with complete declared coverage and cleanup. See the project [verification record](verification.md). This was not a runtime comparison against an installed SchemaProof runner, and it establishes no easier integration, runtime saving or adoption. No upstream PR or issue was opened. After independent integration trials, propose a database/image backend seam and a post-new-write contract phase upstream before investing in a second general orchestrator.
