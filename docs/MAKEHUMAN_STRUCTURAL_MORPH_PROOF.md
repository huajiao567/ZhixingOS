# MakeHuman structural morph proof

Status: **research proof only — not a production Avatar V2 model**.

This proof answers one narrow P0 question: can a permissively redistributable open-source
asset source provide **real structural vertex channels** for identity controls that
AvatarSample_G currently cannot render?

The answer for the four tested MakeHuman core targets is yes. This does **not** establish
VRM compatibility, mobile runtime quality, anthropometric accuracy, personal resemblance,
or readiness to replace the production avatar.

## Pinned upstream evidence

Repository: `makehumancommunity/makehuman`

Pinned commit:

```
a8bc2d54ff0ac92e78ff71431b1023eda42bf482
```

Only MakeHuman bundled/core assets are used. No community hair, clothing, skin, proxy or
other third-party asset is included.

| Proof channel | Upstream core target | Git blob SHA |
| --- | --- | --- |
| jaw / face contour width | `chin/chin-width-incr.target` | `ce13cc1c443cf705c5ef50ac6360a73801315fd7` |
| eye size | `eyes/l-eye-scale-incr.target` | `d5c265bd69f4fc16a53fdac6b17e0ed88ba5822f` |
| eye size | `eyes/r-eye-scale-incr.target` | `69d59969c72a2de6e5aa961f5c19ed974a811ae0` |
| nose width | `nose/nose-width3-incr.target` | `1c7bb6daa3ce7d75778d8f37af1953528e928378` |
| mouth width | `mouth/mouth-scale-horiz-incr.target` | `d066e8ef5312242765c9ca3dd8cbbb04119da278` |
| base mesh | `3dobjs/base.obj` | `d26635e9326e3cca30778fd7b9c00062b03cce09` |

The builder verifies each upstream file using the Git blob SHA before parsing it.

MakeHuman documents its bundled/core graphical assets, including the base mesh and
targets/modifiers, under CC0. This proof deliberately does not generalize that status to
third-party/community assets.

## What the workflow actually does

`.github/workflows/avatar-morph-proof.yml` runs independently from the normal app CI:

1. self-tests the local proof builder;
2. downloads the exact pinned upstream base mesh and target files;
3. verifies every Git blob SHA;
4. parses the real MakeHuman `.target` vertex deltas;
5. combines left/right eye scale into one identity channel;
6. writes a GLB containing named structural morph targets:
   - `face_jaw_width`
   - `eye_size`
   - `nose_width`
   - `mouth_width`
7. runs ZhixingOS `scripts/audit-avatar-model.mjs` against the generated GLB and requires
   `faceContour,eye,nose,mouth`;
8. uploads the GLB, report and displacement visualization as a CI artifact.

No synthetic target is substituted for the upstream target in the real proof path.

## First measured proof

Push workflow run `34435830726` produced:

| Metric | Result |
| --- | ---: |
| MakeHuman base vertices | 19,158 |
| triangulated faces | 36,972 |
| jaw/face affected vertices | 198 |
| eye-size affected vertices | 1,221 |
| nose-width affected vertices | 415 |
| mouth-width affected vertices | 1,004 |
| proof GLB size | 1,595,364 bytes |
| proof GLB SHA-256 | `0ae65ae40ed14298699611b2d91e3f5608bf59f28109caa5a5e97c46f5a3244d` |
| named structural families detected | 4 / 4 required |

The SVG displacement view intentionally exaggerates deltas 8× for inspection and labels
that exaggeration. The GLB itself stores the original upstream delta magnitudes.

## What this changes in the product

Nothing yet.

The current AvatarSample_G capability contract remains authoritative:

- face width / face height: current conservative head-bone rendering;
- body scale / shoulder width: current body/shoulder rendering;
- skin / hair / outfit colors: current material rendering;
- jaw roundness / eye size / eye spacing / brow angle / nose size / mouth width:
  **stored-only on the production avatar**.

The proof is evidence that a future model/toolchain can expose better structural channels.
It is not evidence that the currently shipped VRM has those channels.

## Next gate: rigged VRM candidate

A later branch may proceed to Blender/MPFB/VRM export only after preserving this provenance.
The first rigged candidate must additionally prove:

- humanoid bone mapping required by `VRMAvatarView`;
- blink/expression compatibility;
- material separation for skin/hair/outfit;
- the four structural channels survive export as measurable morph targets;
- actual production renderer parameter changes;
- 390×844 Web mobile performance and screenshots;
- one-copy Web delivery;
- full asset/license inventory.

Android/iOS native compilation and physical-device validation remain separate evidence
categories and cannot be inferred from this proof or from Web Playwright.
