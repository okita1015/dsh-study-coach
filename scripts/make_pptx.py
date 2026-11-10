#!/usr/bin/env python3
"""
dsh-study-coach / make_pptx.py

Markdown → PowerPoint。一样是够用就好。

约定（跟生成笔记的格式对齐，改一边记得改另一边）：
  # 标题                  → 封面
  ## 一节                 → 一张幻灯片（标题 = 这一节的名字）
  - 要点                  → 项目符号（缩进两格算二级）
  | a | b |               → 表格（放得下就放）
  > 引用                  → 讲者备注（讲的时候能看，屏幕上不占地方）
  ```...```               → 等宽小字块（公式/代码）

用法：
  python make_pptx.py <input.md> <output.pptx> [--title 标题] [--subtitle 副标题] [--theme teal|navy|slate]

版面：16:9，标题栏一条色带 + 顶栏细线，正文用 18pt，一页最多 7 条要点（超了自动分页）。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

from _fonts import font_set

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Pt

FS = font_set()
EA_FONT = FS["cjk"]

THEMES = {
    "navy": {"bar": RGBColor(0x1F, 0x38, 0x64), "ink": RGBColor(0x1E, 0x2A, 0x3D), "accent": RGBColor(0x2E, 0x9E, 0x8F)},
    "teal": {"bar": RGBColor(0x1F, 0x6F, 0x66), "ink": RGBColor(0x17, 0x2A, 0x28), "accent": RGBColor(0x2E, 0x9E, 0x8F)},
    "slate": {"bar": RGBColor(0x37, 0x41, 0x51), "ink": RGBColor(0x1F, 0x26, 0x2F), "accent": RGBColor(0x4E, 0x9B, 0xD6)},
}

MAX_BULLETS = 7


def set_font(run, size, bold=False, color=None, mono=False):
    name = (font_set()["mono"] if mono else EA_FONT)
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def parse_md(md: str):
    """返回 (H1 列表, [ {title, bullets, tables, notes} ])"""
    lines = md.replace("\r\n", "\n").split("\n")
    h1 = {"title": "", "subtitle": ""}
    slides = []
    cur = None
    i = 0
    in_code = False

    while i < len(lines):
        raw = lines[i]
        s = raw.strip()

        if s.startswith("```"):
            in_code = not in_code
            i += 1
            continue
        if in_code:
            if cur is None:
                cur = {"title": "说明", "bullets": [], "tables": [], "notes": []}
            cur["bullets"].append(("code", raw.rstrip()))
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            if level == 1:
                if not h1["title"]:
                    h1["title"] = text
                else:
                    # 第二个 H1 当成新的一节
                    cur = {"title": text, "bullets": [], "tables": [], "notes": []}
                    slides.append(cur)
            elif level == 2:
                cur = {"title": text, "bullets": [], "tables": [], "notes": []}
                slides.append(cur)
            else:
                if cur is None:
                    cur = {"title": text, "bullets": [], "tables": [], "notes": []}
                    slides.append(cur)
                else:
                    cur["bullets"].append(("sub", text))
            i += 1
            continue

        if cur is None:
            i += 1
            continue

        if s.startswith("|") and s.count("|") >= 2:
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                row = lines[i].strip()
                if not re.fullmatch(r"\s*\|?[\s:|-]{3,}\|?\s*", row):
                    cells = [c.strip() for c in row.strip("|").split("|")]
                    rows.append(cells)
                i += 1
            if rows:
                cur["tables"].append(rows)
            continue

        if s.startswith(">"):
            cur["notes"].append(s.lstrip("> ").strip())
            i += 1
            continue

        if not s or re.fullmatch(r"-{3,}|\*{3,}", s):
            i += 1
            continue

        m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", raw)
        if m:
            depth = 1 if len(m.group(1)) >= 2 else 0
            cur["bullets"].append(("bullet" if depth == 0 else "sub", m.group(3)))
            i += 1
            continue

        cur["bullets"].append(("para", s))
        i += 1

    return h1, [s for s in slides if s["bullets"] or s["tables"] or s["notes"]]


def strip_inline(s: str) -> str:
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)
    return s


def add_slide_bar(slide, theme, prs):
    """顶栏一条色带 + 一条细线，看起来像正经课件而不是白板。"""
    bar = slide.shapes.add_shape(1, 0, 0, prs.slide_width, Emu(90000))
    bar.fill.solid()
    bar.fill.fore_color.rgb = theme["bar"]
    bar.line.fill.background()
    bar.shadow.inherit = False


def build_slide(prs, theme, spec, page_no, total):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # 全空白，自己排版
    W, H = prs.slide_width, prs.slide_height
    add_slide_bar(slide, theme, prs)

    # 标题
    tb = slide.shapes.add_textbox(Emu(430000), Emu(300000), W - Emu(860000), Emu(700000))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = strip_inline(spec["title"])[:90]
    set_font(r, 27, bold=True, color=theme["bar"])

    # 内容区
    top = Emu(1150000)
    body_h = H - top - Emu(420000)
    body = slide.shapes.add_textbox(Emu(500000), top, W - Emu(1000000), body_h)
    btf = body.text_frame
    btf.word_wrap = True
    btf.clear()

    if spec["tables"]:
        # 有表格就以表格为主，要点只留三行
        rows = spec["tables"][0]
        cols = max(len(r) for r in rows)
        tbl_h = Emu(min(2600000, 420000 * len(rows)))
        shape = slide.shapes.add_table(len(rows), cols, Emu(500000), top,
                                      W - Emu(1000000), tbl_h)
        table = shape.table
        for ri, row in enumerate(rows):
            for ci in range(cols):
                cell = table.cell(ri, ci)
                cell.text = ""
                cp = cell.text_frame.paragraphs[0]
                run = cp.add_run()
                run.text = strip_inline(row[ci] if ci < len(row) else "")[:80]
                set_font(run, 13, bold=(ri == 0),
                         color=RGBColor(0xFF, 0xFF, 0xFF) if ri == 0 else theme["ink"])
                if ri == 0:
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = theme["bar"]
    else:
        first = True
        count = 0
        for kind, text in spec["bullets"]:
            if count >= MAX_BULLETS:
                break
            p = btf.paragraphs[0] if first else btf.add_paragraph()
            first = False
            if kind in ("bullet", "para"):
                p.level = 0
                prefix = "• " if kind == "bullet" else ""
            elif kind == "sub":
                p.level = 1
                prefix = "– "
            elif kind == "code":
                p.level = 0
                prefix = ""
            else:
                p.level = 0
                prefix = ""
            r = p.add_run()
            r.text = prefix + strip_inline(text)[:220]
            if kind == "code":
                set_font(r, 13, color=theme["ink"], mono=True)
            elif kind == "sub":
                set_font(r, 17, color=theme["ink"])
            else:
                set_font(r, 19, color=theme["ink"])
            p.space_after = Pt(6)
            count += 1

    # 讲者备注
    if spec["notes"]:
        slide.notes_slide.notes_text_frame.text = "\n".join(strip_inline(n) for n in spec["notes"])

    # 页码
    pn = slide.shapes.add_textbox(W - Emu(900000), H - Emu(380000), Emu(700000), Emu(300000))
    pnp = pn.text_frame.paragraphs[0]
    pnp.alignment = PP_ALIGN.RIGHT
    rn = pnp.add_run()
    rn.text = f"{page_no} / {total}"
    set_font(rn, 10, color=RGBColor(0x9A, 0xA3, 0xB2))
    return slide


def cover(prs, theme, title, subtitle):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    W, H = prs.slide_width, prs.slide_height
    band = slide.shapes.add_shape(1, 0, Emu(int(H * 0.32)), W, Emu(int(H * 0.30)))
    band.fill.solid()
    band.fill.fore_color.rgb = theme["bar"]
    band.line.fill.background()
    band.shadow.inherit = False

    tb = slide.shapes.add_textbox(Emu(600000), Emu(int(H * 0.36)), W - Emu(1200000), Emu(900000))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = strip_inline(title)[:100]
    set_font(r, 36, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF))

    if subtitle:
        sb = slide.shapes.add_textbox(Emu(600000), Emu(int(H * 0.50)), W - Emu(1200000), Emu(700000))
        sp = sb.text_frame.paragraphs[0]
        sr = sp.add_run()
        sr.text = strip_inline(subtitle)[:140]
        set_font(sr, 15, color=RGBColor(0xFF, 0xFF, 0xFF))
    return slide


def main() -> int:
    argv = sys.argv[1:]
    opts = {}
    for i, a in enumerate(argv):
        if a in ("--title", "--subtitle", "--theme") and i + 1 < len(argv):
            opts[a.lstrip("-")] = argv[i + 1]
    args = [a for a in argv if not a.startswith("--") and a not in opts.values()]

    if len(args) < 2:
        print(json.dumps({"ok": False, "error": "usage: make_pptx.py <in.md> <out.pptx>"}, ensure_ascii=False))
        return 2

    src, dst = Path(args[0]), Path(args[1])
    if not src.exists():
        print(json.dumps({"ok": False, "error": f"找不到 {src}"}, ensure_ascii=False))
        return 2

    md = src.read_text(encoding="utf-8")
    h1, slides = parse_md(md)
    theme = THEMES.get(opts.get("theme", "navy"), THEMES["navy"])

    prs = Presentation()
    prs.slide_width = Emu(12192000)   # 16:9
    prs.slide_height = Emu(6858000)

    cover(prs, theme, opts.get("title") or h1["title"] or src.stem,
          opts.get("subtitle") or h1["subtitle"] or "")
    total = len(slides)
    for n, spec in enumerate(slides, 1):
        # 要点太多就拆页，别把字挤成一团
        chunks = [spec["bullets"][i:i + MAX_BULLETS] for i in range(0, len(spec["bullets"]), MAX_BULLETS)] or [[]]
        for ci, chunk in enumerate(chunks):
            sub = dict(spec)
            sub["bullets"] = chunk
            if ci > 0:
                sub["title"] = spec["title"] + "（续）"
                sub["tables"] = []
                sub["notes"] = []
            build_slide(prs, theme, sub, n if len(chunks) == 1 else f"{n}.{ci + 1}", total)

    if total == 0:
        # 一点结构都没有也要给一页，不然打开是空白文件
        build_slide(prs, theme, {"title": "内容", "bullets": [("para", md[:400])], "tables": [], "notes": []}, 1, 1)

    dst.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(dst))
    print(json.dumps({"ok": True, "out": str(dst), "slides": len(prs.slides._sldIdLst),
                      "bytes": dst.stat().st_size}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
