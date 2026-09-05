# Privacy Principles

知行镜面向高度私人的生活数据。开源代码不能代替部署者的隐私政策，但任何官方或社区实例至少应遵守以下原则。

## Data categories

- Direct input: text, opaque photo/audio reference receipts and foreground audio recordings kept on the device.
- Life objects: notes, tasks, events, courses, projects and drafts.
- Evidence and memory: facts, self-reports, outcomes, corrections, candidate patterns and model versions.
- Device data: calendar/reminder identifiers, health summaries, aggregate phone/desktop activity and explicitly authorized metadata.
- Nutrition data: user-confirmed meal candidates, portions, barcode records and derived energy summaries; raw food photos remain local by default.
- Operations: action receipts, consent records, audit events and authentication data.

## Processing rules

- Ask at the moment of need and explain purpose, scope, read/write level and revocation.
- Collect only what the selected feature needs.
- Keep facts separate from interpretations and temporary states separate from traits.
- Never use health, relationship, financial or legal data to make an autonomous high-impact decision.
- Never sell personal data or train a shared model on it without a separate, explicit and revocable opt-in.
- Preserve failed steps and evidence gaps; do not manufacture a complete profile.
- Treat window titles, URLs, app-level event streams, health samples and food photos as local raw data; only the minimum confirmed aggregate may cross into evidence or the digital twin.

## Photos and audio

The application exposes media only after a direct user action. Device paths and `content://`/`file://` URIs are converted to non-reversible local reference receipts before a journal entry is synchronized; photo pixels and audio binaries are not uploaded. Cancelled app-owned audio is deleted immediately when the platform permits it. A deployment that adds cloud upload must introduce a separate consent, retention, encryption and deletion design.

On Android, explicitly requested avatar fitting uses bundled Google ML Kit face and pose runtimes. Google states that image inputs and inferred outputs remain on-device, but the SDK sends diagnostics and usage metrics such as device/app information, per-installation identifiers, latency, input/output size, feature events and errors; pose detection also uses Firebase Remote Config and Firebase Installations for diagnostics. These operational disclosures do not change the application's rule against uploading photo pixels, but they must be declared accurately in a production Google Play Data safety form. See the [ML Kit data-disclosure guide](https://developers.google.com/ml-kit/android-data-disclosure).

## Retention and user rights

Users must be able to inspect provenance, export data, correct inferences, revoke a source, delete source-derived evidence and delete the account. Audit data is append-only during account lifetime but is removed during complete account deletion. Backups must have a documented expiry and deletion procedure.

## Digital twin

A single observation can update temporary state but cannot establish personality. Candidate traits require repeated cross-context evidence, retain counterevidence, have an applicability scope and review date, and can be invalidated by user correction. Frontstage UI does not display a human score.

Life-data appearance is a separate reversible layer. Recent sleep or late-night usage may add decaying eye fatigue; high stress may add mild tension but never a psychiatric label; a single meal can only create transient fullness; body-shape adjustment requires a multi-day trend and is strictly capped. Users can disable all adaptation, disable body trends separately and clear the current effect without changing their base avatar.

Phone and desktop collectors default to daily duration aggregates. Raw app events, window titles and browser URLs must not be uploaded or exposed to the avatar renderer. Food recognition results remain candidates until the user confirms the item and portion. API keys for nutrition services belong on the backend and must never be embedded in a public client variable.

## Deployment responsibility

Before public service, publish the controller identity, hosting region, subprocessors, retention schedule, contact channel and jurisdiction-specific rights. Conduct a data-protection impact assessment where required.
