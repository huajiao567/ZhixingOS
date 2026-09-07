# Third-party assets

The repository MIT license does not replace the terms below. Only the two reviewed runtime models are intended for publication; local duplicates, archives and unused experiments are excluded by `.gitignore` and the open-source audit.

## `public/avatar/AvatarSample_G.glb`

- Work: VRoid Studio beta sample character Victoria Rubin, later named AvatarSample_G.
- Author recorded in the embedded VRM 0.x metadata: `VRoidプロジェクト`.
- SHA-256: `AD5750CE944B708155ABB7AC6807E19D7F5E73A939F0EE32DAF0539ACFCA57C0`.
- Embedded license: `licenseName=Other`; everyone may use it, including corporate and personal commercial use; modification and redistribution are allowed; credit is unnecessary. The complete condition URL is stored inside the model as `otherLicenseUrl`.
- Reference: VRoid's v0.14.0 notes identify Victoria Rubin as AvatarSample_G and explain that later sample exports no longer use a blanket CC0 waiver. Accordingly, this project does not label the file CC0 and relies on its file-specific embedded VRM permissions.
- Runtime modification: the file bytes are never rewritten. Framing, pose and lighting are applied at runtime; user-confirmed identity settings may also apply conservative bone-scale adjustments and non-destructive material color tints in memory. Original material colors are retained as the idempotent baseline.

## `public/avatar/Mage.glb`

- Work: Mage from KayKit Adventurers Character Pack 1.0.
- Creator: Kay Lousberg.
- License: Creative Commons Zero 1.0 Universal (CC0-1.0); the upstream notice is preserved at `public/avatar/LICENSE.txt`.
- SHA-256: `CF898585DA33FAB50C724D31605FB931EB2912E6D2280092141E98CA81AD507D`.
- Runtime role: optional manual WebGL spike at `public/spike-3d.html`; it is not the production avatar.

If either file is replaced, update its source, terms, hash and runtime role here before committing it. The open-source audit rejects additional `.glb`, `.vrm` and model archives until they are deliberately reviewed.

## Android bundled vision runtime

The Android APK links `com.google.mlkit:face-detection:16.1.7` and `com.google.mlkit:pose-detection:18.0.0-beta5` through the local `zhixing-vision` Expo module. Both models are bundled so fitting can run on first use without downloading a model or sending the selected image to Google. The pose API remains a Google-labelled beta dependency.

These binaries and models are **not relicensed under this repository's MIT license**. Their use is governed by the [ML Kit Terms](https://developers.google.com/ml-kit/terms) and the incorporated Google APIs Terms. The published source remains reusable under MIT, but distributors who build the Android fitting feature must review and accept those separate terms. ML Kit states that feature input and output stay on-device, while SDK performance/utilization metrics can be sent to Google; deployment disclosures must therefore include the SDK telemetry described in `PRIVACY.md`.
