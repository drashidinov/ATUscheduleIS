#!/usr/bin/env python3
"""Regenerates src/lessons_data.js from data/parsed_lessons.json.

Usage: python3 scripts/gen_lessons_js.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    parsed = json.load(open(ROOT / "data" / "parsed_lessons.json", encoding="utf-8"))
    compact = json.dumps(parsed, ensure_ascii=False, separators=(",", ":")).replace("</script>", "<\\/script>")
    out = ROOT / "src" / "lessons_data.js"
    out.write_text("const LESSONS = " + compact + ";\n", encoding="utf-8")
    print(f"Wrote {out} ({len(compact)} bytes, {len(parsed)} lessons)")

if __name__ == "__main__":
    main()
