# External E2E fixture provenance

ZhixingOS does not commit a human portrait binary into this repository for the photo-fitting E2E.

The mobile Web E2E downloads the following official MediaPipe test asset at runtime, verifies its SHA-256, passes the resulting local file through the browser file chooser, and deletes the temporary copy after the test:

- Asset: `portrait.jpg`
- Upstream project: `google-ai-edge/mediapipe`
- Upstream test package: `mediapipe/tasks/testdata/vision`
- Upstream download URL: `https://storage.googleapis.com/mediapipe-assets/tasks/testdata/vision/portrait.jpg?generation=1782185108020964`
- SHA-256: `a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e`
- Declared package license: Apache License 2.0 (`mediapipe/tasks/testdata/vision/BUILD` declares `licenses = ["notice"]  # Apache 2.0`)
- Source mapping: MediaPipe `third_party/external_files.bzl` pins the same URL and SHA-256.
- MediaPipe Web privacy reference: `mediapipe/tasks/web/vision/README.md` states that input data is processed on-device and is not sent to Google servers, while Tasks APIs send performance/utilization metrics to Google and require the app to obtain informed consent where applicable.

The fixture is test input only. It is not user data, is not copied into Avatar persistence, and is not uploaded as an E2E artifact by this test. The runtime test also checks that ZhixingOS backend request bodies do not contain the fixture filename, `blob:`, `data:image`, or `file://` references.

This fixture proves the Web path only: explicit MediaPipe metrics consent → browser file chooser → consent-gated same-origin MediaPipe JS chunk → pinned external WASM/model downloads → MediaPipe Web detection → Avatar draft → production VRM preview → explicit confirmation → Timeline. It does not validate Android/iOS native image pickers, native ML Kit execution, or physical devices.
