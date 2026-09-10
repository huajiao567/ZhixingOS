# MakeHuman rigged VRM candidate evidence

Status: **research candidate only — not approved to replace AvatarSample_G**.

This branch advances the earlier structural-morph proof by asking a narrower runtime question:
can ZhixingOS build, from pinned redistributable MakeHuman core assets, a small humanoid VRM
that `@pixiv/three-vrm` actually parses as a skinned avatar while preserving real jaw/eye/nose/
mouth structural morph channels?

The answer is **yes for research/runtime compatibility**, but the current candidate **fails the
production replacement gate** because the source skinning has more than four influences on many
vertices and the deterministic top-four reduction has a poor worst-vertex retention ratio. It also
has no production expression/blink set, hair, clothing, textures, or mobile-render proof.

No generated candidate bytes are committed to the application and no production model URL is
changed. The candidate exists only as a short-lived GitHub Actions artifact.

## Pinned upstream provenance

Repository: `makehumancommunity/makehuman`

Pinned commit:

```
a8bc2d54ff0ac92e78ff71431b1023eda42bf482
```

Only bundled/core MakeHuman files are fetched. No community hair, clothing, skin, proxy, texture,
or other third-party asset is included.

| Purpose | Pinned core path | Git blob SHA |
| --- | --- | --- |
| base mesh | `makehuman/data/3dobjs/base.obj` | `d26635e9326e3cca30778fd7b9c00062b03cce09` |
| default humanoid rig | `makehuman/data/rigs/default.mhskel` | `b02cbecae00143856410d7561adf006d83bf9b3e` |
| default skin weights | `makehuman/data/rigs/default_weights.mhw` | `66185806afacf87749be8e5cf6dbf66496b2a6b0` |
| jaw / face contour | `targets/chin/chin-width-incr.target` | `ce13cc1c443cf705c5ef50ac6360a73801315fd7` |
| left eye size | `targets/eyes/l-eye-scale-incr.target` | `d5c265bd69f4fc16a53fdac6b17e0ed88ba5822f` |
| right eye size | `targets/eyes/r-eye-scale-incr.target` | `69d59969c72a2de6e5aa961f5c19ed974a811ae0` |
| nose width | `targets/nose/nose-width3-incr.target` | `1c7bb6daa3ce7d75778d8f37af1953528e928378` |
| mouth width | `targets/mouth/mouth-scale-horiz-incr.target` | `d066e8ef5312242765c9ca3dd8cbbb04119da278` |

The builder verifies every downloaded file against its Git blob SHA before parsing it. The pinned
`default_weights.mhw` declares `license: CC0`. The candidate embeds CC0 metadata only for this
reviewed bundled/core asset scope; that status must not be generalized to third-party MakeHuman
assets.

## Deterministic candidate build

`scripts/build-makehuman-vrm-candidate.py` performs the following without Blender:

1. downloads and verifies the exact pinned base mesh, rig, weights, and four structural targets;
2. triangulates the base OBJ and converts the MakeHuman coordinate scale to metres;
3. resolves each default-rig bone head from the rig's base-mesh joint vertex sets;
4. maps 53 VRM humanoid slots, including the 17 ZhixingOS core slots, eyes, jaw, shoulders and
   finger chains;
5. writes the bundled default skin as glTF `JOINTS_0` / `WEIGHTS_0` using normalized top-four
   influences per vertex, because the Three.js runtime skin path accepts four influences here;
6. preserves four named structural morph channels:
   - `face_jaw_width`
   - `eye_size`
   - `nose_width`
   - `mouth_width`
7. writes a research-only VRM0 GLB and report to the CI artifact directory.

The build does not synthesize replacement geometry for these four morphs: their deltas come from
the pinned upstream `.target` files.

## Measured candidate

Dedicated workflow run `34478432208` produced a deterministic candidate with:

| Metric | Result |
| --- | ---: |
| candidate bytes | 2,088,516 |
| SHA-256 | `5cbad4be52ce39f70cd3f0b540ad98ec7f0cdab3664f0b357b4857c0747d30a1` |
| base vertices | 19,158 |
| triangles | 36,972 |
| skin joints / source bones | 163 |
| VRM humanoid slots | 53 |
| missing ZhixingOS core humanoid slots | 0 |
| structural morph families detected | 4 |
| expression presets | 0 |
| material count | 1 (`MakeHuman_Core_SKIN`) |
| images / textures | 0 / 0 |

Source-target affected-vertex counts remain:

- jaw / face contour: 198;
- bilateral eye size: 1,221;
- nose width: 415;
- mouth width: 1,004.

## Real `three-vrm` runtime evidence

`scripts/probe-rigged-vrm-candidate.mjs` loads the generated artifact through the same installed
`@pixiv/three-vrm` dependency family used by ZhixingOS. It is not a JSON-only check.

Run `34478432208` measured:

```
coreBoneCount: 17
missingBones: []
SkinnedMesh count: 1
SkinnedMesh skeleton bones: 163
SkinnedMesh vertices: 19158
runtimeTargets: eye_size, face_jaw_width, mouth_width, nose_width
runtime nose_width changed vertices (>1e-8): 378
runtime nose_width max delta: 0.004900000058114529 m
leftUpperArm quaternion rotation accepted: 0.049999999999996846 rad
```

The runtime non-zero count for `nose_width` is lower than the source target's 415 affected vertices
because the runtime probe applies a `1e-8` floating-point significance threshold. The source-target
count and runtime significance count are intentionally reported separately.

This proves that the candidate is parsed as a VRM humanoid with an actual bound `SkinnedMesh`, that
the four structural channels survive into runtime morph dictionaries, that at least one structural
channel contains real runtime vertex deltas, and that a mapped humanoid bone accepts a real runtime
rotation.

It does **not** prove that deformation quality is visually production-ready, anthropometrically
correct, or personally correct.

## Skin-weight blocker: research pass, production fail

The bundled MakeHuman default rig contains more raw influences than the current four-influence glTF
skin representation on part of the mesh. The deterministic builder keeps and renormalizes the four
largest influences.

Measured evidence:

| Skin metric | Result |
| --- | ---: |
| unassigned vertices | 0 |
| vertices with more than 4 raw influences | 3,665 |
| maximum raw influences on one vertex | 12 |
| mean retained raw-weight ratio after top-four reduction | 0.9905223836 |
| worst retained raw-weight ratio | 0.5136330140 |

CI deliberately records two different decisions:

```
researchCandidatePass: true
productionReplacementPass: false
```

Research continuation requires no unassigned vertices, mean retention at least 0.98, and worst
retention at least 0.50. The provisional production replacement gate requires the worst vertex to
retain at least 0.85 of its raw source weight. The current candidate therefore **must not** be
promoted to production merely because its average retention is high.

A later production candidate should either preserve a higher-fidelity skin representation through a
reviewed export/re-skin process or supply measured deformation evidence that justifies a different
policy. Lowering the gate only to make CI green is not acceptable.

## Other unresolved compatibility boundaries

The current research candidate still has several explicit blockers:

- `expressionCount = 0`; production AvatarSample_G blink/emotion behavior is therefore not proven
  on this candidate;
- `three-vrm` reports that VRM 0.0 `LookAtDegreeMap` curves are unsupported; candidate gaze behavior
  is not considered validated;
- there is one skin material only and no hair/outfit material or texture assets, so production
  skin/hair/outfit tint parity is not present;
- there are no spring-bone groups or production hair/clothing dynamics;
- no 390×844 candidate render/frame-time/screenshot has been accepted yet;
- no 1440×960 candidate visual regression has been accepted yet;
- no Android native compile or Android physical-device evidence exists for this candidate;
- no iOS native compile or iOS physical-device evidence exists for this candidate;
- no anthropometric calibration or personal-resemblance validation exists.

Consequently, the current production `AvatarSample_G.glb` remains the authoritative Avatar V2
runtime model, and jaw/eye/nose/mouth controls on that production model remain stored-only wherever
there is no verified visual morph channel. This research artifact does not change that UI truth
boundary.

## Next P0 gate

The next useful step is not to switch the application model. It is to improve this candidate while
keeping it behind a research-only test path:

1. address high-influence skinning with a reviewed conversion/re-skin pipeline, potentially using
   pinned Blender/MPFB tooling if it materially improves deformation fidelity;
2. add reviewed expression/blink channels and resolve or replace the unsupported VRM0 look-at path;
3. audit any hair/outfit/skin/eye assets independently for source, license, attribution, size and
   redistribution rights;
4. run the candidate through the actual `VRMAvatarView` renderer in an isolated test harness;
5. capture real 390×844 and 1440×960 screenshots plus runtime frame/load evidence before considering
   any production model switch.

Rendered or loadable still does not mean scientifically or personally correct.
