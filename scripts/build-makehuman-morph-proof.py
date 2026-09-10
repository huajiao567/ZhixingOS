#!/usr/bin/env python3
"""Build a CI-only GLB proving real MakeHuman structural target deltas.

The artifact is intentionally NOT a rigged VRM or production avatar. It only
proves that pinned upstream CC0 core targets move real mesh vertices.
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

BASE = ("makehuman/data/3dobjs/base.obj", "d26635e9326e3cca30778fd7b9c00062b03cce09")
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

def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

def fetch_verified(path: str, expected_sha: str, retries: int = 3):
    url = f"{RAW_ROOT}/{path}"
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ZhixingOS-avatar-morph-proof/1.0"})
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
            vertices.append((float(x), float(y), float(z)))
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
        delta = tuple(float(v) for v in parts[1:])
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

def stats(target):
    mags = [math.sqrt(sum(v * v for v in delta)) for delta in target.values()]
    return {
        "affectedVertexCount": len(mags),
        "maxVectorDisplacement": max(mags) if mags else 0.0,
        "rmsVectorDisplacement": math.sqrt(sum(v * v for v in mags) / len(mags)) if mags else 0.0,
    }

def align4(buf: bytearray, pad: int = 0):
    while len(buf) % 4:
        buf.append(pad)

def make_glb(vertices, triangles, morphs):
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
        add_view(idx_payload, 34963),
        5125,
        len(flat_indices),
        "SCALAR",
        [min(flat_indices)],
        [max(flat_indices)],
    )

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

    gltf = {
        "asset": {"version": "2.0", "generator": "ZhixingOS MakeHuman morph-proof builder"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "MakeHumanMorphProofNode"}],
        "meshes": [{
            "name": "MakeHumanMorphProof",
            "weights": [0.0] * len(target_names),
            "extras": {
                "targetNames": target_names,
                "proofOnly": True,
                "sourceCommit": UPSTREAM_COMMIT,
            },
            "primitives": [{
                "attributes": {"POSITION": pos},
                "indices": indices,
                "mode": 4,
                "material": 0,
                "targets": [{"POSITION": a} for a in target_accessors],
            }],
        }],
        "materials": [{
            "name": "MakeHumanProofSurface",
            "doubleSided": True,
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.72, 0.58, 0.48, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
        }],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": views,
        "accessors": accessors,
        "extras": {
            "proofOnly": True,
            "warning": "Structural morph evidence only; not rigged VRM or identity correctness.",
            "upstreamRepository": UPSTREAM_REPO,
            "upstreamCommit": UPSTREAM_COMMIT,
        },
    }

    json_chunk = bytearray(json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode())
    align4(json_chunk, 0x20)
    align4(binary)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    return b"".join([
        struct.pack("<4sII", b"glTF", 2, total),
        struct.pack("<II", len(json_chunk), 0x4E4F534A),
        bytes(json_chunk),
        struct.pack("<II", len(binary), 0x004E4942),
        bytes(binary),
    ])

def write_svg(vertices, morphs, path: Path, exaggeration: float = 8.0):
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="830" viewBox="0 0 900 830">',
        '<rect width="100%" height="100%" fill="white"/>',
        '<style>text{font-family:Arial,sans-serif;fill:#222}.t{font-size:20px;font-weight:700}.l{font-size:16px;font-weight:700}.n{font-size:13px}.b{fill:#777;opacity:.42}.m{fill:#111;opacity:.72}.v{stroke:#555;stroke-width:.7;opacity:.45}</style>',
        '<text x="20" y="24" class="t">MakeHuman structural morph proof</text>',
        f'<text x="20" y="45" class="n">Pinned {UPSTREAM_COMMIT[:12]} · front X/Y · displacement shown {exaggeration:g}x for inspection</text>',
    ]
    for pidx, (name, target) in enumerate(morphs):
        col, row = pidx % 2, pidx // 2
        ox, oy = 20 + col * 445, 65 + row * 380
        ids = sorted(target)
        base = [vertices[i] for i in ids]
        moved = [
            tuple(vertices[i][a] + target[i][a] * exaggeration for a in range(3))
            for i in ids
        ]
        (minx, miny, _), (maxx, maxy, _) = bounds(base + moved)
        sx, sy = max(maxx - minx, 1e-6), max(maxy - miny, 1e-6)
        scale = min(390 / sx, 310 / sy)
        def proj(point):
            return 40 + ox + (point[0] - minx) * scale, oy + 355 - (point[1] - miny) * scale
        svg.append(f'<rect x="{ox}" y="{oy}" width="430" height="370" rx="10" fill="none" stroke="#ccc"/>')
        svg.append(f'<text x="{ox+14}" y="{oy+24}" class="l">{name}</text>')
        svg.append(f'<text x="{ox+14}" y="{oy+44}" class="n">affected vertices: {len(ids)}</text>')
        for b, m in zip(base, moved):
            bx, by = proj(b); mx, my = proj(m)
            svg.append(f'<line x1="{bx:.2f}" y1="{by:.2f}" x2="{mx:.2f}" y2="{my:.2f}" class="v"/>')
            svg.append(f'<circle cx="{bx:.2f}" cy="{by:.2f}" r="1" class="b"/>')
            svg.append(f'<circle cx="{mx:.2f}" cy="{my:.2f}" r="1" class="m"/>')
    svg.append("</svg>")
    path.write_text("\n".join(svg), encoding="utf-8")

def build(output_dir: Path):
    output_dir.mkdir(parents=True, exist_ok=True)
    base_bytes, base_evidence = fetch_verified(*BASE)
    vertices, triangles = parse_obj(base_bytes.decode("utf-8"))
    evidence = [base_evidence]
    built_morphs = []
    report_morphs = []

    for name, family, sources in MORPHS:
        parts = []
        source_rows = []
        for source in sources:
            data, row = fetch_verified(*source)
            evidence.append(row)
            source_rows.append(row["path"])
            parts.append(parse_target(data.decode("utf-8"), len(vertices)))
        target = merge_targets(parts)
        row_stats = stats(target)
        if row_stats["affectedVertexCount"] < 10 or row_stats["maxVectorDisplacement"] <= 0:
            raise RuntimeError(f"{name} did not produce meaningful vertex deltas: {row_stats}")
        built_morphs.append((name, target))
        report_morphs.append({
            "name": name,
            "family": family,
            "sources": source_rows,
            **row_stats,
        })

    glb = make_glb(vertices, triangles, built_morphs)
    glb_path = output_dir / "MakeHuman_StructuralMorphProof.glb"
    glb_path.write_bytes(glb)
    svg_path = output_dir / "MakeHuman_StructuralMorphProof.svg"
    write_svg(vertices, built_morphs, svg_path)
    lo, hi = bounds(vertices)

    report = {
        "proofOnly": True,
        "warning": "Real upstream vertex-delta evidence only; not a VRM, production avatar, anthropometric validation, or personal identity validation.",
        "upstream": {
            "repository": UPSTREAM_REPO,
            "commit": UPSTREAM_COMMIT,
            "licenseScope": "Only pinned MakeHuman bundled/core assets; third-party/community assets are excluded.",
            "resources": evidence,
        },
        "baseMesh": {
            "vertexCount": len(vertices),
            "triangleCount": len(triangles),
            "boundsMin": lo,
            "boundsMax": hi,
        },
        "morphs": report_morphs,
        "glb": {
            "path": glb_path.name,
            "bytes": len(glb),
            "sha256": hashlib.sha256(glb).hexdigest(),
            "namedTargets": [name for name, _ in built_morphs],
        },
        "visualization": {
            "path": svg_path.name,
            "projection": "front x/y",
            "displacementExaggeration": 8.0,
        },
    }
    (output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "README.txt").write_text(
        "CI research artifact only. The GLB contains real pinned MakeHuman structural target deltas, "
        "but is intentionally not rigged/VRM and must not be shipped as the ZhixingOS production avatar.\n",
        encoding="utf-8",
    )
    return report

def self_test():
    obj = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"
    vertices, triangles = parse_obj(obj)
    assert triangles == [(0, 1, 2), (0, 2, 3)]
    target = parse_target("0 0.1 0 0\n2 0 0.2 0\n", 4)
    glb = make_glb(vertices, triangles, [("nose_width", target)])
    assert glb[:4] == b"glTF"
    assert struct.unpack_from("<I", glb, 4)[0] == 2
    assert struct.unpack_from("<I", glb, 8)[0] == len(glb)
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "proof.svg"
        write_svg(vertices, [("nose_width", target)], p)
        assert p.exists()
    print("[makehuman-morph-proof] self-test passed")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="artifacts/makehuman-morph-proof")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    report = build(Path(args.output_dir))
    print("[makehuman-morph-proof]", json.dumps({
        "upstreamCommit": report["upstream"]["commit"],
        "vertexCount": report["baseMesh"]["vertexCount"],
        "triangleCount": report["baseMesh"]["triangleCount"],
        "morphs": [
            {"name": m["name"], "affectedVertexCount": m["affectedVertexCount"]}
            for m in report["morphs"]
        ],
        "glb": report["glb"],
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
