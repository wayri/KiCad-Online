# GitHub website metadata evidence

These reduced public website payloads were observed on 2026-11-07 through the
in-app browser DOM by the root agent. Only branch names/paths/default flags,
pagination fields, and commit identity/parents/author/date metadata were retained.
No session fields, CSRF tokens, private repository data, or API responses are included.

- `github-branches-observed.json`: https://github.com/wayri/KiCad-Online/branches
- `github-all-branches-observed.json`: https://github.com/wayri/KiCad-Online/branches/all
- `github-commit-observed.json`: https://github.com/wayri/KiCad-Online/commit/d5791b0495996e11772effd418fbff0c197fbccd

The observed commit has one parent. Merge, root, invalid identity and cancellation
cases in tests are synthetic mutations, not claims about this live commit.
The branch page exposes twenty entries and `has_more: true`; no verified next-page
request contract was captured. The implementation deliberately stops after this page.
