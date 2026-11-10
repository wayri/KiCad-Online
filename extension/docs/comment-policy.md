# Repository comment policy

Place `.kicad-review-policy.json` at the **root of the target GitHub repository's current default branch** to control publishing through the KiCad Online browser extension. For a pull request from a fork, the target is the base repository where its Issue or Discussion lives; the drawing's fork revision remains only the note anchor. The extension rereads the default-branch policy immediately before each new GitHub post. A historical or fork revision cannot select a weaker rule.

Example:

```json
{
  "schemaVersion": 1,
  "commenting": {
    "mode": "allowlist",
    "allowlist": ["alice", "board-reviewer"]
  }
}
```

`mode` is required and has one of these values:

- `all`: any signed-in account on the selected transport may try to publish. GitHub still applies its own repository permissions.
- `contributors`: the signed-in account must appear in GitHub's repository contributor list. The extension scans at most 10 pages of 100 accounts; if the list is incomplete or GitHub is still calculating it, publishing is blocked. GitHub [caches contributor data](https://docs.github.com/en/rest/repos/repos#list-repository-contributors), so recent contributions can take time to qualify.
- `collaborators`: GitHub's [repository permission endpoint](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user) must confirm `read`, `write`, or `admin` access for the signed-in account. A `404`, `none`, or unverifiable permission blocks publishing.
- `allowlist`: the signed-in login must match one of up to 100 listed GitHub logins, ignoring case. An empty list allows only the repository owner.

The personal account named as repository owner is always allowed by a restricted mode. For organization-owned repositories, the organization name is not a personal login; members and admins qualify through the selected contributor, collaborator, or allowlist rule. A missing policy file defaults to `all`. A malformed policy, unavailable policy API response, or missing identity blocks restricted publishing and never silently grants permission. The worker identifies the token owner through GitHub's [authenticated-user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user); the token is not returned to GitHub page scripts.

The viewer can call `comment-policy-status` with `{repository}`. It returns `{repository,ref,mode,source,allowed,login?,reason}`, where `ref` is the repository's current default branch and `source` is `repository` or `default`. The worker enforces the rule again during `github-publish-comment`, regardless of the earlier status result.

This policy controls **only posts made by this extension**. It cannot stop someone from commenting directly on GitHub Issues or Discussions, or through another client. For site-wide restrictions, configure GitHub repository permissions and interaction limits separately. No live GitHub publication was exercised by the policy tests.


An optional `allowlist` also works with `contributors` or `collaborators` as an explicit exception for invited reviewers. For example, `{ "schemaVersion": 1, "commenting": { "mode": "contributors", "allowlist": ["external-reviewer"] } }` admits verified contributors plus that named account and the owner. The authenticated login must still be verified before this exception applies. This does not grant the account repository access or change GitHub permissions.

## Browser-session reviews

The browser-session route reads the current default-branch policy through the matching repository website session, independently of the displayed drawing revision. It verifies the website account and repeats the check before final composer verification. Unreadable or incomplete root listings do not count as a missing policy.

Owner and explicit allowlist matches use the verified website login. Contributor and collaborator modes require positive verification; if the browser route cannot establish that membership, it blocks posting and explains how an explicit review allowlist or a separately verified account connection can be used. It never requests broad repository OAuth access merely to fall back from an unverifiable rule. GitHub access controls still apply. Read-only recovery of an already attempted post checks its original account and content without submitting again.
