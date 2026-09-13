# Avatar research candidate render harness

Status: **research verification only — not a production model switch**.

This harness closes one specific P0 evidence gap: a generated VRM candidate must be exercised through the same ZhixingOS Web Avatar V2 rendering path used by `MirrorHome` and `Mirror3DEditor`, at the actual Playwright project viewports, before anyone can describe it as renderer-compatible.

It does **not** make the generated candidate the production avatar. `AvatarSample_G.glb` remains the production model.

## What the harness actually does

`.github/workflows/avatar-candidate-render.yml` deterministically rebuilds the pinned MakeHuman research candidate used by the earlier rig/morph evidence, then:

1. parses it through the repository's installed `@pixiv/three-vrm` runtime and existing rigged-candidate probe;
2. starts the real backend and Expo Web application;
3. runs Playwright at the project's exact Web viewports:
   - `390 × 844` mobile Web;
   - `1440 × 960` desktop Web;
4. intercepts only the application's request for `/avatar/AvatarSample_G.glb` and fulfills that request with the generated research VRM bytes;
5. therefore sends the candidate through the existing `AvatarCanvasFlagged` / Avatar V2 / `VRMAvatarView` rendering path without changing the committed production model URL;
6. requires the runtime probe exposed by the real avatar renderer on both `MirrorHome` and the `Mirror3DEditor` preview;
7. captures full-page screenshots for both surfaces;
8. records 120 `requestAnimationFrame` intervals on both surfaces as CI-hosted evidence;
9. writes a machine-readable `render-evidence.json` that separates renderer compatibility from production acceptance.

The test also asserts that the production model request was actually intercepted. A run cannot pass merely because the normal `AvatarSample_G.glb` loaded instead.

## Real issues found while building the harness

The first desktop run failed before candidate rendering. This was not a 3D failure: at `1440 × 960`, ZhixingOS intentionally lands on `DesktopHub`, while the initial test incorrectly waited for the mobile-first `现在的我` control. The test was corrected to follow the visible desktop sidebar `镜像主页` route. This keeps the desktop run a real UI path rather than bypassing navigation through internal state.

After that correction, both mobile and desktop reached `MirrorHome`, loaded the generated candidate through the production Avatar V2 renderer, entered `Mirror3DEditor`, rendered the editor preview, and captured screenshots.

The screenshots expose an important production blocker: the current pinned research candidate is visibly a pale, untextured human silhouette. It has one skin material and does not reproduce production hair, outfit, eyes, textures, or material separation. Renderer compatibility must therefore not be confused with production visual parity.

## Structural identity morph proof is model-specific

The renderer now detects structural identity morph targets by exact audited names instead of assuming that any facial blendshape is a permanent identity control. The research candidate exposes `face_jaw_width`, `eye_size`, `nose_width`, and `mouth_width`, but only two currently have semantics that exactly match existing ZhixingOS identity fields:

- `eye_size` → `eyeSize`;
- `mouth_width` → `mouthWidth`.

`face_jaw_width` is intentionally **not** mapped to `jawRoundness`, and `nose_width` is intentionally **not** mapped to the broader `noseSize` field. Expression/lip-sync targets such as blink, visemes, or emotion shapes are also excluded from the permanent identity bridge.

The pinned candidate's structural targets are increment-only. A neutral ZhixingOS identity value of `0.5` therefore maps to morph weight `0`; values above neutral map monotonically to `0..1`; values below neutral remain `0`. The renderer does not invent unsupported negative deformation.

The candidate E2E uses the real `Mirror3DEditor` controls, keeps their production-facing labels as `当前仅保存`, and uses genuine pointer interaction on the rendered sliders. It then requires the renderer runtime probe to show both the UI identity values and the actual `SkinnedMesh.morphTargetInfluences` for `eye_size` and `mouth_width`. The test never mutates React state, DOM values, or runtime-probe objects directly.

This proof is deliberately research-only. It does **not** mean current production `AvatarSample_G.glb` has gained eye/mouth morph capability, and it does not justify changing those production UI labels to “预览生效”. Product capability remains asset-specific and must be independently proven on the production asset before any label or behavior is promoted.

## CI-hosted frame evidence is not physical-device performance

The harness samples browser animation-frame intervals because gross stalls are useful evidence, but GitHub-hosted headless Chromium/software WebGL is not an authoritative mobile-GPU performance environment.

Observed during development on separate hosted runners:

- a successful `390 × 844` run measured home p95 `116.7 ms` and editor p95 `100.0 ms`;
- a later `390 × 844` run measured editor p95 `133.4 ms`;
- a later `1440 × 960` run measured home p95 `183.3 ms`.

The variation is large enough that converting these hosted-runner values into a claim about a user's phone would be misleading. The harness therefore keeps the provisional `30 fps` / `33.33 ms` p95 budget machine-readable, records whether the hosted run meets it, but does not lower that target merely to make CI green.

`ciHostedWebPerformancePass` is evidence only. It is not Android/iOS or physical-device acceptance.

## Machine-readable gates

Each viewport produces evidence with separate decisions:

- `renderCompatibilityPass`: candidate bytes actually substituted the production model request, both real renderer surfaces emitted runtime evidence, the audited `eye_size` and `mouth_width` bindings were driven through the real editor UI into real mesh morph weights, frame sampling completed, and no fatal renderer error occurred;
- `ciHostedWebPerformancePass`: observed hosted-Chromium p95 values meet the unchanged provisional frame budget;
- `visualProductionGatePass`: currently `false` because visual/material parity is absent;
- `productionReplacementPass`: currently and intentionally `false`.

The workflow explicitly verifies that research compatibility can pass while `productionReplacementPass` remains false. This is not a fallback or a relaxed production gate; it prevents a research test from silently promoting an unvalidated avatar.

## Current production blockers

The candidate must not replace `AvatarSample_G.glb` until separate evidence addresses all relevant blockers, including:

- one untextured skin material; no production hair/outfit/eye/material parity;
- MakeHuman source skinning has more than four influences on many vertices and the current top-four conversion retains only `0.5136330140` of the raw weight at the worst vertex;
- no production blink/expression parity;
- VRM0 `LookAtDegreeMap` curves remain unsupported by the installed `three-vrm` path, so gaze parity is unverified;
- no spring-bone/hair/clothing dynamics parity;
- no authoritative mobile GPU/frame-time acceptance;
- no Android/iOS native compile evidence for this candidate;
- no Android/iOS physical-device evidence;
- no anthropometric or personal-resemblance validation.

Rendered or converged does not mean scientifically, anatomically, anthropometrically, or personally correct.

## Evidence boundary for future work

The next model candidate should be judged in layers rather than by a single “loads successfully” flag:

1. deterministic provenance/license/size audit;
2. rig, morph, and actual skin-deformation proof;
3. production-renderer compatibility at mobile and desktop Web viewports;
4. material/expression/gaze/secondary-motion parity;
5. measured Web and native performance on representative real hardware;
6. anthropometric and personal-resemblance validation where such claims are made;
7. only then a controlled production model switch.
