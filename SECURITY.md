# Security Policy

## Supported versions

Security fixes target the latest `main` branch and the most recent tagged release. Until the first public release, all commits should be treated as pre-release.

## Reporting a vulnerability

Do not open a public Issue for authentication bypass, secret exposure, cross-user data access, destructive action, unsafe LLM tool execution or private-data leakage. Prefer GitHub Private Vulnerability Reporting. If the repository host lacks it, contact the maintainer through a non-public channel listed in the repository profile.

Include the affected commit/version, impact, reproduction with synthetic data, and suggested mitigation. Do not access other users' data, run denial-of-service tests or publish an exploit before a fix is available.

## Security requirements

- Production requires HTTPS, a non-default JWT secret of at least 32 characters and an explicit CORS allow-list.
- DeepSeek and SMTP credentials stay only in backend environment variables.
- `EXPO_PUBLIC_*` is bundled into the client and must contain no secrets.
- SQLite files and backups must live on an encrypted, access-controlled volume.
- High-impact actions cannot bypass explicit user confirmation.
- A reversible action is advertised only when its executor implements and tests real undo.
- Account deletion must remove runtime tables as well as legacy and memory tables.

## Release checks

Run `npm run audit:open-source`, `npm audit`, backend dependency audit, unit tests, type checks and a synthetic cross-user authorization test before each release. Rotate any credential that ever entered Git history; deleting the current file is not sufficient.

