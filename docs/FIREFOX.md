# Firefox

Use KiCad Online to view saved schematics, PCB layouts and supported 3D models in Firefox. Start with the [Mozilla Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/pocket-kiview-kicad-review/) for the signed store version.

[Installation options](INSTALL.md) · [User guide](../USER-GUIDE.md) · [Release status](RELEASE-STATUS.md)

## Install from Mozilla Add-ons

1. Open the listing in Firefox and select **Add to Firefox** when available.
2. Review the requested permissions and data disclosures, then confirm installation.
3. Pin the extension if desired. On a repository page, click its icon to open the project viewer.

The store may offer an earlier version than the GitHub preview while an update is under review. As recorded on **6 November 2026**, version **0.12.90** was awaiting Mozilla review. The listing shows the version available to install.

## Try the GitHub preview on desktop

The [Firefox 0.12.94 ZIP](https://github.com/wayri/KiCad-Online/releases/download/v0.12.94/kicad-visual-review-firefox-0.12.94.zip) is an unsigned development package for **Firefox desktop 140 or newer**. It can be loaded temporarily; it does not replace a signed store installation.

1. Download the Firefox ZIP, [verify its checksum](INSTALL.md#verify-downloads), and extract it.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select the extracted `manifest.json`.
4. Refresh repository tabs that were open before installation.

Temporary add-ons are removed when Firefox restarts. Load the manifest again to continue. To update an extracted package in the same folder, replace its files and choose **Reload** on its debugging card. Export local review notes before removing an installation.

Use the Firefox asset, not the Chromium ZIP or GitHub's automatic source archive. Renaming a ZIP to XPI does not sign it; keep Firefox's signature checks enabled.

## Open a project

Click the extension icon and choose **Open files** or **Open folder** for local designs. Import the complete folder to preserve subsheet and model paths. Local viewing needs no connected review account.

For GitHub or GitLab, open the repository in a signed-in tab and click the icon. Repository pages remain unchanged unless you choose the optional in-page viewer. Keep the source tab open for browser-session loading. Organization SSO, download restrictions and browser policies still apply. Self-hosted GitLab requires permission for the exact HTTPS server.

Select **Schematic**, **Layout** or **3D** to inspect the design. Missing models and unsupported source constructs are reported in the viewer. See [file compatibility](KICAD-COMPATIBILITY.md) and [repository access](GIT-HOSTS.md).

## Comments and local notes

Open **Comments** to save a local note or choose a remote thread and send a review. Saving a draft does not post it. Supported GitHub website-session Issue workflows can send and read back comments without a broad repository OAuth connection. Other provider operations may need an optional connected account and repository permissions.

Local notes belong to the current browser profile. Export review JSON to keep a portable copy. Firefox does not automatically write a selected review sidecar into your checkout; save the exported file there yourself. See [comments and synchronization](COMMENTS.md).

## Firefox on Android

The extension declares **Firefox for Android 142 or newer**. Install the signed version offered by Mozilla's compatible add-on catalog; the unsigned GitHub ZIP is not a regular mobile installation package. Physical-device testing of this Firefox extension is not yet complete, so mobile behavior may differ from desktop.

On Android, actions that open a separate desktop window use an internal viewer tab instead. For a separate phone/tablet application, use the [KiCad Online Android APK](INSTALL.md#android--apk-installation).

## Other Firefox-based browsers

Zen, LibreWolf, Waterfox and Floorp may support the Firefox package, but are not independently verified editions. Compatibility depends on their Gecko version, WebExtension APIs, graphics support and privacy settings. Install through their add-on manager where supported; use a temporary developer loader only if the browser provides one. Waterfox Classic is not covered.

Install separately in each browser profile. Keep privacy and signature protections enabled. Include the browser name and version when reporting a problem.

## Firefox-specific behavior

| Feature | Behavior |
| --- | --- |
| PDFs | Open in Firefox's native PDF viewer or download them. Search, printing, rotation and password support depend on that viewer. PDF input is limited to 32 MiB. |
| Repository HTML and iBOM | Static isolated preview; repository scripts do not run. |
| Local review files | Import and export JSON; automatic selected-file sidecar writes are unavailable. |
| Connected review accounts | Reconnection may be needed after a background or browser restart. |
| Self-hosted GitLab | Grant access to the exact HTTPS server in Options. Subpath installations are unsupported. |

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Add-on disappears after restart | A temporary installation has ended. Reload its manifest or install the signed store version. |
| Package is rejected | Check the Firefox version, use the Firefox-specific asset and verify its checksum. |
| Project returns 403 or 404 | Check access in the same browser profile, complete SSO if required and keep the repository tab open. A 404 can conceal denied access. |
| Sheets or models are missing | Import the complete project folder and inspect unresolved-path and format warnings. Desktop KiCad libraries are not automatically available in the browser. |
| Comments fail to load or send | Check the destination, source tab and account state. Confirm an ambiguous send on the provider before retrying. |

For more help, see [viewer troubleshooting](VIEWER-RELIABILITY.md) or [contact support](mailto:support.kivi@sigharmonic.com). Include a version and a non-confidential example; never include credentials.

Maintainers: [Firefox packaging and Mozilla submission](maintainers/FIREFOX.md).
