# GitHub website project snapshots

Browser project viewing uses the open GitHub repository page and direct raw file
downloads. Project discovery, drawing hierarchy, companion drawings, saved rule
reports, model files and project search do not call GitHub's REST or GraphQL APIs.
The repository tab must stay open for website directory discovery and private reads.
The repository's page remains unchanged; the viewer opens separately.

The viewer pins a commit before reading files. Public file bytes and directory
metadata are shared between viewer windows in a bounded, memory-only background
buffer, so detaching or revisiting a drawing reuses the snapshot. Mutable branch
resolution expires after 30 seconds; immutable entries expire after 30 minutes.
The cache holds at most 128 MiB and 256 entries. Eviction, expiration or browser
worker shutdown may require downloading again. This is a temporary optimization,
not an offline project backup. Private file contents are not cached by this buffer.

The project chooser scans up to 192 directories and 8,000 entries within its
time budget. Filter the results by project name or folder path. When the scan
is partial, use **Browse folders** to open folders directly at the pinned commit.
**Standalone drawings** shows saved drawings in folders without a project file.
The chooser pages the results and reads file metadata before you open a drawing.

Other website inventories are bounded to 64 directories and 1,000 entries.
Incomplete results are identified, and uncertain library-model matching is disabled.
Linked files named explicitly by the saved drawing can still be fetched directly.
Missing model libraries on the author's computer cannot be inferred or downloaded
from unrelated sources.

API-based branch lists and commit graphs are not fetched. History / compare can
load GitHub’s website Atom feed on request (up to its initial 30 commits), then
open an immutable commit or compare it with the displayed revision. Older SHAs
can be entered explicitly; verified website-feed pagination is unavailable.
Explicit issue, discussion, publishing and account actions remain separate and
may use the provider API. Merely loading a drawing does not check comment policy
or start automatic GitHub comment polling.

Normal website/raw downloads can still fail because of connectivity, website
limits, private access, browser policy or unavailable files. API-free viewing is
not a claim of unlimited service access. Imported local projects remain available
without GitHub access.


[Client-side project access](CLIENT-SIDE-REPOSITORY-LOADING.md) explains site permissions and signed-in loading for private GitHub and GitLab projects.
