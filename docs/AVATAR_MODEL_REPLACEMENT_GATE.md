# Avatar model replacement gate

This document defines the evidence required before replacing `public/avatar/AvatarSample_G.glb`.
It exists to prevent a visually richer model from silently weakening licensing, traceability,
mobile performance, or the distinction between **rendered** and **scientifically/personally correct**.

## Current production baseline

The reviewed production asset is `public/avatar/AvatarSample_G.glb`.

- SHA-256: `AD5750CE944B708155ABB7AC6807E19D7F5E73A939F0EE32DAF0539ACFCA57C0`
- Byte size: `15,321,932`
- Format: GLB 2.0 with VRM 0.x metadata
- Runtime: `AvatarCanvasFlagged -> AvatarModelView -> VRMAvatarView`
- Current verified structural channels:
  - face width/height: conservative head bone scale
  - body scale: body-frame scale with compensated head
  - shoulder width: shoulder/upper-arm root position
  - skin/hair/outfit color: classified material tint
- Current verified expression/motion channels:
  - blink
  - gaze
  - breathing
  - micro-motion
  - restrained record acknowledgement
- Current **stored-only** identity fields:
  - jaw roundness
  - eye size
  - eye spacing
  - brow angle
  - nose size
  - mouth width

Run:

```bash
npm run audit:avatar-model
```

The audit reports file hash/size, GLB/VRM metadata, geometry counts, humanoid bones,
expression names, named morph targets and conservative structural-morph candidates.
The structural-name detector is deliberately a heuristic. A matching name is only a
**candidate channel**; it is not proof that a slider produces a correct anatomical or
personal identity change.

## Replacement acceptance gate

A candidate model must satisfy all of the following before it can become production.

### 1. License and provenance

Record, before committing model bytes:

- upstream project and exact release/tag/commit
- original download URL
- SHA-256 of the exact imported source and final exported VRM/GLB
- author/owner
- redistribution permission
- commercial-use permission
- modification permission
- attribution/notice requirements
- any third-party hair, clothing, skin, eye, texture or rig asset licenses

The repository MIT license must never be presented as overriding the model/tool license.

### 2. Structural identity capability

A replacement is only useful if it provides real structural identity channels beyond the
current AvatarSample_G baseline. At minimum the candidate should expose auditable channels
for:

- face contour / jaw / chin
- eye size or eye spacing
- nose size/shape
- mouth/lip width/shape

Prefer named morph targets / shape keys whose vertex effect can be measured directly.
Expression-only BlendShapes such as blink, joy, visemes or mouth-open do **not** count as
permanent identity morphs.

For each promoted UI parameter, mobile E2E must prove the real production renderer changes
the intended geometry/material channel. Unsupported parameters remain `stored-only`.

### 3. Humanoid, material and animation compatibility

The candidate must retain:

- VRM humanoid bones required by the production renderer
- head + upper/lower limbs needed by current pose and shoulder mapping
- blink/expression path required by natural motion
- gaze, breathing and acknowledgement behavior
- confidently classifiable skin, hair and outfit materials
- no material-name/mesh-name ambiguity that causes clothing to be tinted as skin

### 4. File size and Web delivery

The current reviewed model is 15,321,932 bytes. A candidate at or below this size is
preferred. A larger candidate requires explicit measured benefit and must not regress the
390x844 runtime.

Web export must ship the production VRM exactly once. The existing
`npm run check:web-avatar-bundle` gate remains mandatory.

### 5. Runtime performance

Before replacement, collect the same evidence on the candidate and current production model:

- production Web build
- 390x844 mobile Web Playwright
- 1440x960 desktop Web Playwright
- time until the renderer reports the avatar as rendered
- frame/motion probe continuity during blink, gaze and breathing
- screenshot review of home and editor first viewport
- Web artifact size

A candidate is not accepted because it merely loads once on desktop.

### 6. Native boundary

Web validation does not establish native readiness. Production replacement remains
incomplete until separately validated for:

- Android native compile
- iOS native compile
- Android physical device
- iOS physical device

Those four statuses must continue to be reported independently.

## Candidate toolchain under evaluation: MakeHuman / MPFB -> Blender -> VRM

Status: **research-only; no MakeHuman-derived model is currently committed or used at runtime.**

Why it is a serious candidate:

- MakeHuman and MPFB document their bundled/core graphical assets — including base mesh,
  targets/modifiers, skins and related graphical assets — as CC0.
- MPFB documents a target as conceptually a blend shape / shape key that moves vertices.
  This is directly relevant to real eye/nose/mouth/jaw identity controls.
- MPFB release `v2.0.17` is the current evaluated generator release.
- VRM Add-on for Blender release `v4.5.0` is the current evaluated VRM exporter; the
  upstream project exposes import/export and Python automation and is licensed
  `MIT OR GPL-3.0-or-later`.
- VRM Add-on `v4.2.0` introduced an MPFB2 bone-mapping preset, reducing rig-mapping risk.

Primary official references:

- MakeHuman license: https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md
- MakeHuman/MPFB license summary: https://static.makehumancommunity.org/about/license.html
- MPFB targets/blendshapes: https://static.makehumancommunity.org/mpfb/docs/assets/concept_targets.html
- MPFB releases: https://github.com/makehumancommunity/mpfb2/releases
- VRM Add-on repository: https://github.com/saturday06/VRM-Addon-for-Blender
- VRM Add-on releases: https://github.com/saturday06/VRM-Addon-for-Blender/releases

Important limitation: only **bundled/core** MakeHuman/MPFB assets inherit the documented
CC0 status. Community/third-party clothes, hair, skins and other assets can carry different
licenses and must be audited separately.

## Next implementation step

Do not replace AvatarSample_G yet.

The next candidate branch should generate one pinned, minimal MPFB-derived humanoid with only
reviewed/core assets, export it through a pinned VRM Add-on version, then run
`scripts/audit-avatar-model.mjs` with explicit structural-family requirements before any
runtime integration. Only after the candidate passes license, size, morph, humanoid and
390x844 performance gates should the production renderer be pointed at it.
