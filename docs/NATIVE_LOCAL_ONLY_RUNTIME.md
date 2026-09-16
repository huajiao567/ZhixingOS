# Native local-only runtime

Starting with Android preview 1.0.1, the native application uses a fail-closed local runtime boundary.

## What remains on the device

The native REST-shaped application contract is resolved by an on-device AsyncStorage-backed data service instead of the ZhixingOS Express backend. Records, commitments, hypotheses, experiments, projects, skills, evidence, corrections, service-contract settings, continuity handoffs and action receipts are persisted locally. The six-position state derivation runs in TypeScript on the device. Avatar V2, photo-fitting math, intent parsing, change-path evaluation, action planning and the native vision module also execute locally.

Avatar profiles and twin profiles continue to use their existing user-scoped on-device stores. Media capture remains file/local-URI based; the native runtime does not automatically upload photos, audio, the avatar model, precise location or the local database.

Android backup is disabled (`android:allowBackup=false`) and cleartext HTTP is disabled for the preview package.

## The only permitted external boundary

The application-level native fetch boundary blocks outbound HTTP(S) by default. `/api/*` calls are redirected to the local runtime. The sole allowed outbound origin is the HTTPS LLM API explicitly configured by the user in **My Data → AI & Model**.

The LLM API key is stored in `expo-secure-store`, not AsyncStorage. The current native secretary request sends only the current text plus at most eight recent user/assistant chat turns. It does not automatically attach the local database, photos, audio, precise location, full timeline or avatar model.

If no model API is enabled or no key is present, secretary chat falls back to local rule-based handling without network access. A conservative local high-risk gate runs before the LLM request and can keep high-risk text from being transmitted.

## Compatibility boundary

The Web/desktop application keeps the existing backend architecture for browser development and cross-platform E2E coverage. “Native local-only” therefore describes the Android/iOS runtime, not the Web build.

The Android emulator smoke lane must run without starting the backend and records native screenshots, UI hierarchy, logcat and GPU diagnostics. A green emulator run is native evidence, but it is not a physical-device or production-signing claim.

## Remaining limits

This preview does not yet establish Android physical-device GPU/performance acceptance, OEM behavior, iOS native build acceptance, production signing, or store distribution readiness. External operating-system integrations such as calendar access still use the platform APIs after user permission; they are not ZhixingOS server uploads.
