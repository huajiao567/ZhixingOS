# Avatar structural morph visual evidence

Status: **research verification only — not a production model switch**.

This evidence layer complements the runtime `SkinnedMesh.morphTargetInfluences` proof. The candidate harness renders through the real Avatar V2 / `Mirror3DEditor` path, captures the live avatar stage, drives the real eye-size and mouth-width controls with pointer input, requires both audited mesh weights to reach their requested values, and captures the same live renderer surface again at the actual Playwright viewport.

The generated research candidate remains intentionally separate from `public/avatar/AvatarSample_G.glb`. The production asset still exposes no named structural eye/mouth morph targets, so the corresponding production controls remain labelled and behaved as stored-only.

## Real screenshot path

The canonical pinned MakeHuman candidate is deliberately minimal and unlit. For screenshot inspection only, CI derives a second research artifact from the same bytes: it computes deterministic smooth base normals and per-target morph-normal deltas, removes `KHR_materials_unlit`, and applies one 180° Y-axis scene-root rotation so the MakeHuman forward axis matches the existing Avatar V2 camera convention. Mesh and skeleton rotate together. No external model, texture, identity data, production URL, product state or production renderer code is substituted by that derivative.

Playwright then uses the real production `OrbitControls` interaction surface. A right-button drag raises the orbit target toward the head and wheel input zooms the live canvas. No camera ref, React state, DOM attribute or runtime diagnostic global is mutated to manufacture the screenshot.

The final branch artifacts were manually inspected after CI. Both `390 × 844` mobile Web and `1440 × 960` desktop Web show the candidate facing the camera with the head inside the evidence frame. Earlier attempts that enlarged the torso or exposed the back of the head were treated as invalid visual evidence and corrected rather than accepted because their jobs happened to be green.

## What this proves

For the pinned MakeHuman research candidate, the real ZhixingOS editor UI can drive the semantically exact audited `eye_size` and `mouth_width` targets through Avatar V2 into real rendered mesh weights. The evidence artifacts contain pre-morph and post-morph avatar-stage/head-focused screenshots for both Web viewports plus the machine-readable runtime probe.

The mesh-weight assertion is authoritative for structural wiring. The screenshot pair is supporting human-visible renderer evidence, not a scientific deformation measurement. Natural idle, blink, gaze and breathing remain enabled, so a raw pixel difference would mix structural deformation with animation and is intentionally not used as the acceptance gate.

## What the screenshots also reveal

The lit, forward-facing screenshots make the current candidate's limitations easier to see rather than hiding them. The CC0 core mesh/material is a research compatibility surface, not a production character: facial/eye presentation is crude, there is no production-quality eye, hair, outfit or texture/material separation, and the screenshots do not establish personal resemblance or anatomical quality. Therefore `visualProductionGatePass` and `productionReplacementPass` must remain `false`.

The evidence also does not establish facial-recognition accuracy, anthropometric accuracy, scientific validity, Android/iOS native behavior, mobile-GPU performance or physical-device acceptance. Hosted Chromium/software-WebGL timing remains evidence-only and is not a substitute for representative mobile hardware testing.
