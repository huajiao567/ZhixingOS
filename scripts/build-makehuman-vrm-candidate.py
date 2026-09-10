#!/usr/bin/env python3
"""Build a research-only rigged VRM0 candidate from pinned MakeHuman core assets.

This does not replace the production AvatarSample_G. It creates a CI artifact that combines
real MakeHuman core geometry, the bundled default humanoid skeleton/weights and four real
structural target channels so ZhixingOS can test the next P0 gate without committing model
bytes or third-party avatar assets to the app.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

UPSTREAM_REPO = "makehumancommunity/makehuman"
UPSTREAM_COMMIT = "a8bc2d54ff0ac92e78ff71431b1023eda42bf482"
RAW_ROOT = f"https://raw.githubusercontent.com/{UPSTREAM_REPO}/{UPSTREAM_COMMIT}"
SCALE = 0.1  # MakeHuman mesh coordinates -> metres for the candidate runtime.

BASE = ("makehuman/data/3dobjs/base.obj", "d26635e9326e3cca30778fd7b9c00062b03cce09")
RIG = ("makehuman/data/rigs/default.mhskel", "b02cbecae00143856410d7561adf006d83bf9b3e")
WEIGHTS = ("makehuman/data/rigs/default_weights.mhw", "66185806afacf87749be8e5cf6dbf66496b2a6b0")
MORPHS = [
    ("face_jaw_width", "faceContour", [
        ("makehuman/data/targets/chin/chin-width-incr.target", "ce13cc1c443cf705c5ef50ac6360a73801315fd7"),
    ]),
    ("eye_size", "eye", [
        ("makehuman/data/targets/eyes/l-eye-scale-incr.target", "d5c265bd69f4fc16a53fdac6b17e0ed88ba5822f"),
        ("makehuman/data/targets/eyes/r-eye-scale-incr.target", "69d59969c72a2de6e5aa961f5c19ed974a811ae0"),
    ]),
    ("nose_width", "nose", [
        ("makehuman/data/targets/nose/nose-width3-incr.target", "1c7bb6daa3ce7d75778d8f37af1953528e928378"),
    ]),
    ("mouth_width", "mouth", [
        ("makehuman/data/targets/mouth/mouth-scale-horiz-incr.target", "d066e8ef5312242765c9ca3dd8cbbb04119da278"),
    ]),
]

# VRM humanoid slots -> exact MakeHuman bundled default-rig bones.
HUMANOID_MAP = {
    "hips": "root",
    "spine": "spine05",
    "chest": "spine03",
    "upperChest": "spine01",
    "neck": "neck03",
    "head": "head",
    "leftShoulder": "clavicle.L",
    "rightShoulder": "clavicle.R",
    "leftUpperArm": "upperarm01.L",
    "rightUpperArm": "upperarm01.R",
    "leftLowerArm": "lowerarm01.L",
    "rightLowerArm": "lowerarm01.R",
    "leftHand": "wrist.L",
    "rightHand": "wrist.R",
    "leftUpperLeg": "upperleg01.L",
    "rightUpperLeg": "upperleg01.R",
    "leftLowerLeg": "lowerleg01.L",
    "rightLowerLeg": "lowerleg01.R",
    "leftFoot": "foot.L",
    "rightFoot": "foot.R",
    "leftEye": "eye.L",
    "rightEye": "eye.R",
    "jaw": "jaw",
    "leftThumbProximal": "finger1-1.L",
    "leftThumbIntermediate": "finger1-2.L",
    "leftThumbDistal": "finger1-3.L",
    "rightThumbProximal": "finger1-1.R",
    "rightThumbIntermediate": "finger1-2.R",
    "rightThumbDistal": "finger1-3.R",
    "leftIndexProximal": "finger2-1.L",
    "leftIndexIntermediate": "finger2-2.L",
    "leftIndexDistal": "finger2-3.L",
    "rightIndexProximal": "finger2-1.R",
    "rightIndexIntermediate": "finger2-2.R",
    "rightIndexDistal": "finger2-3.R",
    "leftMiddleProximal": "finger3-1.L",
    "leftMiddleIntermediate": "finger3-2.L",
    "leftMiddleDistal": "finger3-3.L",
    "rightMiddleProximal": "finger3-1.R",
    "rightMiddleIntermediate": "finger3-2.R",
    "rightMiddleDistal": "finger3-3.R",
    "leftRingProximal": "finger4-1.L",
    "leftRingIntermediate": "finger4-2.L",
    "leftRingDistal": "finger4-3.L",
    "rightRingProximal": "finger4-1.R",
    "rightRingIntermediate": "finger4-2.R",
    "rightRingDistal": "finger4-3.R",
    "leftLittleProximal": "finger5-1.L",
    "leftLittleIntermediate": "finger5-2.L",
    "leftLittleDistal": "finger5-3.L",
    "rightLittleProximal": "finger5-1.R",
    "rightLittleIntermediate": "finger5-2.R",
    "rightLittleDistal": "finger5-3.R",
}

CORE_HUMANOID = {
    "hips", "spine", "chest", "neck", "head",
    "leftUpperArm", "rightUpperArm", "leftLowerArm", "rightLowerArm",
    "leftHand", "rightHand", "leftUpperLeg", "rightUpperLeg",
    "leftLowerLeg", "rightLowerLeg", "leftFoot", "rightFoot",
}


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()


def fetch_verified(path: str, expected_sha: str, retries: int = 3):
    url = f"{RAW_ROOT}/{path}"
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ZhixingOS-rigged-vrm-candidate/1.0"})
            with urllib.request.urlopen(req, timeout=90) as response:
                data = response.read()
            actual = git_blob_sha(data)
            if actual != expected_sha:
                raise RuntimeError(f"Git blob SHA mismatch for {path}: {actual} != {expected_sha}")
            return data, {
                "path": path,
                "gitBlobSha": actual,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"failed to fetch {path}: {last_error}")


def parse_obj(text: str):
    vertices = []
    triangles = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("v "):
            _, x, y, z, *_ = line.split()
            vertices.append((float(x) * SCALE, float(y) * SCALE, float(z) * SCALE))
        elif line.startswith("f "):
            refs = line.split()[1:]
            ids = []
            for ref in refs:
                token = ref.split("/", 1)[0]
                idx = int(token)
                idx = idx - 1 if idx > 0 else len(vertices) + idx
                if idx < 0 or idx >= len(vertices):
                    raise ValueError(f"OBJ face index out of range: {line}")
                ids.append(idx)
            for i in range(1, len(ids) - 1):
                triangles.append((ids[0], ids[i], ids[i + 1]))
    if not vertices or not triangles:
        raise ValueError("OBJ has no usable geometry")
    return vertices, triangles


def parse_target(text: str, vertex_count: int):
    out = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 4:
            raise ValueError(f"invalid target row: {line}")
        idx = int(parts[0])
        if idx < 0 or idx >= vertex_count:
            raise ValueError(f"target vertex {idx} outside base mesh")
        delta = tuple(float(v) * SCALE for v in parts[1:])
        old = out.get(idx, (0.0, 0.0, 0.0))
        out[idx] = tuple(old[a] + delta[a] for a in range(3))
    return out


def merge_targets(parts):
    out = {}
    for part in parts:
        for idx, delta in part.items():
            old = out.get(idx, (0.0, 0.0, 0.0))
            out[idx] = tuple(old[a] + delta[a] for a in range(3))
    return out


def bounds(points):
    mins = [math.inf, math.inf, math.inf]
    maxs = [-math.inf, -math.inf, -math.inf]
    for p in points:
        for a in range(3):
            mins[a] = min(mins[a], p[a])
            maxs[a] = max(maxs[a], p[a])
    return tuple(mins), tuple(maxs)


def average_vertices(vertices, indices, label):
    if not indices:
        raise ValueError(f"rig joint {label} has no vertex references")
    valid = []
    for idx in indices:
        if not isinstance(idx, int) or idx < 0 or idx >= len(vertices):
            raise ValueError(f"rig joint {label} references invalid vertex {idx}")
        valid.append(vertices[idx])
    return tuple(sum(p[a] for p in valid) / len(valid) for a in range(3))


def build_rig(vertices, rig):
    bones = rig.get("bones") or {}
    joint_defs = rig.get("joints") or {}
    if "root" not in bones:
        raise ValueError("MakeHuman default rig is missing root")
    positions = {}
    for bone_name, bone in bones.items():
        head_name = bone.get("head")
        indices = joint_defs.get(head_name)
        if not isinstance(indices, list):
            raise ValueError(f"bone {bone_name} head {head_name} has no joint definition")
        positions[bone_name] = average_vertices(vertices, indices, head_name)
    for slot, bone_name in HUMANOID_MAP.items():
        if bone_name not in bones:
            raise ValueError(f"humanoid mapping {slot}->{bone_name} missing in pinned rig")
    missing = CORE_HUMANOID - set(HUMANOID_MAP)
    if missing:
        raise ValueError(f"candidate mapping omitted core humanoid slots: {sorted(missing)}")
    return bones, positions


def build_skin_weights(vertex_count, bone_names, weight_doc):
    bone_index = {name: i for i, name in enumerate(bone_names)}
    per_vertex = [[] for _ in range(vertex_count)]
    raw = weight_doc.get("weights") or {}
    ignored_bones = []
    for bone_name, pairs in raw.items():
        joint = bone_index.get(bone_name)
        if joint is None:
            ignored_bones.append(bone_name)
            continue
        for pair in pairs:
            if not isinstance(pair, list) or len(pair) != 2:
                raise ValueError(f"invalid weight row for {bone_name}: {pair}")
            idx, weight = int(pair[0]), float(pair[1])
            if idx < 0 or idx >= vertex_count:
                raise ValueError(f"weight {bone_name} references invalid vertex {idx}")
            if weight > 0:
                per_vertex[idx].append((joint, weight))

    root_index = bone_index["root"]
    joints = []
    weights = []
    unassigned = 0
    truncated = 0
    retained_ratios = []
    max_influences = 0
    for influences in per_vertex:
        max_influences = max(max_influences, len(influences))
        if not influences:
            influences = [(root_index, 1.0)]
            unassigned += 1
        influences = sorted(influences, key=lambda item: item[1], reverse=True)
        total_all = sum(w for _, w in influences)
        kept = influences[:4]
        if len(influences) > 4:
            truncated += 1
        total_kept = sum(w for _, w in kept)
        if total_kept <= 0:
            kept = [(root_index, 1.0)]
            total_kept = 1.0
        retained_ratios.append(total_kept / total_all if total_all > 0 else 1.0)
        ids = [joint for joint, _ in kept]
        ws = [weight / total_kept for _, weight in kept]
        ids += [0] * (4 - len(ids))
        ws += [0.0] * (4 - len(ws))
        joints.append(tuple(ids))
        weights.append(tuple(ws))
    return joints, weights, {
        "ignoredWeightBones": sorted(ignored_bones),
        "unassignedVertexCount": unassigned,
        "verticesWithMoreThan4Influences": truncated,
        "maxRawInfluencesPerVertex": max_influences,
        "meanRetainedRawWeightRatio": sum(retained_ratios) / len(retained_ratios),
        "minimumRetainedRawWeightRatio": min(retained_ratios),
    }


def align4(buf: bytearray, pad: int = 0):
    while len(buf) % 4:
        buf.append(pad)


def inverse_translation_matrix(p):
    x, y, z = p
    # glTF MAT4 is column-major.
    return (
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        -x, -y, -z, 1.0,
    )


def make_glb(vertices, triangles, morphs, rig_bones, bone_positions, joints4, weights4):
    binary = bytearray()
    views = []
    accessors = []

    def add_view(payload: bytes, target=None):
        align4(binary)
        offset = len(binary)
        binary.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        views.append(view)
        return len(views) - 1

    def add_accessor(view, component_type, count, kind, lo=None, hi=None):
        acc = {
            "bufferView": view,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": kind,
        }
        if lo is not None:
            acc["min"] = list(lo)
        if hi is not None:
            acc["max"] = list(hi)
        accessors.append(acc)
        return len(accessors) - 1

    pos_payload = b"".join(struct.pack("<3f", *p) for p in vertices)
    lo, hi = bounds(vertices)
    pos = add_accessor(add_view(pos_payload, 34962), 5126, len(vertices), "VEC3", lo, hi)

    flat_indices = [idx for tri in triangles for idx in tri]
    idx_payload = b"".join(struct.pack("<I", idx) for idx in flat_indices)
    indices = add_accessor(
        add_view(idx_payload, 34963), 5125, len(flat_indices), "SCALAR",
        [min(flat_indices)], [max(flat_indices)],
    )

    joints_payload = b"".join(struct.pack("<4H", *row) for row in joints4)
    joints_acc = add_accessor(add_view(joints_payload, 34962), 5123, len(joints4), "VEC4")
    weights_payload = b"".join(struct.pack("<4f", *row) for row in weights4)
    weights_acc = add_accessor(add_view(weights_payload, 34962), 5126, len(weights4), "VEC4")

    target_accessors = []
    target_names = []
    for name, target in morphs:
        deltas = [target.get(i, (0.0, 0.0, 0.0)) for i in range(len(vertices))]
        payload = b"".join(struct.pack("<3f", *d) for d in deltas)
        dlo, dhi = bounds(deltas)
        target_accessors.append(
            add_accessor(add_view(payload, 34962), 5126, len(vertices), "VEC3", dlo, dhi)
        )
        target_names.append(name)

    bone_names = list(rig_bones.keys())
    bone_to_joint = {name: i for i, name in enumerate(bone_names)}
    ibm_payload = b"".join(
        struct.pack("<16f", *inverse_translation_matrix(bone_positions[name]))
        for name in bone_names
    )
    ibm_acc = add_accessor(add_view(ibm_payload), 5126, len(bone_names), "MAT4")

    # Node 0 is the skinned mesh. Bone nodes follow in exact skin-joint order.
    bone_node_index = {name: i + 1 for i, name in enumerate(bone_names)}
    nodes = [{"name": "MakeHumanCoreCandidateMesh", "mesh": 0, "skin": 0}]
    child_map = {name: [] for name in bone_names}
    roots = []
    for name in bone_names:
        parent = rig_bones[name].get("parent")
        if parent in child_map:
            child_map[parent].append(name)
        else:
            roots.append(name)
    for name in bone_names:
        parent = rig_bones[name].get("parent")
        global_pos = bone_positions[name]
        if parent in bone_positions:
            parent_pos = bone_positions[parent]
            local = [global_pos[a] - parent_pos[a] for a in range(3)]
        else:
            local = list(global_pos)
        node = {"name": name, "translation": local}
        children = child_map[name]
        if children:
            node["children"] = [bone_node_index[child] for child in children]
        nodes.append(node)

    human_bones = [
        {"bone": slot, "node": bone_node_index[bone_name], "useDefaultValues": True}
        for slot, bone_name in HUMANOID_MAP.items()
    ]

    vrm_extension = {
        "exporterVersion": "ZhixingOS-direct-core-candidate/1",
        "specVersion": "0.0",
        "meta": {
            "title": "ZhixingOS MakeHuman Core Rigged Candidate",
            "version": "research-v1",
            "author": "MakeHuman Community core assets; ZhixingOS deterministic packaging",
            "contactInformation": "",
            "reference": f"{UPSTREAM_REPO}@{UPSTREAM_COMMIT}",
            "texture": -1,
            "allowedUserName": "Everyone",
            "violentUssageName": "Disallow",
            "sexualUssageName": "Disallow",
            "commercialUssageName": "Allow",
            "otherPermissionUrl": "https://static.makehumancommunity.org/about/license.html",
            "licenseName": "CC0",
            "otherLicenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
        },
        "humanoid": {
            "humanBones": human_bones,
            "armStretch": 0.05,
            "legStretch": 0.05,
            "upperArmTwist": 0.5,
            "lowerArmTwist": 0.5,
            "upperLegTwist": 0.5,
            "lowerLegTwist": 0.5,
            "feetSpacing": 0.0,
            "hasTranslationDoF": False,
        },
        "firstPerson": {
            "firstPersonBone": bone_node_index[HUMANOID_MAP["head"]],
            "firstPersonBoneOffset": {"x": 0.0, "y": 0.06, "z": 0.0},
            "meshAnnotations": [{"mesh": 0, "firstPersonFlag": "Auto"}],
            "lookAtTypeName": "Bone",
            "lookAtHorizontalInner": {"curve": [0, 0, 0, 1, 1, 1, 1, 1], "xRange": 90, "yRange": 10},
            "lookAtHorizontalOuter": {"curve": [0, 0, 0, 1, 1, 1, 1, 1], "xRange": 90, "yRange": 10},
            "lookAtVerticalDown": {"curve": [0, 0, 0, 1, 1, 1, 1, 1], "xRange": 90, "yRange": 10},
            "lookAtVerticalUp": {"curve": [0, 0, 0, 1, 1, 1, 1, 1], "xRange": 90, "yRange": 10},
        },
        # Structural identity targets are intentionally custom, not expression presets.
        "blendShapeMaster": {"blendShapeGroups": []},
        "secondaryAnimation": {"boneGroups": [], "colliderGroups": []},
        "materialProperties": [],
    }

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "ZhixingOS pinned MakeHuman rigged VRM candidate builder",
            "copyright": "MakeHuman bundled/core assets: CC0",
        },
        "extensionsUsed": ["KHR_materials_unlit", "VRM"],
        "extensionsRequired": ["KHR_materials_unlit"],
        "extensions": {"VRM": vrm_extension},
        "scene": 0,
        "scenes": [{"nodes": [0] + [bone_node_index[name] for name in roots]}],
        "nodes": nodes,
        "meshes": [{
            "name": "MakeHumanCore_SKIN",
            "weights": [0.0] * len(target_names),
            "extras": {
                "targetNames": target_names,
                "researchOnly": True,
                "sourceCommit": UPSTREAM_COMMIT,
            },
            "primitives": [{
                "attributes": {
                    "POSITION": pos,
                    "JOINTS_0": joints_acc,
                    "WEIGHTS_0": weights_acc,
                },
                "indices": indices,
                "mode": 4,
                "material": 0,
                "targets": [{"POSITION": accessor} for accessor in target_accessors],
            }],
        }],
        "skins": [{
            "name": "MakeHumanDefaultRig",
            "inverseBindMatrices": ibm_acc,
            "skeleton": bone_node_index["root"],
            "joints": [bone_node_index[name] for name in bone_names],
        }],
        "materials": [{
            "name": "MakeHuman_Core_SKIN",
            "extensions": {"KHR_materials_unlit": {}},
            "doubleSided": True,
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.67, 0.49, 0.40, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
        }],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
        "extras": {
            "researchOnly": True,
            "warning": "Rig/morph/render compatibility candidate only; not anthropometric or personal identity validation.",
            "upstreamRepository": UPSTREAM_REPO,
            "upstreamCommit": UPSTREAM_COMMIT,
        },
    }

    json_chunk = bytearray(json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode())
    align4(json_chunk, 0x20)
    align4(binary)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    glb = b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<II", len(json_chunk), 0x4E4F534A), bytes(json_chunk),
        struct.pack("<II", len(binary), 0x004E4942), bytes(binary),
    ])
    return glb, {
        "boneCount": len(bone_names),
        "humanoidSlotCount": len(human_bones),
        "rootBones": roots,
        "skinJointCount": len(bone_names),
        "meshTargetNames": target_names,
        "boneIndexRange": [0, len(bone_names) - 1],
    }


def target_stats(target):
    mags = [math.sqrt(sum(v * v for v in delta)) for delta in target.values()]
    return {
        "affectedVertexCount": len(mags),
        "maxDisplacementMetres": max(mags) if mags else 0.0,
        "rmsDisplacementMetres": math.sqrt(sum(v * v for v in mags) / len(mags)) if mags else 0.0,
    }


def build(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    resources = []

    base_bytes, row = fetch_verified(*BASE); resources.append(row)
    rig_bytes, row = fetch_verified(*RIG); resources.append(row)
    weight_bytes, row = fetch_verified(*WEIGHTS); resources.append(row)

    vertices, triangles = parse_obj(base_bytes.decode("utf-8"))
    rig = json.loads(rig_bytes.decode("utf-8"))
    weight_doc = json.loads(weight_bytes.decode("utf-8"))
    if weight_doc.get("license") != "CC0":
        raise RuntimeError(f"pinned default weights lost expected CC0 declaration: {weight_doc.get('license')}")

    rig_bones, bone_positions = build_rig(vertices, rig)
    bone_names = list(rig_bones.keys())
    joints4, weights4, skin_stats = build_skin_weights(len(vertices), bone_names, weight_doc)

    built_morphs = []
    morph_report = []
    for name, family, sources in MORPHS:
        parts = []
        paths = []
        for source in sources:
            data, row = fetch_verified(*source); resources.append(row)
            paths.append(row["path"])
            parts.append(parse_target(data.decode("utf-8"), len(vertices)))
        target = merge_targets(parts)
        stats = target_stats(target)
        if stats["affectedVertexCount"] < 10 or stats["maxDisplacementMetres"] <= 0:
            raise RuntimeError(f"{name} did not preserve real vertex deltas: {stats}")
        built_morphs.append((name, target))
        morph_report.append({"name": name, "family": family, "sources": paths, **stats})

    glb, rig_report = make_glb(
        vertices, triangles, built_morphs, rig_bones, bone_positions, joints4, weights4
    )
    out = output_dir / "MakeHuman_Core_Rigged_Candidate.vrm"
    out.write_bytes(glb)
    lo, hi = bounds(vertices)
    report = {
        "researchOnly": True,
        "warning": "Loadable rigged VRM candidate evidence only; not production, anthropometric correctness, or personal identity correctness.",
        "upstream": {
            "repository": UPSTREAM_REPO,
            "commit": UPSTREAM_COMMIT,
            "licenseScope": "Only pinned MakeHuman bundled/core geometry, default rig/weights and target files; no community assets.",
            "resources": resources,
        },
        "baseMesh": {
            "vertexCount": len(vertices),
            "triangleCount": len(triangles),
            "boundsMetres": {"min": lo, "max": hi},
        },
        "rig": rig_report,
        "skin": skin_stats,
        "morphs": morph_report,
        "candidate": {
            "path": out.name,
            "bytes": len(glb),
            "sha256": hashlib.sha256(glb).hexdigest(),
        },
        "knownMissingForProduction": [
            "verified blink/expression morphs",
            "production-quality hair materials/assets",
            "production-quality outfit materials/assets",
            "mobile Web renderer frame-time measurement",
            "Android native compile/device evidence",
            "iOS native compile/device evidence",
            "anthropometric validation",
            "personal resemblance validation",
        ],
    }
    (output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (output_dir / "README.txt").write_text(
        "Research-only CI artifact. This candidate contains pinned MakeHuman CC0 core geometry, default rig/weights and four structural morph channels. It is not shipped by ZhixingOS.\n",
        encoding="utf-8",
    )
    return report


def self_test():
    vertices, triangles = parse_obj("v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n")
    assert vertices[1][0] == 1.0
    assert triangles == [(0, 1, 2)]
    rig = {
        "bones": {"root": {"head": "r", "parent": None}},
        "joints": {"r": [0, 1]},
    }
    # Mapping validation intentionally fails for a toy rig; lower-level joint averaging still works.
    assert average_vertices(vertices, [0, 1], "r") == (0.5, 0.0, 0.0)
    target = parse_target("1 1 0 0\n", len(vertices))
    assert abs(target[1][0] - 0.1) < 1e-9
    weights = {"weights": {"root": [[0, 1], [1, 1], [2, 1]]}}
    j, w, stats = build_skin_weights(3, ["root"], weights)
    assert j[0][0] == 0 and w[0][0] == 1.0 and stats["unassignedVertexCount"] == 0
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, "ok.txt").write_text("ok")
    print("[makehuman-rigged-candidate] self-test passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="artifacts/makehuman-rigged-candidate")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    report = build(Path(args.output_dir))
    print("[makehuman-rigged-candidate]", json.dumps({
        "upstreamCommit": report["upstream"]["commit"],
        "baseMesh": report["baseMesh"],
        "rig": report["rig"],
        "skin": report["skin"],
        "morphs": [{"name": m["name"], "affectedVertexCount": m["affectedVertexCount"]} for m in report["morphs"]],
        "candidate": report["candidate"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
