# Open-source release checklist

## Required before making the repository public

- [x] Project LICENSE uses the project's copyright, not a framework template.
- [x] Package metadata declares MIT and prevents accidental npm publication.
- [x] `.env`, SQLite, backups, APKs, toolchains, logs, reports and private project sources are ignored.
- [x] Root and backend environment examples contain placeholders only.
- [x] Contribution, conduct, security, privacy, governance, architecture and changelog documents exist.
- [ ] Repository URL, issue templates, private vulnerability reporting and maintainer contact are configured on the chosen Git host.
- [ ] Git history is scanned; any previously committed credential is rotated, not merely deleted.
- [x] The two included runtime models are listed with source, embedded/adjacent license evidence and SHA-256 in `THIRD_PARTY_ASSETS.md`; unused duplicates are excluded.
- [x] `npm audit` and backend audit return 0 vulnerabilities after SDK-57-compatible remediation.
- [x] `npm run audit:open-source` exits successfully.
- [x] `npm run check`, `npm run doctor`, `npm run build:web` and mobile Playwright tests pass.
- [ ] Latest APK is signed, hashed and installed on at least one physical Android device.
- [ ] Release notes clearly separate automated, Web viewport, emulator and physical-device evidence.

## Public service deployment

- [ ] HTTPS, strong JWT secret and explicit CORS allow-list are configured.
- [ ] Production demo account is disabled or credentials are not public.
- [ ] Database and backups use encrypted, access-controlled storage with retention limits.
- [ ] Privacy notice lists operator, region, subprocessors, retention and user contact.
- [ ] LLM, email and backup failures have monitoring without logging sensitive content.
- [ ] Account export, source revocation and complete deletion are tested with synthetic users.

## Release artifact

- [x] Version and Android `versionCode` match the current 1.0.0 preview artifact.
- [x] `CHANGELOG.md` is updated.
- [x] APK SHA-256 and test signer certificate digest are recorded in the verification report.
- [ ] Source tag matches the exact APK build commit.
- [ ] Known limitations and hardware-blocked tests are listed.
