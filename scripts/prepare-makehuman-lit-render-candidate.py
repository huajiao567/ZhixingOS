#!/usr/bin/env python3
"""Derive a lit, normals-complete render candidate from the pinned MakeHuman VRM.

This is a CI-only visualization derivative. It does not add external assets, does not
change the canonical builder output, and must never be treated as a production model.
The source candidate intentionally uses KHR_materials_unlit and no normals; that is
useful for structural compatibility but makes facial geometry almost impossible to
inspect in screenshots. This script computes deterministic smooth base normals plus
morph-normal deltas from the existing CC0 geometry, removes only the unlit material
flag, aligns the MakeHuman forward axis to the production renderer through one scene
wrapper, and writes a separate GLB/VRM artifact for renderer evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
ARRAY_BUFFER = 34962
FLOAT = 5126
UNSIGNED_BYTE = 5121
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125


def align4(buf: bytearray, pad: int = 0) -> None:
    while len(buf) % 4:
        buf.append(pad)


def parse_glb(data: bytes) -> tuple[dict, bytearray]:
    if len(data) < 20:
        raise ValueError("GLB is too small")
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("invalid GLB2 header")
    offset = 12
    document = None
    binary = None
    while offset + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        payload = data[offset:offset + length]
        offset += length
        if kind == JSON_CHUNK:
            document = json.loads(payload.rstrip(b" \t\r\n\0").decode("utf-8"))
        elif kind == BIN_CHUNK:
            binary = bytearray(payload)
    if not isinstance(document, dict) or binary is None:
        raise ValueError("GLB must contain JSON and BIN chunks")
    if len(document.get("buffers") or []) != 1:
        raise ValueError("render derivative currently requires one embedded buffer")
    return document, binary


def accessor_layout(document: dict, accessor_index: int) -> tuple[dict, dict, int, int]:
    accessor = document["accessors"][accessor_index]
    if accessor.get("sparse"):
        raise ValueError("sparse accessors are not supported")
    view = document["bufferViews"][accessor["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise ValueError("only embedded buffer 0 is supported")
    start = int(view.get("byteOffset", 0)) + int(accessor.get("byteOffset", 0))
    stride = int(view.get("byteStride", 0))
    return accessor, view, start, stride


def read_vec3_f32(document: dict, binary: bytes, accessor_index: int) -> list[tuple[float, float, float]]:
    accessor, _, start, stride = accessor_layout(document, accessor_index)
    if accessor.get("componentType") != FLOAT or accessor.get("type") != "VEC3":
        raise ValueError(f"accessor {accessor_index} is not FLOAT VEC3")
    stride = stride or 12
    if stride < 12:
        raise ValueError("invalid VEC3 stride")
    out = []
    for i in range(int(accessor["count"])):
        out.append(struct.unpack_from("<3f", binary, start + i * stride))
    return out


def read_indices(document: dict, binary: bytes, accessor_index: int) -> list[int]:
    accessor, _, start, stride = accessor_layout(document, accessor_index)
    component = accessor.get("componentType")
    formats = {
        UNSIGNED_BYTE: ("<B", 1),
        UNSIGNED_SHORT: ("<H", 2),
        UNSIGNED_INT: ("<I", 4),
    }
    if accessor.get("type") != "SCALAR" or component not in formats:
        raise ValueError(f"accessor {accessor_index} is not an unsigned scalar index accessor")
    fmt, width = formats[component]
    stride = stride or width
    return [struct.unpack_from(fmt, binary, start + i * stride)[0] for i in range(int(accessor["count"]))]


def normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
    mag = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if mag <= 1e-12:
        return (0.0, 1.0, 0.0)
    return (v[0] / mag, v[1] / mag, v[2] / mag)


def compute_normals(
    positions: list[tuple[float, float, float]],
    indices: list[int],
) -> list[tuple[float, float, float]]:
    if len(indices) % 3:
        raise ValueError("triangle index count is not divisible by 3")
    accum = [[0.0, 0.0, 0.0] for _ in positions]
    for i in range(0, len(indices), 3):
        ia, ib, ic = indices[i:i + 3]
        if min(ia, ib, ic) < 0 or max(ia, ib, ic) >= len(positions):
            raise ValueError("triangle references an out-of-range vertex")
        a, b, c = positions[ia], positions[ib], positions[ic]
        ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
        n = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        )
        for idx in (ia, ib, ic):
            accum[idx][0] += n[0]
            accum[idx][1] += n[1]
            accum[idx][2] += n[2]
    return [normalize((row[0], row[1], row[2])) for row in accum]


def append_vec3_accessor(document: dict, binary: bytearray, rows: list[tuple[float, float, float]]) -> int:
    align4(binary)
    offset = len(binary)
    for row in rows:
        binary.extend(struct.pack("<3f", *row))
    view_index = len(document["bufferViews"])
    document["bufferViews"].append({
        "buffer": 0,
        "byteOffset": offset,
        "byteLength": len(rows) * 12,
        "target": ARRAY_BUFFER,
    })
    accessor_index = len(document["accessors"])
    document["accessors"].append({
        "bufferView": view_index,
        "byteOffset": 0,
        "componentType": FLOAT,
        "count": len(rows),
        "type": "VEC3",
    })
    return accessor_index


def remove_unlit(document: dict) -> None:
    for key in ("extensionsUsed", "extensionsRequired"):
        values = document.get(key)
        if isinstance(values, list):
            values = [value for value in values if value != "KHR_materials_unlit"]
            if values:
                document[key] = values
            else:
                document.pop(key, None)
    for material in document.get("materials") or []:
        extensions = material.get("extensions")
        if isinstance(extensions, dict):
            extensions.pop("KHR_materials_unlit", None)
            if not extensions:
                material.pop("extensions", None)
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.88


def align_forward_axis(document: dict) -> int:
    scene_index = int(document.get("scene", 0))
    scenes = document.get("scenes") or []
    if scene_index < 0 or scene_index >= len(scenes):
        raise ValueError("default scene is unavailable for facing-axis alignment")
    scene = scenes[scene_index]
    roots = list(scene.get("nodes") or [])
    if not roots:
        raise ValueError("default scene has no root nodes")
    nodes = document.setdefault("nodes", [])
    wrapper_index = len(nodes)
    nodes.append({
        "name": "ZhixingResearchFacingRoot",
        # glTF quaternions are [x, y, z, w]. 180° around Y maps MakeHuman's
        # front to the production VRM renderer's expected camera-facing axis.
        "rotation": [0.0, 1.0, 0.0, 0.0],
        "children": roots,
        "extras": {"researchOnly": True, "yawDegrees": 180},
    })
    scene["nodes"] = [wrapper_index]
    return wrapper_index


def build_lit_derivative(source: bytes) -> tuple[bytes, dict]:
    document, binary = parse_glb(source)
    meshes = document.get("meshes") or []
    if len(meshes) != 1 or len(meshes[0].get("primitives") or []) != 1:
        raise ValueError("expected the deterministic one-mesh MakeHuman research candidate")
    primitive = meshes[0]["primitives"][0]
    if int(primitive.get("mode", 4)) != 4:
        raise ValueError("expected triangle-list primitive")

    position_accessor = primitive["attributes"]["POSITION"]
    positions = read_vec3_f32(document, binary, position_accessor)
    indices = read_indices(document, binary, primitive["indices"])
    base_normals = compute_normals(positions, indices)
    primitive["attributes"]["NORMAL"] = append_vec3_accessor(document, binary, base_normals)

    morph_reports = []
    targets = primitive.get("targets") or []
    target_names = (meshes[0].get("extras") or {}).get("targetNames") or []
    for target_index, target in enumerate(targets):
        if "POSITION" not in target:
            continue
        deltas = read_vec3_f32(document, binary, target["POSITION"])
        if len(deltas) != len(positions):
            raise ValueError("morph position count does not match base mesh")
        morphed_positions = [
            (p[0] + d[0], p[1] + d[1], p[2] + d[2])
            for p, d in zip(positions, deltas)
        ]
        morphed_normals = compute_normals(morphed_positions, indices)
        normal_deltas = [
            (n[0] - b[0], n[1] - b[1], n[2] - b[2])
            for n, b in zip(morphed_normals, base_normals)
        ]
        target["NORMAL"] = append_vec3_accessor(document, binary, normal_deltas)
        max_delta = max(
            math.sqrt(row[0] * row[0] + row[1] * row[1] + row[2] * row[2])
            for row in normal_deltas
        ) if normal_deltas else 0.0
        morph_reports.append({
            "name": target_names[target_index] if target_index < len(target_names) else f"target-{target_index}",
            "maxNormalDelta": max_delta,
        })

    remove_unlit(document)
    facing_root = align_forward_axis(document)
    document.setdefault("extras", {})["zhixingLitRenderDerivative"] = {
        "researchOnly": True,
        "baseNormals": "area-weighted smooth vertex normals",
        "morphNormals": "recomputed per structural target and stored as glTF normal deltas",
        "material": "standard glTF PBR; KHR_materials_unlit removed for geometry visibility",
        "orientation": "scene roots wrapped and yawed 180 degrees for production renderer facing convention",
    }

    align4(binary)
    document["buffers"][0]["byteLength"] = len(binary)
    json_bytes = bytearray(json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    align4(json_bytes, 0x20)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<II", len(json_bytes), JSON_CHUNK), bytes(json_bytes),
        struct.pack("<II", len(binary), BIN_CHUNK), bytes(binary),
    ])
    report = {
        "researchOnly": True,
        "vertexCount": len(positions),
        "triangleCount": len(indices) // 3,
        "baseNormalCount": len(base_normals),
        "morphNormalTargets": morph_reports,
        "facingAlignment": {"wrapperNode": facing_root, "yawDegrees": 180},
        "inputBytes": len(source),
        "inputSha256": hashlib.sha256(source).hexdigest(),
        "outputBytes": len(output),
        "outputSha256": hashlib.sha256(output).hexdigest(),
        "productionReplacementPass": False,
        "truthBoundary": "lit screenshot derivative only; no new identity correctness, texture, expression, native or device claim",
    }
    return output, report


def self_test() -> None:
    positions = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
    normals = compute_normals(positions, [0, 1, 2])
    assert all(abs(row[2] - 1.0) < 1e-9 for row in normals), normals
    document = {"scene": 0, "scenes": [{"nodes": [0, 1]}], "nodes": [{}, {}]}
    wrapper = align_forward_axis(document)
    assert wrapper == 2
    assert document["scenes"][0]["nodes"] == [2]
    assert document["nodes"][2]["rotation"] == [0.0, 1.0, 0.0, 0.0]
    assert document["nodes"][2]["children"] == [0, 1]
    print("[lit-render-candidate] self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--report")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.input or not args.output:
        parser.error("input and output are required unless --self-test is used")
    source_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output, report = build_lit_derivative(source_path.read_bytes())
    output_path.write_bytes(output)
    report_path = Path(args.report) if args.report else output_path.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[lit-render-candidate]", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
