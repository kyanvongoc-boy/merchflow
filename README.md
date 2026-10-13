# MerchFlow

**Không gian làm việc cho merchandiser ngành may mặc / An apparel merchandising workspace.**

**Version 1.0.0-rc.1 · Internal preview for a 5–20-person pilot.** This release is a candidate for controlled company testing. It is not a production-readiness certification or a set of native installers.

MerchFlow connects customer requests, styles and purchase orders with daily tasks, quotations, email drafts, department records and reviewed learning. The interface supports Vietnamese and English.

This repository is a clean public source snapshot. It contains **no customer PDFs, customer-derived training articles, mailbox messages, production database, OAuth credentials or previous private Git history**.

![MerchFlow workspace with an empty local development database](docs/workspace.png)

## Features and current status

| Area | Included in this source |
| --- | --- |
| Desktop and mobile | Installable PWA for Windows, Mac, Android and iPhone; bilingual installation guide and responsive navigation |
| Customers and workspaces | Buyer records, style/PO references, manufacturing stages, notes and source links |
| Daily work | Due dates, three-day reminders, completion archive, activity timeline and history |
| Intake forms | Inquiry, quotation, sample, material, production and quality templates; required facts and evidence before marking intake data confirmed |
| Quotations | Editable company/customer details, line items, currency, commercial terms and printable templates |
| Excel | Editable workbook templates, Excel export and storage by work area |
| Email | In-app drafting; direct Gmail OAuth adapter for reading and creating Gmail drafts after setup and consent |
| Other mailboxes | Outlook and domain-mail account records; provider adapters are **not implemented**. Google Workspace domain mail can use the Gmail adapter |
| Purchasing / Design | Manually maintained records, revisions, review history and Drive references |
| Google Drive | Destination and source links only; automatic Drive reading/writing is **not connected** |
| Knowledge | Evidence-linked draft articles, review and training workflows; training records retain the reviewed article version and content fingerprint; the public library starts empty |
| Daily AI summary | Workflow contract and protected endpoints included; requires a separately configured scheduler and AI agent |

Creating a mailbox record does not grant access to that mailbox. Saving a schedule in the interface does not install an external scheduler. Mail drafts are not automatically sent. AI suggestions need human review before commercial commitments or production decisions.

## Install on company devices

After a private HTTPS deployment, open `/install.html` for Vietnamese/English instructions:

| Device | Installation path |
| --- | --- |
| Windows | Edge or Chrome: browser install button/menu |
| Mac | Safari on macOS Sonoma 14 or later: Add to Dock; alternatively Chrome's install menu |
| Android | Chrome: Install / Add to Home screen |
| iPhone / iPad | Safari: Share → Add to Home Screen; enable Open as Web App if shown |

Installation adds an app icon and standalone window. The backend still runs on the deployment server. There are no `.exe`, `.dmg`, `.apk` or `.ipa` packages in this release. Browser menus and available installation prompts vary by device and company policy.

The service worker caches **only a generic offline page and app icons**. It does not cache customer documents, email, API responses, app runtime files or sign-in pages. Business operations need Internet access. Forms warn before discarding unsaved edits; failed saves keep their input, and duplicate form submissions are blocked. Browser reconnection is not shown as a successful server sync until data is fetched again.

An available service-worker update offers a user-controlled reload and checks for unfinished work. In-app reminders are included. Background push notifications are **not configured**. Installing the PWA does not enable email/Drive access or schedule background jobs.

Platform references: [Microsoft Edge PWA](https://learn.microsoft.com/microsoft-edge/progressive-web-apps-chromium/ux), [Safari web apps on Mac](https://support.apple.com/en-us/104996), [PWA install criteria](https://web.dev/articles/install-criteria), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## Release gates before a company rollout

Use `/release-readiness.html` for the internal handover checklist. This snapshot does not establish that the following deployment-specific gates have passed:

- Real-device installation, login, reopening, uploads/downloads and update behavior on all four target platforms.
- Production Google credentials, consent, token refresh/revocation and return from OAuth in installed apps. Google authorization must use an allowed browser flow, not an embedded WebView.
- Access for every employee through the deployment's authenticated audience; cross-user record, mailbox and file isolation with two independent test accounts.
- One explicitly scoped scheduler job per participating employee, including failure reporting and replay/deduplication checks. The source does not provision those jobs.
- A tested database **and file-store** backup/restore procedure. The records JSON export excludes original file bytes and OAuth token storage; it is not a complete restore backup.
- Business acceptance of required fields, quotation calculations, commercial terms, evidence, training revisions and Vietnamese/English copy.

Outlook/other-mail adapters, automatic Drive synchronization, shared manager permissions and native-app distribution remain outside this release candidate. No background email sending or commercial approval is automated.

## Quick start — local development

Requirements: Node.js 22.13 or later, npm, and a supported Cloudflare Workers development environment.

```sh
npm run install:ci
npm run build
```

Initialize a **new local database** by applying these two migrations once, in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_greedy_proudstar.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_flaky_nocturne.sql
npm run dev
```

Open `http://localhost:5173`. The portable development profile supplies a local mock identity. Keep this preview on your own machine; mock identity is not production authentication. The application starts with no customer records.

Copy `.dev.vars.example` to `.dev.vars` only if local environment values are needed. The example contains no credentials. Local data, build output and filled environment files are ignored by Git.

## Production deployment

The current deployment target is **ChatGPT Sites**, using Vinext/React, Cloudflare Workers, D1 and R2. GitHub is the source repository; **GitHub Pages cannot run this backend**, database or OAuth flow.

1. Provision a separate Site with an authenticated audience, D1 binding `DB` and R2 binding `BUCKET`.
2. Configure the Site-specific hosting metadata and trusted authentication boundary in your private deployment environment. This snapshot intentionally has no existing Site or connector IDs.
3. Apply the SQL migrations through the deployment platform before using the app. Back up existing data before any future schema migration.
4. Store credentials as deployment secrets. Configure your own HTTPS origin and Google callback.
5. Build and deploy through the platform, then verify ownership isolation, OAuth consent, file access and scheduler authentication before adding business data.

The application trusts `oai-authenticated-user-*` headers supplied by the Sites gateway. **Do not expose this Worker directly to the Internet while accepting caller-provided identity headers.** A different hosting platform needs its own verified authentication/session layer, header stripping, sign-in routes and authorization checks. That deployment adapter is not included.

## Direct Gmail setup

The OAuth adapter is included; it remains unavailable until the deployment has all required values:

| Server setting | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Your Google web application client ID |
| `GOOGLE_CLIENT_SECRET` | Its server-side client secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | A cryptographically random 32-byte key encoded as base64url |
| `GOOGLE_REDIRECT_URI` | `https://YOUR-APP-ORIGIN/api/google/callback`, registered exactly with Google |
| `GMAIL_CONNECTOR_ID` | Optional Sites-native connector ID; not needed for direct Google OAuth |
| `DAILY_WORKER_SECRET` | A deployment-specific random secret of at least 32 characters for unattended daily API calls |

Enable Gmail API for your Google project and configure its OAuth audience, consent and allowed users according to Google's requirements. Reading asks for `gmail.readonly`; creating Gmail drafts requests additional `gmail.compose` access. The app exposes draft creation, not a send-email endpoint. Employees connect their own accounts; managers are not automatically granted mailbox access.

An OAuth app marked Internal is limited to members of its Google Workspace/Cloud Identity organization; the organization administrator may need to permit access. External apps in Testing have seven-day authorization/refresh-token expiration for Gmail scopes. Decide the appropriate production audience before relying on daily unattended access. See [Google App Audience](https://support.google.com/cloud/answer/15549945) and [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Tokens are stored encrypted in the deployment database. Keep the encryption key stable and protect backups; changing or losing it requires users to reconnect. Do not place secrets in frontend scripts, public files, GitHub issues, screenshots or commits.

## Daily summaries and tasks

`public/daily-workflow.json` is an **instruction template**, not an installed automation. Replace its example Site ID and origin in a private deployment. Employee settings receive an owner-specific automation ID. Configure an authorized scheduler job for each enabled employee, normally at 08:00 in `Asia/Bangkok` (Vietnam time), and give it only that deployment's access.

Unattended requests to `/api/daily-worker` and `/api/daily-gmail` require `Authorization: Bearer <DAILY_WORKER_SECRET>` as well as the host's access controls. Use `?automationId=automation_<owner-hash>` on every daily request to identify the previously authorized employee configuration. That selector is not an access credential. Without a configured secret, anonymous service calls fail closed. Never put the secret into the public workflow JSON. Signed-in calls remain scoped to their own configuration, even if a different ID is supplied. A no-selector service call supports only an existing legacy configuration and does not iterate through employees.

The workflow reads a rolling 24-hour window for tasks, retains original message evidence, deduplicates by mailbox/message ID and preserves human edits and completed tasks. It produces editable summaries and drafts, with explicit incomplete-coverage reporting. The repository does not bundle an AI model or provision paid services.

## Data and source documents

- Application records and audit history live in D1; uploaded work files use R2.
- `lib/corpus.json` and `public/knowledge.json` are intentionally empty.
- Original deployment PDFs and page images are excluded from this repository.
- Files put under `public/` become static web assets. Never use it for employee-specific or confidential documents. Add private documents through authenticated application storage or implement an authenticated document service first.
- A Drive folder URL is a destination preference, not proof that a backup or sync exists.
- Use a private deployment repository for confidential configuration and customer-specific customizations. Review each future public commit for business data and secrets.

## Structure

```text
app/                 Application entry and authenticated API routes
lib/                 Mailbox, OAuth, operations and validation logic
public/              Bilingual UI, templates and empty knowledge library
db/ + drizzle/       Database schema and migrations
build/ + scripts/    Sites/Vinext build and local development support
.openai/hosting.json Binding names only; no production identity
```

## Hướng dẫn ngắn bằng tiếng Việt

1. Bản này công khai mã nguồn, không kèm dữ liệu kinh doanh đang sử dụng.
2. Cài môi trường, tạo cơ sở dữ liệu trống và chạy theo phần Quick start.
3. Để dùng thật, triển khai bản riêng có đăng nhập; cấu hình Google một lần rồi từng nhân viên tự kết nối Gmail.
4. Lịch AI hằng ngày, Outlook và đồng bộ Drive cần cấu hình hoặc phát triển bổ sung như bảng trạng thái phía trên.
5. Tạo khách hàng → hồ sơ → biểu mẫu → công việc → kết quả → bài học được duyệt để lưu kinh nghiệm của đội ngũ.
6. Sau khi triển khai HTTPS riêng, mở `/install.html` để cài trên Windows, Mac, Android hoặc iPhone. Bản `1.0.0-rc.1` dùng thử nội bộ; cần nghiệm thu thiết bị thật, phân quyền, Gmail và phục hồi dữ liệu trước khi vận hành chính thức.

## License

No project license has been selected for this snapshot. Third-party notices are preserved in `build/sites-vite-plugin.LICENSE`, `vendor/shadcn-tailwind-4.13.0.LICENSE.md` and `public/vendor/exceljs-LICENSE.txt`. Dependency packages retain their respective licenses.
