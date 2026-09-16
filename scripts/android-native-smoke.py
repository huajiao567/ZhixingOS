#!/usr/bin/env python3
"""Small deterministic UIAutomator driver for ZhixingOS Android smoke CI.

This is intentionally not a general device automation framework.  It drives only
accessibility-labelled controls that already exist in the product UI, and keeps
all interaction at the Android input layer (no React/store injection).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

REMOTE_DUMP = "/sdcard/zhixingos-window.xml"
LOCAL_DUMP = Path("artifacts/android-native/window.xml")


def run(*args: str, capture: bool = False) -> str:
    proc = subprocess.run(
        ["adb", *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return proc.stdout if capture else ""


def dump() -> ET.Element:
    LOCAL_DUMP.parent.mkdir(parents=True, exist_ok=True)
    run("shell", "uiautomator", "dump", REMOTE_DUMP)
    run("pull", REMOTE_DUMP, str(LOCAL_DUMP))
    return ET.parse(LOCAL_DUMP).getroot()


def matches(node: ET.Element, needle: str) -> bool:
    needle = needle.casefold()
    text = node.attrib.get("text", "").casefold()
    desc = node.attrib.get("content-desc", "").casefold()
    return needle in text or needle in desc


def find(needle: str) -> ET.Element | None:
    root = dump()
    for node in root.iter("node"):
        if matches(node, needle):
            return node
    return None


def wait_for(needle: str, timeout: float) -> ET.Element:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            node = find(needle)
            if node is not None:
                return node
        except (subprocess.CalledProcessError, ET.ParseError) as exc:
            last_error = exc
        time.sleep(2)
    detail = f"; last dump error: {last_error}" if last_error else ""
    raise SystemExit(f"Timed out waiting for Android UI node containing {needle!r}{detail}")


def center(bounds: str) -> tuple[int, int]:
    # UIAutomator format: [x1,y1][x2,y2]
    import re

    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
    if not match:
        raise SystemExit(f"Unexpected UIAutomator bounds: {bounds!r}")
    x1, y1, x2, y2 = map(int, match.groups())
    if x2 <= x1 or y2 <= y1:
        raise SystemExit(f"Non-touchable UIAutomator bounds: {bounds!r}")
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(needle: str, timeout: float) -> None:
    node = wait_for(needle, timeout)
    x, y = center(node.attrib.get("bounds", ""))
    run("shell", "input", "tap", str(x), str(y))
    print(f"Tapped {needle!r} at ({x}, {y})")


def assert_absent(needle: str) -> None:
    node = find(needle)
    if node is not None:
        raise SystemExit(f"Unexpected Android UI node present: {needle!r}")
    print(f"Confirmed absent: {needle!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    wait_p = sub.add_parser("wait")
    wait_p.add_argument("needle")
    wait_p.add_argument("--timeout", type=float, default=60)

    tap_p = sub.add_parser("tap")
    tap_p.add_argument("needle")
    tap_p.add_argument("--timeout", type=float, default=60)

    absent_p = sub.add_parser("assert-absent")
    absent_p.add_argument("needle")

    sub.add_parser("dump")

    args = parser.parse_args()
    if args.command == "wait":
        node = wait_for(args.needle, args.timeout)
        print(f"Found {args.needle!r}: {node.attrib}")
    elif args.command == "tap":
        tap(args.needle, args.timeout)
    elif args.command == "assert-absent":
        assert_absent(args.needle)
    elif args.command == "dump":
        dump()
        print(LOCAL_DUMP)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        print(f"adb command failed: {exc}", file=sys.stderr)
        raise
