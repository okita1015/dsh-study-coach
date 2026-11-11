#!/usr/bin/env python3
"""
dsh-study-coach / make_paper.py

按真卷版式排一份试卷（或答案版）。

为什么单独一个脚本、不用 make_docx.py：
  试卷的版式是**固定契约**，不是自由排版 —— 封面信息块、每页页眉 Page X of Y、
  三栏页脚、Section 说明、A1/A2 题号、子题 (a)(b) 缩进、右对齐 [N marks]。
  Markdown 表达不了这些，硬用 h1/h2 凑出来一眼就看出是外行。

输入（JSON，由 lib/paper.js 组装）：
{
  "meta": {
    "institution": "Some Institute of Technology",
    "programme": "IT114103/1, IT114105/1, IT114118/1, IT114127/1",
    "moduleTitle": "DISCRETE MATHEMATICS & STATISTICS",
    "moduleCode": "COMP2011",
    "semester": "SEMESTER 1",
    "paperName": "MAIN EXAMINATION",
    "date": "5 JANUARY, 2026",
    "time": "1:30 PM TO 3:30 PM (2 hours)",
    "footerLeft": "Discrete Mathematics & Statistics",
    "footerCenter": "Main Examination",
    "footerRight": "Semester 1 (2025/2026)",
    "instructions": ["This paper has a total of ...", "This paper contains TWO Sections."],
    "note": "The result of this assessment will not be counted ...",
    "working": "All working must be clearly shown.",
    "appendices": ["A Formula Sheet and a standardized Normal Distribution Table are attached ..."]
  },
  "sections": [
    {
      "id": "A", "name": "Section A", "marks": 40, "prefix": "A",
      "instruction": ["This section contains EIGHT questions.", "Answer ALL questions.",
                      "Each question is worth FIVE marks."],
      "questions": [
        {"stem": "Draw a K-map ...", "marks": 5,
         "table": [["A","B","C","F"],["0","0","0","0"]],
         "parts": [{"label": "(a)", "text": "Calculate ...", "marks": 3}],
         "answer": "参考答案"}
      ]
    }
  ]
}

用法：
  python make_paper.py <paper.json> <out.docx> [--answers] [--scope "Ch1-Ch5"]
  --answers   排答案版（每题下面接 Answer，含解题步骤）
  --scope     封面副标题，例如 "Chapters 1-5"
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

from _fonts import font_set

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

# 题目自带的图（加权图 / 树 / 网络）在 Word 里得是位图，画在 _figure.py 里。
# 有些科目（比如纯文科）永远用不到，导入失败也不该让整份卷子排不出来。
try:
    from _figure import render_figure as _render_figure
except Exception:  # noqa: BLE001
    _render_figure = None

FS = font_set()
SERIF = FS["serif"]
CJK = FS["cjk"]
BODY = Pt(11)
SMALL = Pt(8.5)


def set_font(run, size=BODY, bold=False, italic=False):
    run.font.name = SERIF
    run.font.size = size
    run.font.bold = bold
    run.font.italic = italic
    rpr = run._element.get_or_add_rPr()
    rf = rpr.find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        rpr.append(rf)
    rf.set(qn("w:ascii"), SERIF)
    rf.set(qn("w:hAnsi"), SERIF)
    rf.set(qn("w:eastAsia"), CJK)


def field(paragraph, instr: str, placeholder: str = "1"):
    """
    插入 Word 域（PAGE / NUMPAGES）。

    **不要**去 settings.xml 加 w:updateFields 让 Word 重算 —— 那个元素在
    w:settings 里位置固定（必须排在 w:compat / w:rsids / w:themeFontLang 之前），
    随手 append 到末尾就是违反 schema，Word 打开会直接判「文件已损坏」。
    这一点栽过一次，生成出来的练习卷打不开就是这么来的。

    正确做法：给 fldSimple 打 w:dirty="true"，Word 打开时会自己重算这一个域。
    """
    run = paragraph.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    fld.set(qn("w:dirty"), "true")
    inner = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = placeholder
    inner.append(t)
    fld.append(inner)
    run._element.addnext(fld)


def page_header_footer(section, meta, answers=False):
    """每页页眉：机构名 + Page X of Y；第二行 Programme/Year；页脚三栏。"""
    header = section.header
    header.is_linked_to_previous = False
    hp = header.paragraphs[0]
    hp.paragraph_format.space_after = Pt(0)
    # 右对齐的 Page X of Y：靠 tab stop 放到右边
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(17.0), WD_TAB_ALIGNMENT.RIGHT)
    r = hp.add_run(meta.get("institution", "Some Institute of Technology"))
    set_font(r, SMALL)
    r2 = hp.add_run("\tPage ")
    set_font(r2, SMALL)
    field(hp, "PAGE", "1")
    r3 = hp.add_run(" of ")
    set_font(r3, SMALL)
    field(hp, "NUMPAGES", "8")

    hp2 = header.add_paragraph()
    hp2.paragraph_format.space_after = Pt(0)
    pr = hp2.add_run("Programme/Year: " + meta.get("programme", ""))
    set_font(pr, SMALL)

    footer = section.footer
    footer.is_linked_to_previous = False
    fp = footer.paragraphs[0]
    fp.paragraph_format.space_before = Pt(0)
    # 三栏页脚：左 / 中 / 右
    fp.paragraph_format.tab_stops.add_tab_stop(Cm(6.0), WD_TAB_ALIGNMENT.CENTER)
    fp.paragraph_format.tab_stops.add_tab_stop(Cm(17.0), WD_TAB_ALIGNMENT.RIGHT)
    f1 = fp.add_run(("ANSWER KEY  ·  " if answers else "") + meta.get("footerLeft", ""))
    set_font(f1, SMALL)
    f2 = fp.add_run("\t" + meta.get("footerCenter", ""))
    set_font(f2, SMALL)
    f3 = fp.add_run("\t" + meta.get("footerRight", ""))
    set_font(f3, SMALL)
    fp3 = footer.add_paragraph()
    fp3.paragraph_format.space_before = Pt(0)
    f4 = fp3.add_run("(" + meta.get("moduleCode", "") + ")")
    set_font(f4, SMALL)


def center_line(doc, text, size, bold=False, space_before=0, space_after=2, caps=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    r = p.add_run(text.upper() if caps else text)
    set_font(r, size, bold=bold)
    return p


def letter_spaced(text):
    """真卷那种 D I S C R E T E 的字距效果"""
    return " ".join(list(text))


def build_cover(doc, meta, answers=False, scope=""):
    center_line(doc, meta.get("institution", ""), Pt(11), space_before=0)
    # 学院/学部两块，按真卷的分行感
    for line in meta.get("coverLines", []):
        center_line(doc, line, Pt(11))

    doc.add_paragraph()
    # 左侧 Instructions 块 + 右侧 programme 列表，用无边框表格并排
    tbl = doc.add_table(rows=1, cols=2)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = True
    left, right = tbl.cell(0, 0), tbl.cell(0, 1)

    left.paragraphs[0].text = ""
    p = left.paragraphs[0]
    r = p.add_run("Instructions:")
    set_font(r, Pt(10.5), bold=False)
    letters = "abcdefghij"
    for i, ins in enumerate(meta.get("instructions", [])):
        ip = left.add_paragraph()
        ip.paragraph_format.space_after = Pt(3)
        ip.paragraph_format.left_indent = Cm(0.9)
        ip.paragraph_format.first_line_indent = Cm(-0.9)
        r1 = ip.add_run(f"({letters[i] if i < len(letters) else '-'})  ")
        set_font(r1, Pt(10))
        r2 = ip.add_run(str(ins))
        set_font(r2, Pt(10))

    note = meta.get("note")
    if note:
        np_ = left.add_paragraph()
        np_.paragraph_format.space_before = Pt(6)
        r1 = np_.add_run("Note: ")
        set_font(r1, Pt(9.5), bold=True)
        r2 = np_.add_run(note)
        set_font(r2, Pt(9.5))

    right.paragraphs[0].text = ""
    for i, prog in enumerate(meta.get("programmes", [])):
        rp = right.paragraphs[0] if i == 0 else right.add_paragraph()
        rp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        rp.paragraph_format.space_after = Pt(6)
        r1 = rp.add_run(letter_spaced(prog.get("name", "")))
        set_font(r1, Pt(9.5))
        if prog.get("code"):
            r2 = rp.add_run("\n" + prog["code"])
            set_font(r2, Pt(9.5))

    doc.add_paragraph()
    center_line(doc, "MODULE TITLE:", Pt(10.5), space_before=10)
    center_line(doc, letter_spaced(meta.get("moduleTitle", "")), Pt(15), bold=True)
    doc.add_paragraph()
    center_line(doc, "MODULE CODE: " + meta.get("moduleCode", ""), Pt(11))
    doc.add_paragraph()
    center_line(doc, letter_spaced(meta.get("semester", "SEMESTER 1")), Pt(11))
    center_line(doc, letter_spaced(meta.get("paperName", "MAIN EXAMINATION")), Pt(13), bold=True)

    if answers:
        doc.add_paragraph()
        center_line(doc, "ANSWER KEY", Pt(16), bold=True)
        center_line(doc, "（答案与评分参考，不对外发放）", Pt(10))

    if scope:
        doc.add_paragraph()
        center_line(doc, "Scope: " + scope, Pt(11), bold=True)

    doc.add_paragraph()
    if meta.get("date"):
        center_line(doc, meta["date"], Pt(11))
    if meta.get("time"):
        center_line(doc, meta["time"], Pt(11))

    doc.add_paragraph()
    total = sum(s.get("marks", 0) for s in meta.get("sectionsBrief", [])) or meta.get("totalMarks", 0)
    if total:
        center_line(doc, f"Total: {total} marks", Pt(11), bold=True)


def add_page_break(doc):
    doc.add_page_break()


def build_instructions_page(doc, meta):
    """封面后那一页：这份卷的结构说明（真卷第 3 页顶部那块）"""
    p = doc.add_paragraph()
    r = p.add_run("This paper contains " + str(meta.get("sectionCountWord", "TWO")) + " sections.")
    set_font(r, BODY)
    if meta.get("working"):
        p2 = doc.add_paragraph()
        set_font(p2.add_run(meta["working"]), BODY)
    for line in meta.get("appendices", []):
        p3 = doc.add_paragraph()
        set_font(p3.add_run(line), BODY)


def add_marks(paragraph, marks):
    """右对齐的 [N marks] —— 真卷就是这么排的"""
    paragraph.paragraph_format.tab_stops.add_tab_stop(Cm(17.0), WD_TAB_ALIGNMENT.RIGHT)
    unit = "mark" if marks == 1 else "marks"
    r = paragraph.add_run(f"\t[{marks} {unit}]")
    set_font(r, BODY)


def add_question(doc, q, no, answers=False):
    # 题号 + 题干（悬挂缩进，跟真卷的 A1 <tab> 题干一样）
    stem_text = str(q.get("stem", "")).strip()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.left_indent = Cm(1.2)
    p.paragraph_format.first_line_indent = Cm(-1.2)
    r = p.add_run(no + "\t")
    set_font(r, BODY, bold=True)
    if not q.get("parts") and not q.get("table"):
        r2 = p.add_run(stem_text)
        set_font(r2, BODY)
        if q.get("marks") is not None:
            add_marks(p, q["marks"])
    else:
        r2 = p.add_run(stem_text)
        set_font(r2, BODY)

    # 题目自带的图：画成 PNG 插在题干下面（真卷也是这个位置）。
    # 画不出来就跳过 —— 少一张图总比整份卷子排不出来强。
    fig = q.get("figure")
    if fig and _render_figure is not None:
        try:
            import tempfile
            import uuid

            png = os.path.join(
                tempfile.gettempdir(),
                "dsh-paper-fig-%s.png" % uuid.uuid4().hex[:10],
            )
            r = _render_figure(fig, png, width_px=780)
            if r.get("ok") and os.path.exists(png):
                doc.add_picture(png, width=Cm(9.4))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                doc.paragraphs[-1].paragraph_format.space_after = Pt(2)
        except Exception:  # noqa: BLE001
            pass

    # 题干里的表格（K-map、真值表、对照表）
    table = q.get("table")
    if table:
        rows = len(table)
        cols = max(len(r_) for r_ in table)
        t = doc.add_table(rows=rows, cols=cols)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        t.style = "Table Grid"
        for ri, row in enumerate(table):
            for ci in range(cols):
                cell = t.cell(ri, ci)
                cell.text = ""
                cp = cell.paragraphs[0]
                cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                rr = cp.add_run(str(row[ci]) if ci < len(row) else "")
                set_font(rr, Pt(10), bold=(ri == 0))
        doc.add_paragraph()

    # 子题
    for part in q.get("parts", []):
        pp = doc.add_paragraph()
        pp.paragraph_format.space_after = Pt(4)
        pp.paragraph_format.left_indent = Cm(2.4)
        pp.paragraph_format.first_line_indent = Cm(-1.2)
        r1 = pp.add_run(str(part.get("label", "(a)")) + "   ")
        set_font(r1, BODY)
        r2 = pp.add_run(str(part.get("text", "")))
        set_font(r2, BODY)
        if part.get("marks") is not None:
            add_marks(pp, part["marks"])

    if answers:
        ans = str(q.get("answer", "")).strip()
        if ans:
            ap = doc.add_paragraph()
            ap.paragraph_format.left_indent = Cm(1.2)
            ap.paragraph_format.space_before = Pt(3)
            ap.paragraph_format.space_after = Pt(8)
            r1 = ap.add_run("Answer:  ")
            set_font(r1, BODY, bold=True)
            r2 = ap.add_run(ans)
            set_font(r2, BODY)
            for run in ap.runs:
                run.font.color.rgb = RGBColor(0x8B, 0x1A, 0x1A)
    elif not q.get("parts"):
        # 空白卷：没有子题的整道题后面给够写字的地方
        blank_answer_space(doc, q.get("marks"))


def build_section(doc, sec, answers=False):
    name = sec.get("name", "Section A")
    marks = sec.get("marks")
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"{name} ({marks} marks)" if marks else name)
    set_font(r, Pt(12), bold=True)

    for line in sec.get("instruction", []):
        ip = doc.add_paragraph()
        ip.paragraph_format.space_after = Pt(2)
        set_font(ip.add_run(str(line)), BODY)

    prefix = sec.get("prefix", "A")
    for i, q in enumerate(sec.get("questions", []), 1):
        add_question(doc, q, f"{prefix}{i}", answers=answers)


def blank_answer_space(doc, marks):
    """空白卷给答题空间：按分值算行数，别让人写到页边"""
    lines = max(3, min(14, int(marks or 5) * 2))
    for _ in range(lines):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(" ")
        set_font(r, BODY)


def main() -> int:
    argv = sys.argv[1:]
    answers = "--answers" in argv
    scope = ""
    for i, a in enumerate(argv):
        if a == "--scope" and i + 1 < len(argv):
            scope = argv[i + 1]
    args = [a for a in argv if not a.startswith("--") and a != scope]

    if len(args) < 2:
        print(json.dumps({"ok": False, "error": "usage: make_paper.py <paper.json> <out.docx>"}, ensure_ascii=False))
        return 2

    src, dst = Path(args[0]), Path(args[1])
    if not src.exists():
        print(json.dumps({"ok": False, "error": f"找不到 {src}"}, ensure_ascii=False))
        return 2

    paper = json.loads(src.read_text(encoding="utf-8"))
    meta = paper.get("meta", {})
    sections = paper.get("sections", [])

    doc = Document()
    s = doc.sections[0]
    s.left_margin = Cm(2.2)
    s.right_margin = Cm(2.2)
    s.top_margin = Cm(2.0)
    s.bottom_margin = Cm(1.8)


    normal = doc.styles["Normal"]
    normal.font.name = SERIF
    normal.font.size = BODY
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CJK)

    page_header_footer(s, meta, answers=answers)

    build_cover(doc, meta, answers=answers, scope=scope)
    add_page_break(doc)
    build_instructions_page(doc, meta)

    for sec in sections:
        build_section(doc, sec, answers=answers)

    total = sum(
        sum((q.get("marks") or 0) for q in sec.get("questions", []))
        for sec in sections
    )
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    r = p.add_run(f"END OF PAPER    (Total: {total} marks)")
    set_font(r, Pt(11), bold=True)

    dst.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(dst))
    print(json.dumps({
        "ok": True, "out": str(dst), "answers": answers,
        "sections": len(sections),
        "questions": sum(len(sec.get("questions", [])) for sec in sections),
        "totalMarks": total,
        "bytes": dst.stat().st_size,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
