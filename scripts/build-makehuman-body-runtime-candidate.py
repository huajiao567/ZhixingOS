#!/usr/bin/env python3
"""Build a clean-body, runtime-equivalent MakeHuman research candidate.

This derivative intentionally does not replace the existing canonical research builder or
production AvatarSample_G. It uses the same pinned MakeHuman CC0 sources but:

1. exports only OBJ group `body`, excluding helper-* fitting meshes and joint-* locator cubes;
2. compacts body vertices and remaps the four pinned structural morphs;
3. aggregates weights from non-humanoid helper bones to their nearest VRM-humanoid ancestor
   before the glTF four-influence limit is applied.

The weight aggregation is runtime-equivalent only for the current ZhixingOS motion model:
collapsed helper bones retain bind/local transforms and receive no independent animation.
This is a research renderer candidate, not identity/anthropometric correctness evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def body_geometry(text: str, scale: float):
    vertices = []
    active_groups = ["__ungrouped__"]
    source_triangles = []
    body_triangles_source = []

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("v "):
            _, x, y, z, *_ = line.split()
            vertices.append((float(x) * scale, float(y) * scale, float(z) * scale))
            continue
        if line.startswith("g "):
            active_groups = line.split()[1:] or ["__ungrouped__"]
            continue
        if line.startswith("o "):
            name = line[2:].strip() or "__unnamed__"
            active_groups = [f"object:{name}"]
            continue
        if not line.startswith("f "):
            continue

        ids = []
        for ref in line.split()[1:]:
            token = ref.split("/", 1)[0]
            idx = int(token)
            idx = idx - 1 if idx > 0 else len(vertices) + idx
            if idx < 0 or idx >= len(vertices):
                raise ValueError(f"OBJ face index out of range: {line}")
            ids.append(idx)
        for i in range(1, len(ids) - 1):
            tri = (ids[0], ids[i], ids[i + 1])
            source_triangles.append(tri)
            if "body" in active_groups:
                body_triangles_source.append(tri)

    if not vertices or not body_triangles_source:
        raise ValueError("pinned OBJ has no body geometry")
    body_source_indices = sorted({idx for tri in body_triangles_source for idx in tri})
    remap = {source: local for local, source in enumerate(body_source_indices)}
    body_vertices = [vertices[source] for source in body_source_indices]
    body_triangles = [tuple(remap[idx] for idx in tri) for tri in body_triangles_source]
    return {
        "sourceVertices": vertices,
        "sourceTriangles": source_triangles,
        "bodySourceIndices": body_source_indices,
        "bodyRemap": remap,
        "bodyVertices": body_vertices,
        "bodyTriangles": body_triangles,
    }


def pack_collapsed_weights(collapsed_full, body_source_indices, bone_names):
    bone_index = {name: index for index, name in enumerate(bone_names)}
    root_index = bone_index["root"]
    joints4 = []
    weights4 = []
    retained = []
    truncated = 0
    max_influences = 0
    unassigned = 0

    for source_index in body_source_indices:
        influences = list(collapsed_full[source_index])
        if not influences:
            influences = [("root", 1.0)]
            unassigned += 1
        unknown = sorted({name for name, _ in influences if name not in bone_index})
        if unknown:
            raise ValueError(f"collapsed weights reference bones outside pinned rig: {unknown}")
        influences.sort(key=lambda item: item[1], reverse=True)
        max_influences = max(max_influences, len(influences))
        total_all = sum(weight for _, weight in influences)
        kept = influences[:4]
        if len(influences) > 4:
            truncated += 1
        kept_total = sum(weight for _, weight in kept)
        if kept_total <= 0:
            kept = [("root", 1.0)]
            total_all = kept_total = 1.0
        retained.append(kept_total / total_all if total_all > 0 else 1.0)
        ids = [bone_index[name] for name, _ in kept]
        ws = [weight / kept_total for _, weight in kept]
        ids += [root_index] * (4 - len(ids))
        ws += [0.0] * (4 - len(ws))
        joints4.append(tuple(ids))
        weights4.append(tuple(ws))

    return joints4, weights4, {
        "strategy": "non-humanoid helper weights -> nearest VRM-humanoid ancestor, then top-4",
        "animationEquivalenceAssumption": "collapsed helper bones retain bind/local transforms and receive no independent runtime animation",
        "unassignedVertexCount": unassigned,
        "verticesWithMoreThan4Influences": truncated,
        "maxRawInfluencesPerVertexAfterCollapse": max_influences,
        "meanRetainedRawWeightRatio": sum(retained) / len(retained),
        "minimumRetainedRawWeightRatio": min(retained),
        "provisionalMinimumRetainedWeightGate": 0.85,
        "provisionalMinimumRetainedWeightGatePass": min(retained) >= 0.85,
    }


def build(output_dir: Path):
    builder = load_module(HERE / "build-makehuman-vrm-candidate.py", "zhixing_makehuman_builder_clean")
    audit = load_module(HERE / "audit-makehuman-runtime-skinning.py", "zhixing_makehuman_skinning_clean")
    output_dir.mkdir(parents=True, exist_ok=True)
    resources = []

    base_bytes, row = builder.fetch_verified(*builder.BASE); resources.append(row)
    rig_bytes, row = builder.fetch_verified(*builder.RIG); resources.append(row)
    weight_bytes, row = builder.fetch_verified(*builder.WEIGHTS); resources.append(row)
    geometry = body_geometry(base_bytes.decode("utf-8"), builder.SCALE)
    source_vertices = geometry["sourceVertices"]
    body_indices = geometry["bodySourceIndices"]
    body_vertices = geometry["bodyVertices"]
    body_triangles = geometry["bodyTriangles"]
    remap = geometry["bodyRemap"]

    rig = json.loads(rig_bytes.decode("utf-8"))
    weight_doc = json.loads(weight_bytes.decode("utf-8"))
    if weight_doc.get("license") != "CC0":
        raise RuntimeError(f"pinned default weights lost expected CC0 declaration: {weight_doc.get('license')}")

    # Rig joint landmarks intentionally use the full pinned source mesh. The body vertex
    # buffer is compacted only after those authored landmark positions are resolved.
    rig_bones, bone_positions = builder.build_rig(source_vertices, rig)
    bone_names = list(rig_bones.keys())

    per_vertex = audit.collect_per_vertex(len(source_vertices), weight_doc)
    controlled = set(builder.HUMANOID_MAP.values()) | {"root"}
    collapsed, collapse_details = audit.collapse_to_humanoid_ancestors(
        per_vertex,
        rig.get("bones") or {},
        controlled,
    )
    joints4, weights4, skin_stats = pack_collapsed_weights(collapsed, body_indices, bone_names)
    if skin_stats["provisionalMinimumRetainedWeightGatePass"] is not True:
        raise RuntimeError(f"clean-body candidate still fails the 0.85 retained-weight gate: {skin_stats}")

    built_morphs = []
    morph_report = []
    for name, family, sources in builder.MORPHS:
        parts = []
        paths = []
        for source in sources:
            data, row = builder.fetch_verified(*source); resources.append(row)
            paths.append(row["path"])
            parts.append(builder.parse_target(data.decode("utf-8"), len(source_vertices)))
        source_target = builder.merge_targets(parts)
        body_target = {
            remap[source_index]: delta
            for source_index, delta in source_target.items()
            if source_index in remap
        }
        stats = builder.target_stats(body_target)
        if stats["affectedVertexCount"] < 10 or stats["maxDisplacementMetres"] <= 0:
            raise RuntimeError(f"body-only {name} did not preserve real vertex deltas: {stats}")
        built_morphs.append((name, body_target))
        morph_report.append({
            "name": name,
            "family": family,
            "sources": paths,
            "sourceAffectedVertexCount": len(source_target),
            "removedHelperAffectedVertexCount": len(source_target) - len(body_target),
            **stats,
        })

    glb, rig_report = builder.make_glb(
        body_vertices,
        body_triangles,
        built_morphs,
        rig_bones,
        bone_positions,
        joints4,
        weights4,
    )
    out = output_dir / "MakeHuman_Core_Body_RuntimeSkinning_Candidate.vrm"
    out.write_bytes(glb)
    lo, hi = builder.bounds(body_vertices)
    report = {
        "researchOnly": True,
        "warning": "Clean-body runtime compatibility candidate only; not a production model or identity/anthropometric validation.",
        "upstream": {
            "repository": builder.UPSTREAM_REPO,
            "commit": builder.UPSTREAM_COMMIT,
            "licenseScope": "Pinned MakeHuman bundled/core CC0 geometry, default rig/weights and target files only.",
            "resources": resources,
        },
        "geometry": {
            "sourceVertexCount": len(source_vertices),
            "sourceTriangleCount": len(geometry["sourceTriangles"]),
            "exportedObjGroup": "body",
            "vertexCount": len(body_vertices),
            "triangleCount": len(body_triangles),
            "removedSourceVertexCount": len(source_vertices) - len(body_vertices),
            "removedSourceTriangleCount": len(geometry["sourceTriangles"]) - len(body_triangles),
            "boundsMetres": {"min": lo, "max": hi},
        },
        "rig": rig_report,
        "skin": skin_stats,
        "collapse": {
            "controlledBoneCount": collapse_details["controlledBoneCount"],
            "sourceBoneCount": collapse_details["sourceBoneCount"],
            "changedVertexCountAcrossFullSource": collapse_details["changedVertexCount"],
            "changedWeightMassFractionAcrossFullSource": collapse_details["changedWeightMassFraction"],
        },
        "morphs": morph_report,
        "candidate": {
            "path": out.name,
            "bytes": len(glb),
            "sha256": hashlib.sha256(glb).hexdigest(),
        },
        "productionReplacementPass": False,
        "knownMissingForProduction": [
            "production-quality eyes and eyelids",
            "verified blink/expression morph parity",
            "production-quality hair materials/assets",
            "production-quality outfit materials/assets",
            "representative mobile GPU frame-time measurement",
            "Android native compile/device evidence",
            "iOS native compile/device evidence",
            "anthropometric validation",
            "personal resemblance validation",
        ],
    }
    (output_dir / "clean-body-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def self_test():
    sample = "\n".join([
        "v 0 0 0",
        "v 10 0 0",
        "v 0 10 0",
        "v 0 0 10",
        "g body",
        "f 1 2 3",
        "g helper-hair",
        "f 1 3 4",
    ])
    result = body_geometry(sample, 0.1)
    assert result["bodySourceIndices"] == [0, 1, 2]
    assert result["bodyTriangles"] == [(0, 1, 2)]
    collapsed = [[("root", 0.7), ("head", 0.3)], [("root", 1.0)], [("head", 1.0)], [("root", 1.0)]]
    joints, weights, stats = pack_collapsed_weights(collapsed, [0, 1, 2], ["root", "head"])
    assert joints[0][:2] == (0, 1)
    assert abs(sum(weights[0]) - 1.0) < 1e-9
    assert stats["minimumRetainedRawWeightRatio"] == 1.0
    print("[makehuman-clean-body-candidate] self-test passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="artifacts/makehuman-clean-body-candidate")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    report = build(Path(args.output_dir))
    print("[makehuman-clean-body-candidate]", json.dumps({
        "upstreamCommit": report["upstream"]["commit"],
        "geometry": report["geometry"],
        "skin": report["skin"],
        "morphs": [
            {"name": row["name"], "affectedVertexCount": row["affectedVertexCount"], "removedHelperAffectedVertexCount": row["removedHelperAffectedVertexCount"]}
            for row in report["morphs"]
        ],
        "candidate": report["candidate"],
        "productionReplacementPass": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
