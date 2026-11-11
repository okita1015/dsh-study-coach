#!/usr/bin/env python3
"""
dsh-study-coach / make_docx.py

Markdown → Word。够用就好，不追求完整 CommonMark。

支持的语法（就这些，多了容易出怪东西）：
  # / ## / ### / ####     标题
  - / * / 1.              列表（缩进两格算二级）
  | a | b |               表格（第二行 |---| 当分隔，会被跳过）
  ```...```               代码块（等宽）
  > 引用                  浅灰斜体
  ---                     分隔线（空段 + 下边框）
  **粗体** / *斜体* / `代码`  行内

用法：
  python make_docx.py <input.md> <output.docx> [--title 标题] [--subtitle 副标题]

为什么自己写而不是用 pandoc：班里没人装 pandoc，而 python-docx 在 DSH 运行时里已经有了。
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

from _fonts import font_set

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm

FS = font_set()
EA_FONT = FS["cjk"]
LATIN_FONT = FS["mono"]
BODY_SIZE = Pt(10.5)


def set_run_font(run, size=None, bold=None, italic=None, mono=False, color=None):
    """python-docx 只设 rFonts 的 ascii 不够，中文要单独写 w:eastAsia。"""
    name = LATIN_FONT if mono else EA_FONT
    run.font.name = name
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)
    rfonts.set(qn("w:eastAsia"), name)


def setup_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = EA_FONT
    normal.font.size = BODY_SIZE
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), EA_FONT)
    pf = normal.paragraph_format
    pf.space_after = Pt(4)
    pf.line_spacing = 1.25

    for i, sz in ((1, 18), (2, 15), (3, 12.5), (4, 11.5)):
        st = doc.styles[f"Heading {i}"]
        st.font.name = EA_FONT
        st.font.size = Pt(sz)
        st.font.bold = True
        st.font.color.rgb = RGBColor(0x1F, 0x38, 0x64)
        rpr = st.element.get_or_add_rPr()
        rfonts = rpr.find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            rpr.append(rfonts)
        rfonts.set(qn("w:eastAsia"), EA_FONT)


def add_page_number_footer(doc, label: str):
    footer = doc.sections[0].footer
    p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(label + "    ")
    set_run_font(r, Pt(8.5), color=RGBColor(0x88, 0x8F, 0x9C))
    r2 = p.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r2._element.addnext(fld)
    # 字段里也要一段文字，不然某些阅读器显示空白
    inner = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    inner.append(t)
    fld.append(inner)
    set_run_font(r2, Pt(8.5), color=RGBColor(0x88, 0x8F, 0x9C))


def add_bottom_border(paragraph):
    ppr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "D6DCE5")
    borders.append(bottom)
    ppr.append(borders)


INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\*[^*]+\*)")


def add_inline(paragraph, text, size=None, base_bold=False):
    """把 **粗体** / `代码` / *斜体* 拆成多个 run。"""
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            r = paragraph.add_run(text[pos:m.start()])
            set_run_font(r, size, bold=base_bold)
        token = m.group(1)
        if token.startswith("**"):
            r = paragraph.add_run(token[2:-2])
            set_run_font(r, size, bold=True)
        elif token.startswith("`"):
            r = paragraph.add_run(token[1:-1])
            set_run_font(r, Pt((size or BODY_SIZE).pt - 0.5), mono=True,
                         color=RGBColor(0xB0, 0x30, 0x30))
        else:
            r = paragraph.add_run(token[1:-1])
            set_run_font(r, size, italic=True, bold=base_bold)
        pos = m.end()
    if pos < len(text):
        r = paragraph.add_run(text[pos:])
        set_run_font(r, size, bold=base_bold)


def split_row(line: str):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def is_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\s*\|?[\s:|-]{3,}\|?\s*", line)) and "-" in line


def add_table(doc, rows):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for ri, row in enumerate(rows):
        for ci in range(cols):
            cell = table.cell(ri, ci)
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            txt = row[ci] if ci < len(row) else ""
            add_inline(p, txt, size=Pt(9.5), base_bold=(ri == 0))
    doc.add_paragraph()


def convert(md: str, doc: Document):
    lines = md.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # 代码块
        if stripped.startswith("```"):
            i += 1
            block = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                block.append(lines[i])
                i += 1
            i += 1
            for code_line in block or [""]:
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.left_indent = Cm(0.5)
                r = p.add_run(code_line if code_line else " ")
                set_run_font(r, Pt(9), mono=True, color=RGBColor(0x33, 0x3A, 0x46))
            doc.add_paragraph()
            continue

        # 图片：![图注](绝对路径)
        # 笔记里配的是讲义原图 —— 光有文字讲「这棵树长什么样」，对复习帮助有限。
        m_img = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", stripped)
        if m_img:
            alt = m_img.group(1).strip()
            src = m_img.group(2).strip().strip('"').strip("'")
            if os.path.exists(src):
                try:
                    doc.add_picture(src, width=Cm(14.5))
                    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                    doc.paragraphs[-1].paragraph_format.space_after = Pt(2)
                    if alt:
                        cap = doc.add_paragraph()
                        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        cr = cap.add_run(alt)
                        set_run_font(cr, Pt(8.5), color=RGBColor(0x6B, 0x74, 0x86))
                        cr.font.italic = True
                        cap.paragraph_format.space_after = Pt(8)
                except Exception:  # noqa: BLE001
                    pass
            i += 1
            continue

        # 表格
        if stripped.startswith("|") and stripped.count("|") >= 2:
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not is_separator(lines[i]):
                    rows.append(split_row(lines[i]))
                i += 1
            add_table(doc, rows)
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            doc.add_heading(level=level).clear()
            h = doc.paragraphs[-1]
            add_inline(h, m.group(2), size=Pt({1: 18, 2: 15, 3: 12.5, 4: 11.5}[level]), base_bold=True)
            i += 1
            continue

        # 分隔线
        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", stripped):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(6)
            add_bottom_border(p)
            i += 1
            continue

        # 引用
        if stripped.startswith(">"):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            add_inline(p, stripped.lstrip("> ").strip(), size=Pt(9.5))
            for r in p.runs:
                r.font.italic = True
                r.font.color.rgb = RGBColor(0x6B, 0x74, 0x86)
            i += 1
            continue

        # 列表
        m = re.match(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$", line)
        if m:
            indent = len(m.group(1)) // 2
            style = "List Number" if re.match(r"\d", m.group(2)) else "List Bullet"
            try:
                p = doc.add_paragraph(style=style)
            except KeyError:
                p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6 + 0.5 * indent)
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, m.group(3))
            i += 1
            continue

        # 空行
        if not stripped:
            i += 1
            continue

        # 普通段落
        p = doc.add_paragraph()
        add_inline(p, stripped)
        i += 1


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    opts = {}
    it = iter(sys.argv[1:])
    for a in it:
        if a == "--title":
            opts["title"] = next(it, "")
        elif a == "--subtitle":
            opts["subtitle"] = next(it, "")

    if len(args) < 2:
        print(json.dumps({"ok": False, "error": "usage: make_docx.py <in.md> <out.docx> [--title T]"}))
        return 2

    src = Path(args[0])
    dst = Path(args[1])
    if not src.exists():
        print(json.dumps({"ok": False, "error": f"找不到 {src}"}, ensure_ascii=False))
        return 2

    md = src.read_text(encoding="utf-8")
    doc = Document()
    section = doc.sections[0]
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)
    section.top_margin = Cm(1.8)
    section.bottom_margin = Cm(1.8)
    setup_styles(doc)

    title = opts.get("title") or src.stem
    sub = opts.get("subtitle") or ""

    # 封面头（不是独立封面页，省纸）
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(title)
    set_run_font(r, Pt(20), bold=True, color=RGBColor(0x1F, 0x38, 0x64))
    if sub:
        p2 = doc.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r2 = p2.add_run(sub)
        set_run_font(r2, Pt(10), color=RGBColor(0x7B, 0x87, 0x9A))
    p3 = doc.add_paragraph()
    add_bottom_border(p3)
    p3.paragraph_format.space_after = Pt(10)

    convert(md, doc)
    add_page_number_footer(doc, title)

    dst.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(dst))
    print(json.dumps({"ok": True, "out": str(dst), "bytes": dst.stat().st_size}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
