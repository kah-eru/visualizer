# Repository analysis index

The July repository sweep and its completed implementation notes are historical. Use `git log -p -- REPO_ANALYSIS_PLAN.md` to retrieve the original findings; they should not be treated as a current backlog.

Current entry points:

- [CODEBASE_AUDIT.md](CODEBASE_AUDIT.md): September security, correctness, performance, accessibility, and maintenance findings.
- [Audit remediation plan](docs/superpowers/plans/2026-09-08-audit-remediation.md): implementation and verification record.
- [NOTES.md](NOTES.md): current architecture, vendor/runtime rules, and known limits.
- [TESTING_AUDIT.md](TESTING_AUDIT.md): test commands, fixture privacy, coverage and browser safeguards.

Preserve the earlier decisions: zone `SR` does not begin watering; zone `SP` is not a zone-run stop; `PG=MR` is a manual tag; all four human actor tiers share one definition; raw customer logs are not test fixtures available in a clean clone.

The old suggestions for a modal abstraction, zoom Back history, duplicated reset/reveal scaffolding, and mandatory virtualization are not open requirements. Native dialogs, shared reveal/selection behavior, cached sorting, lazy details, and appended batches address current needs. Revisit synchronous parsing or DOM growth only with measured evidence. The app remains direct DOM with Chart.js, PapaParse, and native printing.
