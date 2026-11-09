# Downloads and store availability

KiCad Online releases are available from GitHub and the platform stores. Stores review updates independently, so their installable versions can differ from the GitHub preview.

**Latest GitHub preview — 9 November 2026:** [KiCad Online 0.12.91 / Android 1.93](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.91) is published with 23 assets. All remote sizes and SHA-256 digests match the audited packages from source `3094638994f0d349905da0a9958ef548f57a2943`. Store submissions and reviews were not changed.

| Channel | Earlier store/channel snapshot: 6 November 2026 | Download |
| --- | --- | --- |
| GitHub | **0.12.90 / Android 1.92** preview published | [Release files and checksums](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.90) |
| Chrome Web Store | **0.12.90 pending review**; previously published 0.12.88 | [Chrome listing](https://chromewebstore.google.com/detail/klfdjlbngpoopegjmbajaidgodpmjaoc) |
| VS Code Marketplace | **0.12.90 public**; verification finished | [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=wayri.kicad-visual-review) |
| Mozilla Add-ons | **0.12.90 awaiting review**; readable source attached | [Firefox listing](https://addons.mozilla.org/en-US/firefox/addon/pocket-kiview-kicad-review/) |
| Android app | **1.92 development-signed APK** on GitHub; manual updates | [APK](https://github.com/wayri/KiCad-Online/releases/download/v0.12.90/pocket-kivi-android-phone-tablet-1.92-development.apk) |
| Safari | **0.12.85 development package**; requires Mac conversion and signing | [Safari instructions](SAFARI.md) |

This is a dated snapshot, not a live status feed. Each store listing shows the version currently available to install. A successful upload or clean validator result does not mean an update has been approved.

There is no Google Play release; the AAB is unsigned. Altium beta is separate from the main KiCad Online release. Firefox Android compatibility is declared, but physical-device extension testing is not complete.

[Installation](INSTALL.md) · [User guide](../USER-GUIDE.md) · [Release notes](https://github.com/wayri/KiCad-Online/releases)

<details>
<summary>Release evidence and historical distribution records</summary>

The following records preserve observations made during earlier releases. References to “current” or “pending” in these entries apply to their recorded dates.

**0.12.91 / Android 1.93 published (9 November 2026):** [GitHub preview](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.91), source/tag `3094638994f0d349905da0a9958ef548f57a2943`; all 23 remote assets (152,391,769 bytes) match local sizes and SHA-256 digests. Development-source gate: all 2,490 JavaScript checks passed. Clean tagged checkout: 2,489 passes plus one optional retained-public-model fixture skip; that check passed after supplying the exact retained fixture. Python: 149 passes and one Windows symbolic-link privilege skip. Android offline assemble/lint/bundle and exact 437-asset payload audit passed, with 19 lint warnings and no errors. APK is non-debuggable and uses the same development signer as Android 1.92; AAB is unsigned, not Play-ready. Includes the BoM tab, clearer sheet arrows, History/comparison, comment startup/readback and bounded stale-session recovery. KERO UI captures use locally buffered public source; installed-Chrome live KERO comment sync and private SSO acceptance remain unverified. No new store upload or phone installation is claimed. Altium beta excluded.

**0.12.90 store submissions (6 November 2026):** VS Code Marketplace **0.12.90 is Public**, verification finished. Chrome **0.12.90 is Pending review**, automatic publication selected; release text updated and three authentic feature captures added (comment composer, public Marble layer-color cross-probe, top Draftsman controls), bringing the listing to five screenshots. Existing Chrome 0.12.88 had published before this update; no review was cancelled. Mozilla **0.12.90 is Awaiting Review** (version 6673742, file 5217835), zero validation errors/warnings, desktop and Android compatibility declared, readable source attached (View current). Store submission is not approval. Altium beta excluded; Android 1.92 remains the GitHub APK, with no phone installation or Google Play publication in this attempt.

**0.12.90 / Android 1.92 published (5 November 2026):** [GitHub preview release](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.90), exact tagged source `6a4abfb4e4f1c79d4ac94d17ad405cb27a03390a`. All 23 remote assets (151,251,651 bytes) match audited local sizes and SHA-256 digests. Final gate: all 2,412 JavaScript tests passed; 149 Python passes and one Windows symbolic-link privilege skip. Android serial offline assemble/lint/bundle passed, 19 lint warnings and no errors; 427 viewer assets, signature and non-debuggable flag audited. APK development-signed; AAB unsigned and not Play-ready. Top controls, Ortho and contextual layer focus verified with bounded production-viewer fixtures; [screenshots and limits](QA-TOP-CONTROLS-0.12.90.md). Matching Mozilla readable source is prepared: 93,090,402 bytes, SHA-256 `1766ee0c455fd40f6e668fbc9320b3e23e5e753e7f12a8b50ac11d788a284824`; renderer rebuild byte-identical, OCCT not freshly rebuilt. Store submissions completed on 6 November 2026; see the current store state above. No new device installation is claimed. Altium beta excluded.

**0.12.89 / Android 1.91 published (5 November 2026):** [GitHub preview release](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.89), exact tagged source `c56a224c8ba6f89d336dc6d7742e47fa06fd31a5`. All 23 remote assets (151,129,037 bytes) match the local audited sizes and SHA-256 digests. All 2,410 JavaScript tests passed; 149 Python passes and one Windows symbolic-link privilege skip, including the separately completed Android Java boundary regression. Serial offline Android assemble/lint/bundle passed with 19 lint warnings and no errors. Signature, non-debuggable flag and all 427 viewer assets audited. APK development-signed; AAB unsigned, not Play-ready. Layer-colored net highlights verified on the complete public Marble PCB in layout, 3D and both probe types, including live Accent/Layer colors switching; [screenshots and precise limits](QA-LAYER-HIGHLIGHTS-0.12.89.md). External Marble component models were not included. No new installed-store or physical-device acceptance is claimed. Existing Chrome and Mozilla reviews remain untouched; this release has not been submitted to stores. Altium beta excluded.

**0.12.88 / Android 1.90 published (5 November 2026):** [GitHub preview release](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.88), exact source/tag `373dc6742f9a33b68ee5dd6890678f30bc3aa97a`. All 23 assets (150,065,438 bytes) match the local audited sizes and SHA-256 digests. Source gates: 149 Python passes / one Windows skip; 2,402 JavaScript passes / one skip. Android serial offline assemble, lint and bundle passed with 19 lint warnings and no errors; signature, non-debuggable flag and 427 viewer assets audited. APK development-signed; AAB unsigned, not Play-ready. Matching Mozilla readable source prepared (91,917,016 bytes; SHA-256 `895dd5f86e3c39a74e1e29eec55a08ad0bfc7c3c95943fb7896fdac03bc309d3`); Three/SPIKE rebuilt byte-identically; OCCT not rebuilt. Guided Fast PI worker results/overlay, menu dismissal/bounds and bidirectional BoM selection passed in the localhost production viewer using bounded sample/public fixtures. No new organization, installed-store or physical-device acceptance is claimed. Store submissions completed on 5 November 2026: Chrome 0.12.88 is pending review with automatic publication, following the completed publication of 0.12.85; no review was cancelled. VS Code 0.12.88 is public; verification finished and the publisher dashboard no longer shows Verifying. Mozilla 0.12.88 is Awaiting Review with zero validation errors/warnings; exact readable source is attached (version 6668215, file 5212309). Firefox desktop and Android compatibility are declared; installed Firefox Android acceptance remains pending. Tomorrow’s duplicate upload automation was removed after these submissions. Altium beta excluded. See [release notes](releases/v0.12.88.md).

**0.12.87 / Android 1.89 prepared (5 November 2026):** exact local tag `v0.12.87` at `9558035fcfbaa86714c1d07a6c2afa4c3cbdd269`. All 23 release files are built locally; all 22 checksum entries passed. No new remote upload today. The planned upload was superseded by the requested immediate 0.12.88 release. Existing Chrome review remains untouched; cancelling it still requires separate approval. Property and drawing-linked BoM comment UI verified in the integrated browser using retained public OLIMEX M2 and small schematic/grouped fixtures. Save/edit, field/value context, group references, reload persistence, markers and Locate passed. 150 Python checks: 149 passed, one Windows environment skip. JavaScript: 2,393 passed, one skipped. Android offline build/lint/bundle passed; APK signature and exact 427 viewer assets audited, non-debuggable; 19 lint warnings, no errors. Android APK is development-signed; AAB unsigned and not Play-ready. Physical-device and new live-provider posting acceptance are not claimed. Mozilla matching readable source prepared (91,906,821 bytes; SHA-256 `a861c9f2a9e05e308da9fbfcc023abf4b2d536b3d52d55450e1b048b7ff422c5`); Three/SPIKE rebuilt byte-identically, OCCT not rebuilt. Altium beta excluded. See [field-comment acceptance](QA-FIELD-COMMENTS-0.12.87.md).

**0.12.86 (5 November 2026):** [GitHub preview published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.86)
with 20 assets (123,247,941 bytes); every remote asset size and SHA-256 matches
the audited local output. Exact clean source/tag: `9f05e418d1d7551c1d40a2de8348192858443115`.
License naming and public screenshot update; Firefox now includes the project
license and static Terms. 150 Python checks: 148 passed, two environment skips
(Java policy runtime unavailable; Windows symbolic-link privilege unavailable).
JavaScript: 2,388 passed, one skipped. Readable Mozilla companion is prepared
(91,901,852 bytes; SHA-256 `2b4f853c21571a81bd3691e01b2d2063daf0122440825a669290391bac309ba7`);
the bundled rendering source rebuilt byte-identically. Native OCCT was not rebuilt.

| Channel | 0.12.86 handoff |
| --- | --- |
| VS Code | **0.12.86 public; verification finished.** Publisher dashboard displays 0.12.86 and Public without a Verifying badge. |
| Mozilla | **0.12.86 Awaiting Review**, zero validation errors/warnings (version 6667792, file 5211886). Matching readable source is retained: the version form shows View current and Changes successfully saved. Public version remains 0.12.66; icon, renamed license metadata and three new screenshots were saved separately. |
| Chrome | Pending **0.12.85** review intentionally left running. No store upload, withdrawal or listing modification for 0.12.86. |
| Android | 1.88 unchanged; no Android build or installation in this release. |

**KiCad Online 0.12.85 / Android 1.88 (4 November 2026):**
[GitHub preview published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.85)
with 23 assets; all remote sizes and SHA-256 hashes match local audited packages.
The renamed UI, guides, five genuine public OLIMEX M2 screenshots and Firefox
Android internal-tab fallback are included. Altium beta excluded. Installed IDs,
settings and license retained. Checks: 149 Python tests (one skip), 2,388 JavaScript
passes (one skip), Android offline assemble/lint/bundle and exact package audits.

| Channel | Verified state |
| --- | --- |
| Chrome | **0.12.85 submitted, pending review**, automatic publication after approval. Listing name, full description, support/homepage/policy links and two genuine 1280×800 layout/3D images updated. Old screenshots and old-name optional promo tiles removed with explicit approval. Last observed published version: 0.12.80. |
| VS Code | **0.12.85 public; verification finished**. Public extension and publisher display names are KiCad Online; publisher profile links and support email updated. The 0.12.84 upload finished verification before this update. |
| Mozilla | **0.12.85 Awaiting Review**, zero validator errors/warnings, desktop and Android checked. Product name, description, support and homepage updated. Submission is complete with the exact 91.5 MB readable-source companion attached (version 6664588). No new approval is claimed. The existing approved version is 0.12.66. |
| Android | **1.88 / versionCode 91 installed and launched** on the connected Samsung phone, with the existing application ID/signer and data preserved. Development-signed/non-debuggable; unsigned AAB is not Play upload-ready. Physical Firefox Android extension acceptance is separate and pending. |
| Public policies | Renamed Pages site serves updated Chrome privacy and Android privacy/terms. Checked HTTP 200 at the new policy URLs. |

See [release notes](releases/v0.12.85.md) and [fresh captures/provenance](BRAND-SCREENSHOTS-0.12.85.md).
Screenshots are local current-source browser captures, not installed-store or
physical Android acceptance evidence. Older entries below are historical.

**0.12.84 deployment check (4 November 2026):** Android 1.87 / version code 90 installed and launched on the connected Samsung phone. VS Code Marketplace accepted the owner upload and was still Verifying 0.12.84. Chrome 0.12.82 review was cancelled with authorization; 0.12.84 uploaded as a draft before the requested fresh branding update. Mozilla 0.12.84 validation returned zero errors/warnings and the matching source was selected; final submission/approval is not yet confirmed. The dashboard showed 0.12.66 Approved.

**0.12.84 / Android 1.87 (4 November 2026):** [GitHub preview published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.84) with 23 uploaded assets; all remote sizes and SHA-256 digests match the audited local packages. Documentation/gallery packaging refresh; engineering runtime unchanged from 0.12.83. Altium beta excluded. The gate passed 149 Python checks (one environment skip) and 2,383 JavaScript checks (one skip); Android offline assemble/lint/bundle and exact package audits passed. No new store submission, approval or physical-device acceptance is claimed. See [release notes](releases/v0.12.84.md).

**0.12.83 / Android 1.86 (4 November 2026):** [GitHub preview published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.83) with 23 SHA-256-verified assets. This release adds faster
large-board rendering, searchable Fast PI contacts, masked smooth result fields,
mechanical Draftsman optimization, Android document exports and corrected saved
DRC/ERC report ingestion. The full gate passed 149 Python checks (one environment skip) and 2,383 JavaScript checks (one skip); Android assemble/lint and exact package/source audits passed. See [release notes](releases/v0.12.83.md). Store upload
and approval are separate; no new Chrome, Marketplace or Mozilla approval is
claimed by this entry. The last full-Marble phone run predates the final added
picker/field/export changes; the final added UI checks remain pending.

**Mozilla notice:** the owner supplied an automated-screening notice reporting
tentative public approval of **0.12.66**. Older disabled-listing snapshots below
are historical. The current dashboard/listing state has not been independently
confirmed. [The 0.12.83 update plan](store-submissions/mozilla-0.12.83-plan.md)
requires the existing listing, matching readable source and installed-Firefox
acceptance before a new submission/approval claim.

**0.12.82 / Android 1.82 (4 November 2026):** [GitHub preview published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.82), including Chrome/Chromium, unsigned Firefox, VSIX, development-signed APK and unsigned AAB. Browser-session Issue replies/readback and point/area markers are included. Synthetic schematic/layout/3D marker checks passed; organization content and screenshots are excluded. No new store publication or device acceptance is claimed.

**0.12.81 / Android 1.81 (3 November 2026):** GitHub preview packages include Firefox, VSIX and the development-signed Android APK, source and checksums. See [release notes](releases/v0.12.81.md). This does not claim new Marketplace/Mozilla submission or phone installation. Chrome 0.12.80 was submitted for review separately.

**0.12.80 / Android 1.80 (2 November 2026):** [GitHub preview release published](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.80) with 23 uploaded assets, checksums and source tag. Source and audited packages include independent schematic probe navigation, R1 cross-probe identity correction, flip/rotation controls and managed-browser diagnostics. The new store submission is not claimed; previous store snapshots below remain historical. See [release notes](releases/v0.12.80.md), [browser evidence](PROBE-WALKTHROUGH-0.12.80.md) and [security scope](SECURITY-REVIEW-0.12.80.md).

**0.12.79 store update (2 November 2026):** Chrome 0.12.79 was uploaded and submitted for review, with automatic publication after approval. The superseded 0.12.78 review was canceled with explicit owner authorization; the published Chrome version remains 0.12.76. The listing includes the 0.12.79 changes. Marketplace has the validated 0.12.79 VSIX selected, but Upload opened an image CAPTCHA: the owner deferred completing it, so submission is not confirmed and the observed public VSIX version remains 0.12.76. Chrome review submission is not approval. Android is unchanged. Both packages passed exact source/package audits and checksum verification; 2,153 JavaScript checks passed. The 142-test Python run had two environment skips and one stale install-document version failure, corrected and passed on focused rerun. See the [release notes](releases/v0.12.79.md) and [Chrome submission text](store-submissions/chrome-0.12.79.txt). Older snapshots below are historical.

**Release package update: 0.12.78 / Android 1.78 (1 November 2026).** [GitHub release](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.78) includes the browser ZIPs, VSIX and development-signed Android APK. Store submissions checked **1 November 2026**: Chrome 0.12.78 is **pending review**, with automatic publication after approval; its published package was 0.12.76 when checked. VS Code Marketplace accepted 0.12.78 and shows **Verifying**. Neither pending state is an approval claim. Android 1.78 is ready with the same development certificate as 1.77; no phone was detected, and installation was deferred at the user’s request. Android hardware acceptance and the intermittent optional 3D postprocessing fallback remain disclosed in the [release notes](releases/v0.12.78.md).

The historical store snapshot below was checked **30 October 2026**. It is not a current store-status check and does not update automatically.

| Channel | Current state | What to use |
| --- | --- | --- |
| GitHub browser/desktop packages | **0.12.76 published as a preview**; source tag and package checksums available | [Release and downloads](https://github.com/wayri/KiCad-Online/releases/tag/v0.12.76) |
| Chrome Web Store | **0.12.76 submitted, pending review**, with automatic publication after approval. The superseded review was withdrawn. The observed approved package is 0.12.64 until Google approves an update. | [Existing store listing](https://chromewebstore.google.com/detail/klfdjlbngpoopegjmbajaidgodpmjaoc); use the GitHub ZIP for the newer unpacked build |
| VS Code Marketplace | **0.12.76 uploaded and verifying**. The last confirmed public package was 0.12.75; GitHub provides the new VSIX immediately. | [Marketplace](https://marketplace.visualstudio.com/items?itemName=wayri.kicad-visual-review) or [GitHub VSIX](https://github.com/wayri/KiCad-Online/releases/download/v0.12.76/kicad-visual-review-vscode-0.12.76.vsix) |
| Mozilla Add-ons | **Disabled by Mozilla**; submitted version 0.12.66 is restricted. New submissions are unavailable. The appeal was recorded; no reinstatement is shown. | [Unsigned Firefox 0.12.76 development ZIP](https://github.com/wayri/KiCad-Online/releases/download/v0.12.76/kicad-visual-review-firefox-0.12.76.zip), subject to [temporary-install and signing limits](FIREFOX.md) |
| Android | **1.76 / version code 79** APK published in v0.12.76; installed on the connected phone. Development-signed, non-debuggable, manually installed/updated. The AAB is unsigned and not ready for Play upload. | [Android APK](https://github.com/wayri/KiCad-Online/releases/download/v0.12.76/pocket-kivi-android-phone-tablet-1.76-development.apk) |
| Safari | 0.12.76 development conversion package; native conversion/signing and runtime acceptance remain required | [Safari instructions](SAFARI.md) |

## Latest browser behaviour

**0.12.76 is icon-first.** Normal GitHub/GitLab repository, drawing and pull/merge-request pages remain untouched. Click the extension icon to open a dedicated viewer tab. A single detected project opens directly; multiple projects offer a chooser. Empty, partial and access-denied results have distinct messages. Refresh already-open repository pages after updating to remove older injected controls.

The Chrome listing now includes a **What's new in 0.12.76** section describing centered project-wide search, compact navigation, mechanical 3D Draftsman and client-side GitHub project buffering. Its reachable [Chrome privacy policy](https://wayri.github.io/KiCad-Online/chrome-privacy.html) and permission explanations match the user-directed workflow.

The [illustrated user guide](../USER-GUIDE.md) includes setup, review workflows and Draftsman screenshots/video. GitHub source updates are available in release tags and [source review PR #2](https://github.com/wayri/KiCad-Online/pull/2); the default branch may lag until that review is merged.

## Shared viewer updates

0.12.76 includes improved project-model path recovery and the detachable browser schematic/layout/3D windows introduced in 0.12.74, with independent cameras and linked cross-selection toggle. Native Android and VS Code Webviews retain split views. See [release notes](releases/v0.12.76.md). The new search spans saved design objects, net names, project paths/settings, supported report/simulation text and scoped Draftsman documents; limits are shown in the search UI.

</details>
