#!/usr/bin/env python3
"""Audit a runtime-aware four-influence skinning reduction for the pinned MakeHuman candidate.

The current research candidate keeps the four largest raw MakeHuman weights per vertex.
That is conservative, but it discards weight carried by helper bones even when those
helpers have no independent animation channel in ZhixingOS. This audit does NOT change
candidate bytes. It measures an alternative: aggregate each non-humanoid helper bone
into its nearest VRM-humanoid ancestor, then evaluate the four-influence retention.

The aggregation is only animation-equivalent while collapsed helper bones keep their
bind/local transform and are not independently animated. The report therefore records
that assumption explicitly and must not be used as anthropometric or visual-quality
proof.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

BUILDER_PATH = Path(__file__).with_name("build-makehuman-vrm-candidate.py")


def load_builder():
    spec = importlib.util.spec_from_file_location("zhixing_makehuman_builder", BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load candidate builder: {BUILDER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 1.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return ordered[lo]
    f = pos - lo
    return ordered[lo] * (1.0 - f) + ordered[hi] * f


def collect_per_vertex(vertex_count: int, weights_doc: dict) -> list[list[tuple[str, float]]]:
    per_vertex: list[list[tuple[str, float]]] = [[] for _ in range(vertex_count)]
    for bone_name, pairs in (weights_doc.get("weights") or {}).items():
        for pair in pairs:
            if not isinstance(pair, list) or len(pair) != 2:
                raise ValueError(f"invalid weight row for {bone_name}: {pair}")
            vertex, weight = int(pair[0]), float(pair[1])
            if vertex < 0 or vertex >= vertex_count:
                raise ValueError(f"weight {bone_name} references invalid vertex {vertex}")
            if weight > 0:
                per_vertex[vertex].append((bone_name, weight))
    return per_vertex


def summarize(per_vertex: list[list[tuple[str, float]]], root: str = "root") -> tuple[dict, list[dict]]:
    ratios: list[float] = []
    influence_counts: list[int] = []
    worst: list[dict] = []
    for vertex, raw in enumerate(per_vertex):
        influences = raw or [(root, 1.0)]
        ordered = sorted(influences, key=lambda row: row[1], reverse=True)
        total = sum(weight for _, weight in ordered)
        kept = ordered[:4]
        kept_sum = sum(weight for _, weight in kept)
        ratio = kept_sum / total if total > 0 else 1.0
        ratios.append(ratio)
        influence_counts.append(len(ordered))
        worst.append({
            "vertex": vertex,
            "retainedRatio": ratio,
            "rawInfluenceCount": len(ordered),
            "influences": [
                {"bone": bone, "weight": weight}
                for bone, weight in ordered
            ],
        })
    worst.sort(key=lambda row: (row["retainedRatio"], -row["rawInfluenceCount"], row["vertex"]))
    return {
        "vertexCount": len(per_vertex),
        "verticesWithMoreThan4Influences": sum(1 for count in influence_counts if count > 4),
        "maxInfluencesPerVertex": max(influence_counts, default=0),
        "meanRetainedRawWeightRatio": sum(ratios) / len(ratios) if ratios else 1.0,
        "minimumRetainedRawWeightRatio": min(ratios, default=1.0),
        "p01RetainedRawWeightRatio": percentile(ratios, 0.01),
        "p05RetainedRawWeightRatio": percentile(ratios, 0.05),
        "p50RetainedRawWeightRatio": percentile(ratios, 0.50),
        "verticesBelow085": sum(1 for ratio in ratios if ratio < 0.85),
        "verticesBelow095": sum(1 for ratio in ratios if ratio < 0.95),
        "verticesBelow099": sum(1 for ratio in ratios if ratio < 0.99),
    }, worst[:25]


def collapse_to_humanoid_ancestors(
    per_vertex: list[list[tuple[str, float]]],
    bones: dict,
    controlled_bones: set[str],
) -> tuple[list[list[tuple[str, float]]], dict]:
    cache: dict[str, str] = {}

    def target_for(name: str) -> str:
        if name in cache:
            return cache[name]
        current: str | None = name
        seen: set[str] = set()
        while current is not None:
            if current in seen:
                raise ValueError(f"bone parent cycle while resolving {name}: {current}")
            seen.add(current)
            if current in controlled_bones:
                cache[name] = current
                return current
            bone = bones.get(current)
            if not isinstance(bone, dict):
                break
            parent = bone.get("parent")
            current = str(parent) if parent is not None else None
        if "root" not in controlled_bones:
            raise ValueError(f"no controlled ancestor for {name} and root is not controlled")
        cache[name] = "root"
        return "root"

    collapsed: list[list[tuple[str, float]]] = []
    source_bone_mass: Counter[str] = Counter()
    collapsed_bone_mass: Counter[str] = Counter()
    changed_vertices = 0
    changed_weight_mass = 0.0
    total_weight_mass = 0.0
    source_bones_changed: Counter[str] = Counter()

    for influences in per_vertex:
        grouped: defaultdict[str, float] = defaultdict(float)
        changed = False
        for bone_name, weight in influences:
            target = target_for(bone_name)
            grouped[target] += weight
            source_bone_mass[bone_name] += weight
            collapsed_bone_mass[target] += weight
            total_weight_mass += weight
            if target != bone_name:
                changed = True
                changed_weight_mass += weight
                source_bones_changed[bone_name] += weight
        if changed:
            changed_vertices += 1
        collapsed.append(list(grouped.items()))

    collapse_map = {name: target_for(name) for name in bones}
    return collapsed, {
        "controlledBoneCount": len(controlled_bones),
        "sourceBoneCount": len(bones),
        "changedVertexCount": changed_vertices,
        "changedWeightMassFraction": changed_weight_mass / total_weight_mass if total_weight_mass else 0.0,
        "collapsedSourceBoneCount": sum(1 for name, target in collapse_map.items() if name != target),
        "collapseMap": collapse_map,
        "largestCollapsedSourceBonesByWeightMass": [
            {"bone": name, "weightMass": mass, "target": collapse_map[name]}
            for name, mass in source_bones_changed.most_common(25)
        ],
        "largestResultBonesByWeightMass": [
            {"bone": name, "weightMass": mass}
            for name, mass in collapsed_bone_mass.most_common(25)
        ],
    }


def self_test() -> None:
    per_vertex = [[("helper", 0.35), ("hand", 0.30), ("arm", 0.20), ("root", 0.10), ("other", 0.05)]]
    bones = {
        "root": {"parent": None},
        "arm": {"parent": "root"},
        "helper": {"parent": "arm"},
        "hand": {"parent": "helper"},
        "other": {"parent": "root"},
    }
    collapsed, details = collapse_to_humanoid_ancestors(per_vertex, bones, {"root", "arm", "hand"})
    row = dict(collapsed[0])
    assert abs(row["arm"] - 0.55) < 1e-9
    assert abs(row["hand"] - 0.30) < 1e-9
    assert abs(row["root"] - 0.15) < 1e-9
    assert details["collapseMap"]["helper"] == "arm"
    baseline, _ = summarize(per_vertex)
    reduced, _ = summarize(collapsed)
    assert baseline["minimumRetainedRawWeightRatio"] < 1.0
    assert reduced["minimumRetainedRawWeightRatio"] == 1.0
    print("[makehuman-skinning-audit] self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="artifacts/makehuman-skinning-audit/report.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return

    builder = load_builder()
    base_bytes, base_resource = builder.fetch_verified(*builder.BASE)
    rig_bytes, rig_resource = builder.fetch_verified(*builder.RIG)
    weight_bytes, weight_resource = builder.fetch_verified(*builder.WEIGHTS)
    vertices, _ = builder.parse_obj(base_bytes.decode("utf-8"))
    rig = json.loads(rig_bytes.decode("utf-8"))
    weights_doc = json.loads(weight_bytes.decode("utf-8"))
    if weights_doc.get("license") != "CC0":
        raise RuntimeError(f"expected pinned CC0 weights, got {weights_doc.get('license')}")

    bones = rig.get("bones") or {}
    controlled_bones = set(builder.HUMANOID_MAP.values()) | {"root"}
    missing = sorted(controlled_bones - set(bones))
    if missing:
        raise RuntimeError(f"controlled bones missing from pinned rig: {missing}")

    per_vertex = collect_per_vertex(len(vertices), weights_doc)
    baseline_stats, baseline_worst = summarize(per_vertex)
    collapsed, collapse_details = collapse_to_humanoid_ancestors(per_vertex, bones, controlled_bones)
    collapsed_stats, collapsed_worst = summarize(collapsed)

    report = {
        "researchOnly": True,
        "upstream": {
            "repository": builder.UPSTREAM_REPO,
            "commit": builder.UPSTREAM_COMMIT,
            "resources": [base_resource, rig_resource, weight_resource],
            "weightsLicense": weights_doc.get("license"),
        },
        "policy": {
            "maxInfluences": 4,
            "provisionalMinimumRetainedWeightGate": 0.85,
            "strategy": "aggregate non-humanoid helper weights to nearest VRM-humanoid ancestor before top-4 selection",
            "animationEquivalenceAssumption": "collapsed helper bones keep bind/local transforms and receive no independent animation; only retained humanoid bones are independently driven",
            "notProofOf": [
                "production visual quality",
                "anthropometric correctness",
                "personal resemblance",
                "native or physical-device performance",
            ],
        },
        "baseline": baseline_stats,
        "collapsedToHumanoidAncestors": collapsed_stats,
        "delta": {
            "minimumRetainedRawWeightRatio": collapsed_stats["minimumRetainedRawWeightRatio"] - baseline_stats["minimumRetainedRawWeightRatio"],
            "meanRetainedRawWeightRatio": collapsed_stats["meanRetainedRawWeightRatio"] - baseline_stats["meanRetainedRawWeightRatio"],
            "verticesWithMoreThan4Influences": collapsed_stats["verticesWithMoreThan4Influences"] - baseline_stats["verticesWithMoreThan4Influences"],
            "verticesBelow085": collapsed_stats["verticesBelow085"] - baseline_stats["verticesBelow085"],
        },
        "collapse": collapse_details,
        "baselineWorstVertices": baseline_worst,
        "collapsedWorstVertices": collapsed_worst,
        "candidatePromotionPass": False,
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[makehuman-skinning-audit]", json.dumps({
        "baseline": baseline_stats,
        "collapsed": collapsed_stats,
        "changedVertexCount": collapse_details["changedVertexCount"],
        "changedWeightMassFraction": collapse_details["changedWeightMassFraction"],
        "candidatePromotionPass": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
