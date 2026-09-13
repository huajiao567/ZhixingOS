# Avatar structural morph visual evidence

Status: **research verification only — not a production model switch**.

This evidence layer complements the existing runtime `SkinnedMesh.morphTargetInfluences` proof. The candidate harness now captures the live `Mirror3DEditor` avatar stage before the structural morph interaction, drives the real rendered eye-size and mouth-width sliders with pointer input, requires both mesh weights to reach the audited values, then returns to the avatar through real wheel scrolling and captures the live avatar stage again at the actual Playwright viewport.

The generated research candidate remains intentionally separate from `public/avatar/AvatarSample_G.glb`. The production asset still exposes no named structural morph targets, so production eye/mouth controls remain labelled and behaved as stored-only.

## What this proves

For the pinned MakeHuman research candidate, the real ZhixingOS editor UI can drive the exact audited `eye_size` and `mouth_width` targets through Avatar V2 into rendered mesh weights. The resulting artifacts now contain both a pre-morph and post-morph avatar-stage screenshot for `390 × 844` mobile Web and `1440 × 960` desktop Web, in addition to the machine-readable runtime probe.

## What this does not prove

The screenshot pair is not used as an automated pixel-difference gate. Natural idle, blink, gaze and breathing motion remain active, so raw image differences can contain animation as well as structural deformation. The authoritative structural assertion remains the real mesh-weight probe; the screenshots are human-visible evidence that the tested renderer surface was on screen before and after the UI interaction.

The evidence does not establish identity correctness, facial-recognition accuracy, anthropometric accuracy, scientific validity, production visual quality, native mobile performance or physical-device acceptance. `visualProductionGatePass` and `productionReplacementPass` must remain false for the current research candidate.
