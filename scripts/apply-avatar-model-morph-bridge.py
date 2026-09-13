#!/usr/bin/env python3
"""One-shot branch patcher for the P0 structural identity morph bridge.

This script is intentionally strict: every replacement must match exactly once.
It is used by a temporary branch-only workflow so the large VRM renderer can be
modified without copying/reformatting the entire file through an API client.
"""
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one patch anchor, found {count}: {old[:90]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


renderer = Path("src/mirror3d/avatar/v2/VRMAvatarView.tsx")

replace_once(
    renderer,
    "} from './avatarPersonalization';\n",
    "} from './avatarPersonalization';\nimport {\n"
    "  deriveModelIdentityMorphWeights,\n"
    "  resolveModelIdentityMorphSpec,\n"
    "  type ModelIdentityMorphField,\n"
    "} from './identityMorphBridge';\n",
)

replace_once(
    renderer,
    "  appearance: {\n    skin?: string;\n    hair?: string;\n    outfit?: string;\n  };\n  /**\n",
    "  appearance: {\n    skin?: string;\n    hair?: string;\n    outfit?: string;\n  };\n"
    "  identityMorphs: {\n"
    "    availableTargetNames: string[];\n"
    "    bindings: Array<{\n"
    "      field: ModelIdentityMorphField;\n"
    "      targetName: string;\n"
    "      meshName: string;\n"
    "      index: number;\n"
    "      weight: number;\n"
    "    }>;\n"
    "  };\n"
    "  /**\n",
)

replace_once(
    renderer,
    "type TintableMaterial = THREE.Material & {\n  color?: THREE.Color;\n  roughness?: number;\n  metalness?: number;\n  userData: Record<string, unknown>;\n};\n\n\n",
    "type TintableMaterial = THREE.Material & {\n  color?: THREE.Color;\n  roughness?: number;\n  metalness?: number;\n  userData: Record<string, unknown>;\n};\n\n"
    "type IdentityMorphBinding = {\n"
    "  field: ModelIdentityMorphField;\n"
    "  targetName: string;\n"
    "  mesh: THREE.SkinnedMesh;\n"
    "  index: number;\n"
    "};\n\n\n",
)

replace_once(
    renderer,
    "  const blendMeshesRef = useRef<THREE.SkinnedMesh[]>([]);\n  const blinkIndicesRef = useRef<{ mesh: THREE.SkinnedMesh; idx: number }[]>([]);\n",
    "  const blendMeshesRef = useRef<THREE.SkinnedMesh[]>([]);\n"
    "  const identityMorphBindingsRef = useRef<IdentityMorphBinding[]>([]);\n"
    "  const availableMorphTargetNamesRef = useRef<string[]>([]);\n"
    "  const blinkIndicesRef = useRef<{ mesh: THREE.SkinnedMesh; idx: number }[]>([]);\n",
)

replace_once(
    renderer,
    "        const blendMeshes = findBlendShapeMeshes(scene);\n        blendMeshesRef.current = blendMeshes;\n\n        blinkIndicesRef.current = [];\n",
    "        const blendMeshes = findBlendShapeMeshes(scene);\n"
    "        blendMeshesRef.current = blendMeshes;\n\n"
    "        // Detect structural identity morphs by exact, semantically-audited names.\n"
    "        // Never reinterpret expression/lip-sync channels as permanent identity.\n"
    "        const availableMorphTargetNames = new Set<string>();\n"
    "        identityMorphBindingsRef.current = [];\n"
    "        for (const mesh of blendMeshes) {\n"
    "          const dictionary = mesh.morphTargetDictionary ?? {};\n"
    "          for (const [targetName, index] of Object.entries(dictionary)) {\n"
    "            availableMorphTargetNames.add(targetName);\n"
    "            const spec = resolveModelIdentityMorphSpec(targetName);\n"
    "            if (!spec || !Number.isInteger(index)) continue;\n"
    "            identityMorphBindingsRef.current.push({\n"
    "              field: spec.field,\n"
    "              targetName,\n"
    "              mesh,\n"
    "              index,\n"
    "            });\n"
    "          }\n"
    "        }\n"
    "        availableMorphTargetNamesRef.current = Array.from(availableMorphTargetNames).sort();\n\n"
    "        blinkIndicesRef.current = [];\n",
)

replace_once(
    renderer,
    "    const pose = deriveRuntimePose(profile);\n    const identityGeometry = deriveAvatarIdentityGeometry(profile);\n    const ts = pose.timeScale;\n",
    "    const pose = deriveRuntimePose(profile);\n"
    "    const identityGeometry = deriveAvatarIdentityGeometry(profile);\n"
    "    const identityMorphWeights = deriveModelIdentityMorphWeights(profile);\n"
    "    const ts = pose.timeScale;\n",
)

replace_once(
    renderer,
    "    if (vrm) {\n      vrm.update(delta);\n      // SpringBone头发弹簧骨骼物理更新（VRM标准头发/饰品物理）\n      if (vrm.springBoneManager) {\n        vrm.springBoneManager.update(delta);\n      }\n    }\n\n    // VRM.update 可能会重置标准骨骼，因此在其后应用用户已确认的身份几何。\n",
    "    if (vrm) {\n      vrm.update(delta);\n      // SpringBone头发弹簧骨骼物理更新（VRM标准头发/饰品物理）\n      if (vrm.springBoneManager) {\n        vrm.springBoneManager.update(delta);\n      }\n    }\n\n"
    "    // Structural identity morphs are model-capability driven and are applied after\n"
    "    // VRM.update so expression/runtime updates cannot silently reset them. The\n"
    "    // current research candidate has increment-only targets, so values below the\n"
    "    // neutral midpoint remain zero rather than inventing unsupported deformation.\n"
    "    for (const binding of identityMorphBindingsRef.current) {\n"
    "      const influences = binding.mesh.morphTargetInfluences;\n"
    "      if (!influences || binding.index < 0 || binding.index >= influences.length) continue;\n"
    "      influences[binding.index] = identityMorphWeights[binding.field];\n"
    "    }\n\n"
    "    // VRM.update 可能会重置标准骨骼，因此在其后应用用户已确认的身份几何。\n",
)

replace_once(
    renderer,
    "        appearance: appearanceProbeRef.current,\n        motion: {\n",
    "        appearance: appearanceProbeRef.current,\n"
    "        identityMorphs: {\n"
    "          availableTargetNames: [...availableMorphTargetNamesRef.current],\n"
    "          bindings: identityMorphBindingsRef.current.map((binding) => ({\n"
    "            field: binding.field,\n"
    "            targetName: binding.targetName,\n"
    "            meshName: binding.mesh.name,\n"
    "            index: binding.index,\n"
    "            weight: binding.mesh.morphTargetInfluences?.[binding.index] ?? 0,\n"
    "          })),\n"
    "        },\n"
    "        motion: {\n",
)

spec = Path("e2e/avatar-research-candidate.spec.ts")
replace_once(
    spec,
    "  geometry: {\n    headWorldScale?: { x: number; y: number; z: number };\n    shoulderWorldDistance?: number;\n  };\n  motion: {\n",
    "  geometry: {\n    headWorldScale?: { x: number; y: number; z: number };\n    shoulderWorldDistance?: number;\n  };\n"
    "  identity: {\n"
    "    eyeSize: number;\n"
    "    mouthWidth: number;\n"
    "  };\n"
    "  identityMorphs: {\n"
    "    availableTargetNames: string[];\n"
    "    bindings: Array<{ field: 'eyeSize' | 'mouthWidth'; targetName: string; meshName: string; index: number; weight: number }>;\n"
    "  };\n"
    "  motion: {\n",
)

replace_once(
    spec,
    "    const editorFrames = await sampleAnimationFrames(page);\n    await capture(page, '02-editor-research-candidate');\n\n    const consoleErrors = browserConsole.filter((row) => row.type === 'error').map((row) => row.text);\n",
    "    const editorFrames = await sampleAnimationFrames(page);\n"
    "    await capture(page, '02-editor-research-candidate');\n\n"
    "    // The product contract still labels these controls as stored-only for the\n"
    "    // current production AvatarSample_G. In this research-only substituted\n"
    "    // candidate, exercise the same real UI controls and prove that exact,\n"
    "    // semantically compatible structural morphs reach rendered mesh weights.\n"
    "    await page.getByRole('button', { name: '展开当前仅保存参数' }).click();\n"
    "    const eyeSizeSlider = page.getByLabel(/眼睛大小，当前仅保存/);\n"
    "    const mouthWidthSlider = page.getByLabel(/嘴宽，当前仅保存/);\n"
    "    await eyeSizeSlider.scrollIntoViewIfNeeded();\n"
    "    await eyeSizeSlider.press('End');\n"
    "    await mouthWidthSlider.scrollIntoViewIfNeeded();\n"
    "    await mouthWidthSlider.press('End');\n\n"
    "    await page.waitForFunction(() => {\n"
    "      const root = window as typeof window & { __avatarRuntimeProbes?: Record<string, AvatarRuntimeProbe> };\n"
    "      return Object.values(root.__avatarRuntimeProbes ?? {}).some((probe) =>\n"
    "        probe.evidenceTypes.includes('editor_preview')\n"
    "        && probe.identity.eyeSize >= 0.98\n"
    "        && probe.identity.mouthWidth >= 0.98\n"
    "        && probe.identityMorphs.bindings.some((binding) => binding.field === 'eyeSize' && binding.weight >= 0.95)\n"
    "        && probe.identityMorphs.bindings.some((binding) => binding.field === 'mouthWidth' && binding.weight >= 0.95),\n"
    "      );\n"
    "    }, undefined, { timeout: 30_000 });\n"
    "    const morphedEditorProbe = await waitForAvatarProbe(page, 'editor_preview');\n"
    "    await capture(page, '03-editor-research-candidate-real-morph');\n\n"
    "    const candidateStructuralTargets = morphedEditorProbe.identityMorphs.availableTargetNames;\n"
    "    const appliedIdentityBindings = morphedEditorProbe.identityMorphs.bindings;\n"
    "    expect(candidateStructuralTargets).toEqual(expect.arrayContaining(['face_jaw_width', 'eye_size', 'nose_width', 'mouth_width']));\n"
    "    expect(appliedIdentityBindings.map((binding) => binding.targetName).sort()).toEqual(['eye_size', 'mouth_width']);\n"
    "    expect(appliedIdentityBindings.every((binding) => binding.weight >= 0.95)).toBe(true);\n\n"
    "    const consoleErrors = browserConsole.filter((row) => row.type === 'error').map((row) => row.text);\n",
)

replace_once(
    spec,
    "      editorProbe: {\n        instanceId: editorProbe.instanceId,\n        evidenceTypes: editorProbe.evidenceTypes,\n        headWorldScale: editorProbe.geometry.headWorldScale,\n        elapsed: editorProbe.motion.elapsed,\n      },\n      homeFrames,\n",
    "      editorProbe: {\n        instanceId: editorProbe.instanceId,\n        evidenceTypes: editorProbe.evidenceTypes,\n        headWorldScale: editorProbe.geometry.headWorldScale,\n        elapsed: editorProbe.motion.elapsed,\n      },\n"
    "      structuralMorphProof: {\n"
    "        availableTargetNames: candidateStructuralTargets,\n"
    "        appliedBindings: appliedIdentityBindings,\n"
    "        researchUiValues: {\n"
    "          eyeSize: morphedEditorProbe.identity.eyeSize,\n"
    "          mouthWidth: morphedEditorProbe.identity.mouthWidth,\n"
    "        },\n"
    "        semanticExclusions: ['face_jaw_width != jawRoundness', 'nose_width != noseSize'],\n"
    "        productionUiCapabilityUnchanged: 'stored-only for current AvatarSample_G',\n"
    "      },\n"
    "      homeFrames,\n",
)

replace_once(
    spec,
    "      && editorProbe.evidenceTypes.includes('editor_preview')\n      && homeFrames.frames >= 100\n",
    "      && editorProbe.evidenceTypes.includes('editor_preview')\n"
    "      && appliedIdentityBindings.some((binding) => binding.field === 'eyeSize' && binding.weight >= 0.95)\n"
    "      && appliedIdentityBindings.some((binding) => binding.field === 'mouthWidth' && binding.weight >= 0.95)\n"
    "      && homeFrames.frames >= 100\n",
)

print("Applied structural identity morph bridge to renderer and candidate E2E.")
