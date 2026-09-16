# Android preview APK

ZhixingOS now has a reproducible GitHub Actions lane that generates a standalone Android release-preview APK from the same Expo/React Native source used by the Web application.

## What this proves

The workflow runs Expo prebuild on Ubuntu, installs the pinned Android 36 / Build Tools 36.0.0 / NDK 27.1.12297006 toolchain, builds `:app:assembleRelease`, verifies the APK signature and package id (`com.zhixingos.satori`), records a SHA-256 digest, and uploads the result as `zhixingos-android-preview-apk`.

This is materially different from the existing 390×844 browser E2E. A green APK job proves that the current source can be compiled into a native Android package. It does **not** prove physical-device rendering, camera/microphone behavior, representative GPU performance, OEM compatibility, or personal/scientific correctness of the digital twin.

## Preview-signing boundary

The artifact is a test/preview build, not a store release. It is not production-signed. If the generated Expo project does not provide an installable local release signature, CI applies an ephemeral preview certificate only to make the APK installable. A later APK built with a different preview certificate may require uninstalling the previous preview before installation. Production signing credentials must never be committed to this repository.

## Backend behavior on a phone

The app is local-first, but server-backed capabilities still need a backend reachable from the phone. The API client supports a persisted user-supplied server base URL and health probe. `127.0.0.1`/`localhost` inside an Android phone means the phone itself, not the developer computer. For LAN testing, run the ZhixingOS backend on the computer and configure the phone to use that computer's reachable `http://<LAN-IP>:3001` address.

The Android app config currently allows cleartext HTTP specifically so local-LAN development remains possible. This is a development boundary, not a recommendation for Internet-facing deployments.

## Avatar truth boundary

The installable preview continues to use the production `public/avatar/AvatarSample_G.glb`. Research-only MakeHuman candidates generated in CI are not promoted into the shipped APK unless they pass the explicit production replacement gates. Current research evidence still does not establish personal resemblance or anthropometric correctness.
