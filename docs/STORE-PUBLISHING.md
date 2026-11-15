# Store publishing — maintainer guide

This page is for maintainers submitting KiCad Online packages. To install the product, use the [installation guide](INSTALL.md). For dated submission and publication states, see [release status](RELEASE-STATUS.md).

## Release identities

Update the existing listings so installed users retain the normal update path.

| Channel | Identity |
| --- | --- |
| Chrome Web Store | `klfdjlbngpoopegjmbajaidgodpmjaoc` |
| Mozilla Add-ons | `kicad-visual-review@wayri.github.io`; existing Pocket KiView listing URL retained |
| VS Code Marketplace | `wayri.kicad-visual-review` |

The display name is **KiCad Online**. The project uses the **KiCad Online Source-Available License 1.0**; third-party notices remain part of each package. Altium beta is a separate distribution.

## Prepare a submission

Use the tagged, tested release artifacts and their matching checksums. Do not rebuild during upload or replace an audited artifact with a different file under the same version. Follow the [release procedure](RELEASING.md) and retain the release manifest.

Listing text, screenshots, privacy disclosures and permission explanations must describe the submitted package. Identify demonstration fixtures and unsupported behavior accurately. Store version numbers can lag GitHub while review is in progress.

## Submit to each store

For GitHub Actions deployment and one-time credential setup, see
[store CI/CD](maintainers/STORE-CI.md). The workflow defaults to verification only;
live store authentication and environment configuration are separate setup steps.

- **Chrome:** upload the Chromium ZIP, save listing changes and submit for review. Choose automatic or staged publication deliberately. A pending review can block another upload; do not cancel it without the owner's approval.
- **Mozilla:** upload the Firefox ZIP and matching readable source with reproducible build instructions. Supply release notes and reviewer information. Follow the [Firefox maintainer guide](maintainers/FIREFOX.md). Validator success is not publication approval.
- **VS Code:** upload the VSIX under publisher `wayri`, then wait for verification. Inspect the version and availability shown by the publisher dashboard.

Complete sign-in and any CAPTCHA in the store's own interface. New agreements and account permissions require the owner's involvement. Keep credentials and reviewer secrets in private dashboard fields, not repository files or screenshots.

## Record the result

Record the exact version, submission URL, date and state in [release status](RELEASE-STATUS.md). Distinguish **uploaded**, **submitted**, **reviewing** and **published**. Retain receipts and artifact hashes. After publication, check the public listing and signed/installed package where applicable.

Android APK downloads are a separate channel. An unsigned AAB is not ready for Google Play; signing, listing and account requirements are covered in [Android publishing](play-store/SUBMISSION.md).

[Historical publishing records](maintainers/STORE-PUBLISHING-HISTORY.md) preserve earlier release preparation notes.
