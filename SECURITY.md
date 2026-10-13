# Security and deployment notes

- Deploy behind a trusted identity gateway. The current app expects Sites to authenticate users and supply identity headers; a public Worker accepting those headers directly is not a safe standalone deployment.
- Keep development mock authentication bound to the local machine.
- Store Google credentials, token encryption keys and the daily worker secret in the deployment secret store. Do not publish filled environment files or database exports.
- Daily service endpoints require a deployment-specific bearer secret unless called by an authenticated user. Host access controls are still required.
- Keep each employee's mailbox authorization separate. A mailbox address or department link is not proof of access.
- Treat email, documents and AI output as untrusted evidence. Review drafts, prices, terms and production actions before use.
- Never put confidential documents under `public/`; static files are not per-user protected application records.
- Before reporting an issue, remove messages, attachments, access tokens, customer identities and commercial terms. Do not post a working exploit or credentials in a public issue. Use a private reporting channel agreed with the repository owner.

The public source has empty source-document and knowledge libraries. Do not replace them with business data in a public commit.
