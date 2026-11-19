# Privacy and release review

This review covers the local Windows app and its public source repository.

| Area | Control | Evidence |
| --- | --- | --- |
| Software compliance | Track the Node.js runtime requirement and external services. Review licenses and public release contents. | `package.json` lists the runtime, declares no npm dependencies, and identifies the project license as `GPL-3.0-only`. The full terms are in [LICENSE](LICENSE). |
| Data privacy | Document data categories, destination, purpose and app retention. | [Privacy notice](PRIVACY.md) and the disclosure beside **Test sustained upload**. |
| Privacy engineering | Require a user action before hardware detection or uploading. Restrict scan and upload requests to the local app. Process only the required OBS log fields. | `index.html`, `app.js`, `hardware.js`, `server.js`, `upload.js` and the tests. |
| Privacy compliance | Use transparency, purpose limitation, data minimisation, and retention as review criteria. | Sections 24 and 27 of the [Nigeria Data Protection Act](https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf) and the [NDPC implementation directive](https://ndpc.gov.ng/wp-content/uploads/2025/03/NDP-ACT-GAID-2025-MARCH-20TH.pdf) are reference points. Legal applicability, roles and obligations depend on how the app is distributed and operated. |

## Before a release

- Run `npm test` and check the local Windows launcher, manual path, hardware scan, and Clear session. Verify an upload test only with a connection where the test's data use is acceptable.
- Review the proposed Git changes and release files for local settings, OBS logs, credentials, and real user fixtures. Tests use fictional hardware and network data.
- Check that the disclosure matches any new destination, retained value, or data field, and that each new dependency or distributed component has documented terms.
- Include the GPLv3 license and preserve copyright notices in release files. If a release includes a compiled build, provide the corresponding source code as required by GPLv3.

If the app adds a hosted service, analytics, accounts, or an installer, review that change before distribution. Identify the operator and vendors, the purposes and legal bases for processing, the retention and support procedures, and any transfer or regulator requirements that apply.
