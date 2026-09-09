#!/usr/bin/env python3
"""Assembles dist/kafedra-is-board.html from src/board.html + src/lessons_data.js + src/script.js.

Usage: python3 scripts/build.py
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"

def main():
    html = (SRC / "board.html").read_text(encoding="utf-8")
    data_js = (SRC / "lessons_data.js").read_text(encoding="utf-8")
    script_js = (SRC / "script.js").read_text(encoding="utf-8")

    placeholder = '<script src="lessons_data.js"></script>\n<script>\nPLACEHOLDER_SCRIPT\n</script>'
    if placeholder not in html:
        raise SystemExit("board.html placeholder not found — did src/board.html change shape?")

    html = html.replace(placeholder, "<script>\n" + data_js + "\n" + script_js + "\n</script>")

    DIST.mkdir(exist_ok=True)
    out = DIST / "kafedra-is-board.html"
    out.write_text(html, encoding="utf-8")
    print(f"Built {out} ({len(html)} bytes)")

    # Also mirror to repo root as index.html so GitHub Pages can serve it directly.
    root_copy = ROOT / "index.html"
    root_copy.write_text(html, encoding="utf-8")
    print(f"Mirrored to {root_copy}")

if __name__ == "__main__":
    main()
