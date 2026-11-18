# Provider-backed review synchronization

GitHub and GitLab own published review conversations, drawing anchors and work
items. The drawing files contain no comment graphics. `.kicad-review.json` is an
optional device cache and should be excluded from Git. Credentials never belong
in this file. Unsent notes are pending drafts, not published review evidence.

Existing files remain readable. Published entries are recognized by validated
`remoteRefs`; entries without those references remain pending drafts. Migration
must not silently discard or upload existing notes. Export or publish pending
drafts before removing a legacy file. A cache containing only published entries
can be rebuilt only if the provider retains their versioned anchor metadata.

## Refresh controller

Load `extension/review-sync.js` before the review UI. It exposes
`KiCadReviewSync.create({load,onUpdate,onState,isVisible,isOnline})`.

- `start(scope)` begins a refresh immediately.
- `load(scope)` performs a read through the host's privileged provider transport.
  Return the normal thread payload, including author information.
- `onUpdate(result,{scope,syncedAt,participants})` applies a current response.
  Participants are observed message authors, not evidence of online presence.
- `onState({status,syncedAt,error})` reports `syncing`, `synced`, `paused`,
  `offline`, `error`, or `stopped`. Render error text safely with text nodes.
- `setScope(scope)` invalidates old responses and queues the new scope without
  overlapping requests. Treat the scope as immutable.
- `refresh()` requests an immediate update after a confirmed provider write.
- Call `visibilityChanged()` on visibility/foreground changes and `dispose()`
  when the view closes. The host may call `refresh()` when connectivity returns.

Refresh defaults to ten seconds while visible, with exponential failure backoff
up to two minutes. Hidden views do not poll. Requests do not overlap. Responses
from old scopes, closed views or hidden views do not update the drawing. This is
near-real-time polling, not typing indicators, cursors or presence. Genuine live
presence would need a separate authenticated collaboration service.

## File-cache reconciliation

`KiCadReviewFileStore.readSnapshot()` returns `{synced,pending}`.
`sync(scope, remoteNotes, {complete:false,sourceUrl:null})` upserts validated published notes for
one exact provider/host/repository/revision/file. Set `complete:true` only after
all pages have been retrieved successfully; only complete snapshots remove
unseen cached published entries. Do not reconcile a truncated page as complete.
An empty complete snapshot represents confirmed deletion of all remote entries
in that scope. A `sourceUrl` limits completeness to one exact issue, discussion or pull-request
URL; a complete thread read must not delete entries from other threads. Pending drafts and other scopes are preserved. A remote ID that
collides with a pending draft is rejected for explicit resolution. Existing
optimistic concurrency and staged-write checks also apply to refresh writes.

The existing file-store `save`/`read` methods remain for compatibility. The
background `comment-save` route stores pending drafts in browser storage;
confirmed publication receipts retire their draft instead of establishing a
second published copy. `comment-list` returns pending drafts only. Provider
annotation retrieval refreshes the optional cache; the file never supplies
published annotations as authority. Legacy pending notes stay readable and are
retired only after explicit deletion or a confirmed publication receipt.
Saving a file entry never constitutes a provider publication. A local
delete never deletes a GitHub or GitLab comment. Provider edits and deletes must
complete through the authenticated API before updating the cache.

## WayriCAD companion contract

The native plugin should present one comment pane: thread list, author labels,
message history, compose box, paste/attach image, locate selection, settings and
an Open in GitHub/GitLab action. Resolve repository, active document and provider
connection in the backend. Credentials stay in the host's secure storage and
must not be passed to the embedded pane or sidecar. Use the same provider IDs,
versioned drawing-anchor metadata and refresh states as KiCad Online.

Comment location graphics must be transient view overlays or selection where
the host API supports them; do not insert fake ERC/DRC violations or save review
shapes into the design. Unsupported editor/version operations must be visible.
Pasted screenshots use the provider's confirmed attachment upload result before
publishing. Preserve text drafts and image previews across refresh, navigation,
authentication expiry and upload failures. Never infer live presence from an
avatar; label the list Participants or Contributors.

Acceptance: a comment edited or deleted on either provider is reflected by the
next successful complete refresh; pending drafts survive; stale responses never
replace the active thread; a hidden or closed view stops polling; comment-only
activity leaves schematic and PCB bytes unchanged.

## Using boards and comments

In the drawing's Comments pane, use the conversation list's options menu → Work board.
Select a linked GitHub Project or an unscoped GitLab project label board. Cards show
assignees and open their issue conversation; pull requests open on the provider.
Choose a status and Apply to update it. Columns come from the provider. Partial
results are identified and the Open board link gives access to the complete board.
GitLab scoped, assignee, milestone and iteration boards currently open in GitLab.

GitHub browser sign-in uses the existing publisher Device Flow app. Select Include
GitHub Projects boards before signing in to request the additional `project` scope;
ordinary comments retain their existing repository scopes. In VS Code, opening a
board obtains a GitHub session with repository and project scopes through its built-in
account flow. GitLab browser sign-in uses the existing PKCE flow when a public app
ID is configured for that server, or an expiring access token. A publisher GitLab
public Application ID is bundled, with an Android callback documented. Registering
the exact browser redirect URI remains a deployment prerequisite for browser OAuth
login; the Android registration alone does not prove browser login works. No client
secret belongs in the extension. Self-hosted servers require their own registration.

Open conversations refresh about every three seconds while visible; failures back
off to five minutes. Background annotation refresh backs off to two minutes.
Refresh keeps drafts, pasted image previews and reading position. Participant
buttons highlight multiple authors, without indicating whether they are online.
Paste text, an image, or mixed text and image in the composer. Image-only messages
use a Screenshot caption. Upload and publication still use the existing destination
review and repository permissions. This is automatic polling, not a presence,
shared-cursor, typing-indicator or simultaneous CAD-editing service.

The work board is implemented for the browser extension, VS Code host and Android.
Android uses native project-scoped provider transport; credentials do not enter
the WebView. GitHub board access can be included during account sign-in. Live provider, installed-browser login, and native
WayriCAD acceptance are separate from mocked API and shared-view tests.
