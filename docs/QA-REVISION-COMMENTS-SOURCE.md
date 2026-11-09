# Revision launch, comments and navigation source verification

Recorded 8 November 2026. These changes are local source updates, not a new release or an installed-browser verification.

The focused JavaScript gate passed **448 tests across 15 test files**. It covers exact commit/PR launch context, foreground-session repository boundaries, bounded PR listing, History lookup, comment startup and retry, comment-options return navigation, and help popup lifecycle. Two Python asset-dependency checks also passed, and `git diff --check` is clean. PR overview/list DOM fixtures are synthetic; they do not establish live GitHub acceptance.

Commit lookup preserves the supplied SHA and verifies the resolved full commit. PR loading reads the explicit website head reference and pins it through a matching repository session. A fork needs its own bound website session. No broad repository API permission or merge-base guess is introduced; unavailable PR merge-base metadata produces a head-only notice.

The comment panel starts one initial foreground refresh and retries a failed first load when reopened. Options have a visible Back to comments action. Existing safety limits remain: website catalogs cover the initial issue window, and annotation discovery scans up to eight listed issues. Ordinary text remains in its conversation; markers require location metadata. KERO and organization repositories were not accessed for this check.

Keyboard and navigation help is opened from the drawing toolbar or the ? shortcut. Close, Escape and backdrop dismissal return focus to the help control. The guide no longer occupies View options.

No browser runs, screenshots, downloads, builds, packaging, installs, or publication were performed. Previously prepared 0.12.91 files have not been regenerated with these source changes.
