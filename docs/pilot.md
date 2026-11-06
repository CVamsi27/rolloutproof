# Rolloutproof integration trial

Choose a non-production change in an independently maintained repository. The trial task is to rehearse one old/new application contract and retain a rollback check.

Use the [installed four-cell example](../README.md#run-the-installed-example-on-orbstack). Supply prebuilt old/new images and synthetic SQL. In the rollback cell, verify the new writer changed a value and the old reader used that same database state. Compare with your usual migration check and manual rollback rehearsal.

Record the pinned version and runtime, cold download time, hands-on setup and assistance, machine runtime, and the concrete result or action. Compare equivalent checks on the same fixture. Record whether the check enters the normal workflow and whether it runs on a later relevant change. Record observations at 14, 30 and 90 days. A period without a relevant change remains unobserved.

The [opt-in issue form](https://github.com/CVamsi27/rolloutproof/issues/new?template=integration-trial.yml) accepts sanitized summaries and synthetic reproductions. Share private repository details only with consent. The [portfolio trial record](https://github.com/CVamsi27/developer-pain-lab/blob/HEAD/docs/adoption-trials.md) tracks the current cohort and aggregates results.
