# Android preview APK

ZhixingOS has a reproducible GitHub Actions lane that generates a standalone Android release-preview APK from the Expo/React Native source.

## What this proves

The workflow runs Expo prebuild on Ubuntu, installs the pinned Android 36 / Build Tools 36.0.0 / NDK 27.1.12297006 toolchain, builds `:app:assembleRelease`, verifies the APK signature and package id (`com.zhixingos.satori`), records a SHA-256 digest, audits the generated release runtime dependency graph, and uploads the installable preview artifact.

This is materially different from the existing 390×844 browser E2E. A green APK job proves that the source compiles into a native Android package. The separate Android emulator smoke installs and launches that package and captures native screenshots/logs. Neither one is a physical-device acceptance test.

## Native local-only runtime

Starting with preview `1.0.1` / Android `versionCode=2`, the Android application no longer requires the ZhixingOS Express backend for personal-data storage or deterministic algorithms. Existing `/api/*` application calls are resolved by an on-device local runtime. Core records, evidence, service-contract state, digital-twin state and action/runtime records stay on the device; deterministic state derivation, intent parsing, change-path evaluation and avatar logic execute locally.

Android automatic photo fitting is deliberately disabled in this strict-local preview. The earlier Google ML Kit dependency was removed because its diagnostics/usage telemetry does not meet the stricter native privacy boundary. Manual face/body/avatar adjustment remains available until a separately audited, telemetry-free offline detector is integrated.

The native network boundary fails closed. Its only permitted external HTTP(S) destination is the HTTPS large-model API explicitly configured by the user. The model API key is stored in the platform secure store. If the model API is disabled or has no key, the secretary uses local rule handling instead of a server fallback.

The package disables Android backup and cleartext HTTP. It does not automatically upload photos, raw audio, precise location, the local database or the avatar model. See `NATIVE_LOCAL_ONLY_RUNTIME.md` for the exact trust boundary.

## Preview-signing boundary

The artifact is a test/preview build, not a store release. It is not production-signed. If the generated Expo project does not provide an installable local release signature, CI applies an ephemeral preview certificate only to make the APK installable. A later preview signed by a different certificate may require uninstalling the previous preview before installation. Production signing credentials must never be committed to the repository.

## Avatar truth boundary

The installable preview continues to use the production `public/avatar/AvatarSample_G.glb`. Research-only MakeHuman candidates generated in CI are not promoted into the shipped APK unless they pass the explicit production replacement gates. Current research evidence still does not establish personal resemblance or anthropometric correctness.

## Unverified boundaries

A green GitHub-hosted emulator run does not establish physical-device GPU performance, camera/microphone behavior, OEM compatibility, packet-level privacy on representative hardware, production signing, Play Store readiness or iOS native acceptance. Web E2E screenshots are Web evidence, not Android-native evidence.
