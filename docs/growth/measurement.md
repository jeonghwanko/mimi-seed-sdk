# SDK activation measurement

The CLI's `telemetry.ts` is the public payload contract. Measurement is opt-in and disabled by default.
`mimi-seed telemetry --help` describes the commands and override. The local scanner stays offline;
with consent, a separate best-effort report is sent after the command returns its result.

The web console owns collection, storage and aggregation. It accepts only the bounded payload, deduplicates
run IDs, separates CI from interactive usage and retains events for 90 days. No raw paths, app IDs,
credentials, free-text errors or source are included. Installation IDs and salted project hashes are
pseudonymous, not anonymous people. See [the privacy notice](https://mimi-seed.pryzm.gg/privacy/sdk-usage).

Read success as completed scans, including those that found blockers. Distinguish runtime failures from
useful blocker findings. Setup completion means the requested credentials are satisfied, not a store release.
Only finishing processes report, so crashes, cancellation and failed network delivery are unobserved.
Do not label this sample as a complete installation funnel or extrapolate it to all npm downloads.

Review weekly: completed non-CI projects, observed setup completions, result-code distribution, and return
among projects with a full seven-day observation window. A seven-day return requires a later check on days
one through seven; repeated checks within a day do not count. Separate npm downloads and GitHub traffic.

Next validation milestone: five independently operated pilot projects, one useful finding confirmed by each
participant, and return checks after a week. These are goals, not claimed customer results.
