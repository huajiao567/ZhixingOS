#!/usr/bin/env python3
"""Trace low-retention MakeHuman skinning vertices back to pinned OBJ groups.

This is diagnostic only. It uses the same pinned source/hash checks as the candidate
builder and runtime-skinning audit, then reports coordinates and all OBJ face groups
incident to vertices that remain below the requested retained-weight threshold after
helper-bone-to-humanoid-ancestor aggregation.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def obj_vertex_groups(text: str, vertex_count: int) -> tuple[dict[int, set[str]], dict[str, int]]:
    groups_by_vertex: dict[int, set[str]] = defaultdict(set)
    face_counts: dict[str, int] = defaultdict(int)
    active_groups = ["__ungrouped__"]

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("g "):
            names = line.split()[1:]
            active_groups = names or ["__ungrouped__"]
            continue
        if line.startswith("o "):
            name = line[2:].strip()
            active_groups = [f"object:{name or '__unnamed__'}"]
            continue
        if not line.startswith("f "):
            continue

        face_counts[" + ".join(active_groups)] += 1
        for ref in line.split()[1:]:
            token = ref.split("/", 1)[0]
            idx = int(token)
            idx = idx - 1 if idx > 0 else vertex_count + idx
            if idx < 0 or idx >= vertex_count:
                raise ValueError(f"OBJ face index out of range: {line}")
            groups_by_vertex[idx].update(active_groups)

    return groups_by_vertex, dict(sorted(face_counts.items()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.85)
    parser.add_argument("--output", default="artifacts/makehuman-skinning-audit/worst-vertex-groups.json")
    args = parser.parse_args()

    builder = load_module(HERE / "build-makehuman-vrm-candidate.py", "zhixing_makehuman_builder_groups")
    audit = load_module(HERE / "audit-makehuman-runtime-skinning.py", "zhixing_makehuman_skinning_audit_groups")

    base_bytes, base_resource = builder.fetch_verified(*builder.BASE)
    rig_bytes, rig_resource = builder.fetch_verified(*builder.RIG)
    weight_bytes, weight_resource = builder.fetch_verified(*builder.WEIGHTS)
    base_text = base_bytes.decode("utf-8")
    vertices, _ = builder.parse_obj(base_text)
    groups, face_counts = obj_vertex_groups(base_text, len(vertices))
    rig = json.loads(rig_bytes.decode("utf-8"))
    weights_doc = json.loads(weight_bytes.decode("utf-8"))

    per_vertex = audit.collect_per_vertex(len(vertices), weights_doc)
    controlled = set(builder.HUMANOID_MAP.values()) | {"root"}
    collapsed, collapse_details = audit.collapse_to_humanoid_ancestors(
        per_vertex,
        rig.get("bones") or {},
        controlled,
    )
    _, worst = audit.summarize(collapsed)
    failing = [row for row in worst if row["retainedRatio"] < args.threshold]

    rows = []
    for row in failing:
        vertex = int(row["vertex"])
        rows.append({
            **row,
            "positionMetres": list(vertices[vertex]),
            "objGroups": sorted(groups.get(vertex) or []),
        })

    group_histogram: dict[str, int] = defaultdict(int)
    for row in rows:
        if not row["objGroups"]:
            group_histogram["__no_face_group__"] += 1
        for group in row["objGroups"]:
            group_histogram[group] += 1

    report = {
        "researchOnly": True,
        "threshold": args.threshold,
        "upstream": {
            "repository": builder.UPSTREAM_REPO,
            "commit": builder.UPSTREAM_COMMIT,
            "resources": [base_resource, rig_resource, weight_resource],
        },
        "failingVertexCount": len(rows),
        "failingGroupHistogram": dict(sorted(group_histogram.items(), key=lambda item: (-item[1], item[0]))),
        "objFaceCountsByGroup": face_counts,
        "failingVertices": rows,
        "collapse": {
            "changedVertexCount": collapse_details["changedVertexCount"],
            "changedWeightMassFraction": collapse_details["changedWeightMassFraction"],
        },
        "candidatePromotionPass": False,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[makehuman-worst-vertex-groups]", json.dumps({
        "failingVertexCount": report["failingVertexCount"],
        "failingGroupHistogram": report["failingGroupHistogram"],
        "candidatePromotionPass": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
