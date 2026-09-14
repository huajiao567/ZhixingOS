#!/usr/bin/env python3
"""Quantify a body-only MakeHuman research export before changing candidate bytes.

The pinned MakeHuman base OBJ contains the visible `body` group plus helper-* fitting
meshes and joint-* locator cubes. This audit measures the exact vertex/face set reached
by `body`, evaluates raw and runtime-equivalent skinning retention on that set, and
checks how much of each pinned structural morph survives. It is evidence only.
"""

from __future__ import annotations

import argparse
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


def group_faces(text: str, wanted: str) -> tuple[list[tuple[int, int, int]], set[int], dict[str, int]]:
    vertices_seen = 0
    active_groups = ["__ungrouped__"]
    triangles: list[tuple[int, int, int]] = []
    referenced: set[int] = set()
    face_counts: dict[str, int] = {}

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("v "):
            vertices_seen += 1
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

        for group in active_groups:
            face_counts[group] = face_counts.get(group, 0) + 1
        if wanted not in active_groups:
            continue

        ids = []
        for ref in line.split()[1:]:
            token = ref.split("/", 1)[0]
            idx = int(token)
            idx = idx - 1 if idx > 0 else vertices_seen + idx
            if idx < 0 or idx >= vertices_seen:
                raise ValueError(f"OBJ face index out of range: {line}")
            ids.append(idx)
            referenced.add(idx)
        for i in range(1, len(ids) - 1):
            triangles.append((ids[0], ids[i], ids[i + 1]))

    if not triangles or not referenced:
        raise ValueError(f"OBJ group {wanted!r} has no geometry")
    return triangles, referenced, dict(sorted(face_counts.items()))


def subset_weights(per_vertex: list[list[tuple[str, float]]], indices: list[int]):
    return [per_vertex[index] for index in indices]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="artifacts/makehuman-skinning-audit/body-export.json")
    args = parser.parse_args()

    builder = load_module(HERE / "build-makehuman-vrm-candidate.py", "zhixing_makehuman_builder_body")
    audit = load_module(HERE / "audit-makehuman-runtime-skinning.py", "zhixing_makehuman_skinning_body")

    base_bytes, base_resource = builder.fetch_verified(*builder.BASE)
    rig_bytes, rig_resource = builder.fetch_verified(*builder.RIG)
    weight_bytes, weight_resource = builder.fetch_verified(*builder.WEIGHTS)
    base_text = base_bytes.decode("utf-8")
    vertices, all_triangles = builder.parse_obj(base_text)
    body_triangles, body_refs, face_counts = group_faces(base_text, "body")
    body_indices = sorted(body_refs)

    rig = json.loads(rig_bytes.decode("utf-8"))
    weights_doc = json.loads(weight_bytes.decode("utf-8"))
    all_weights = audit.collect_per_vertex(len(vertices), weights_doc)
    controlled = set(builder.HUMANOID_MAP.values()) | {"root"}
    collapsed_all, collapse_details = audit.collapse_to_humanoid_ancestors(
        all_weights,
        rig.get("bones") or {},
        controlled,
    )

    raw_body_stats, raw_body_worst = audit.summarize(subset_weights(all_weights, body_indices))
    collapsed_body_stats, collapsed_body_worst = audit.summarize(subset_weights(collapsed_all, body_indices))

    morph_reports = []
    morph_resources = []
    for morph_name, semantic, sources in builder.MORPHS:
        parsed_parts = []
        resources = []
        for path, sha in sources:
            payload, resource = builder.fetch_verified(path, sha)
            resources.append(resource)
            morph_resources.append(resource)
            parsed_parts.append(builder.parse_target(payload.decode("utf-8"), len(vertices)))
        merged = builder.merge_targets(parsed_parts)
        affected_all = set(merged)
        affected_body = affected_all & body_refs
        nonzero_body = [
            idx for idx in affected_body
            if any(abs(component) > 1e-12 for component in merged[idx])
        ]
        morph_reports.append({
            "name": morph_name,
            "semantic": semantic,
            "sourceAffectedVertexCount": len(affected_all),
            "bodyAffectedVertexCount": len(affected_body),
            "bodyNonzeroVertexCount": len(nonzero_body),
            "removedHelperAffectedVertexCount": len(affected_all - body_refs),
            "bodyCoverageFractionOfSource": len(affected_body) / len(affected_all) if affected_all else 1.0,
            "resources": resources,
        })

    body_min = min(body_indices)
    body_max = max(body_indices)
    contiguous = len(body_indices) == (body_max - body_min + 1)
    report = {
        "researchOnly": True,
        "upstream": {
            "repository": builder.UPSTREAM_REPO,
            "commit": builder.UPSTREAM_COMMIT,
            "resources": [base_resource, rig_resource, weight_resource, *morph_resources],
            "weightsLicense": weights_doc.get("license"),
        },
        "geometry": {
            "sourceVertexCount": len(vertices),
            "sourceTriangleCount": len(all_triangles),
            "bodyObjFaceCount": face_counts.get("body", 0),
            "bodyTriangleCount": len(body_triangles),
            "bodyReferencedVertexCount": len(body_indices),
            "bodyOriginalVertexRange": [body_min, body_max],
            "bodyOriginalVertexRangeContiguous": contiguous,
            "removedVertexCount": len(vertices) - len(body_indices),
            "removedTriangleCount": len(all_triangles) - len(body_triangles),
            "helperObjFaceCount": sum(v for k, v in face_counts.items() if k.startswith("helper-")),
            "jointObjFaceCount": sum(v for k, v in face_counts.items() if k.startswith("joint-")),
        },
        "rawBodyTop4": raw_body_stats,
        "collapsedBodyTop4": collapsed_body_stats,
        "collapsedBodyWorstVerticesLocalIndex": raw_body_worst[:0] + collapsed_body_worst,
        "morphs": morph_reports,
        "collapse": {
            "changedVertexCountAcrossFullSource": collapse_details["changedVertexCount"],
            "changedWeightMassFractionAcrossFullSource": collapse_details["changedWeightMassFraction"],
        },
        "provisionalGate": {
            "minimumRetainedWeight": 0.85,
            "collapsedBodyPass": collapsed_body_stats["minimumRetainedRawWeightRatio"] >= 0.85,
            "allStructuralMorphsStillAffectBody": all(row["bodyNonzeroVertexCount"] > 0 for row in morph_reports),
        },
        "candidatePromotionPass": False,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[makehuman-body-export-audit]", json.dumps({
        "geometry": report["geometry"],
        "rawBodyTop4": raw_body_stats,
        "collapsedBodyTop4": collapsed_body_stats,
        "morphs": [
            {"name": row["name"], "bodyNonzeroVertexCount": row["bodyNonzeroVertexCount"], "removedHelperAffectedVertexCount": row["removedHelperAffectedVertexCount"]}
            for row in morph_reports
        ],
        "provisionalGate": report["provisionalGate"],
        "candidatePromotionPass": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
