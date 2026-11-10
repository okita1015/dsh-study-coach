#!/usr/bin/env python3
"""
dsh-study-coach / extract.py

把一份讲义抽成纯文本，输出 JSON 到 stdout：

    {"ok": true, "file": "...", "kind": "pdf|docx|pptx|xlsx|text",
     "units": [{"label": "p1", "text": "..."}], "chars": 1234, "warning": ""}

为什么要单独一个 python 脚本：
  - PDF 得靠 PyMuPDF（node 侧现写 PDF 解析器纯属自虐，而且中文编码会翻车）
  - docx / pptx 用 python-docx / python-pptx 能连标题层级、表格、备注一起拿出来
  - 这三个库都在 DSH 自带 python 运行时里，不需要 pip install 任何东西

失败一律走 {"ok": false, "error": "..."}，别抛栈 —— node 侧要能优雅降级。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

MAX_CHARS = 400_000  # 一份文件最多抽这么多字，超了截断

# Windows 控制台默认 GBK，输出 JSON 里的 • → 这类字符会直接炸。
# 强制 utf-8，出错也别停（node 侧按 utf-8 读 buffer）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


def out(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def clip(s: str) -> str:
    s = (s or "").strip()
    return s[:MAX_CHARS]


def do_pdf(p: Path) -> dict:
    import pymupdf

    units = []
    with pymupdf.open(str(p)) as doc:
        for i, page in enumerate(doc, 1):
            # "text" 模式会按阅读顺序给文本；sort=True 修一下乱序的课件版面
            t = page.get_text("text", sort=True)
            if t.strip():
                units.append({"label": f"p{i}", "text": t.strip()})
    warn = ""
    if not units:
        warn = "这个 PDF 没有文本层（大概是扫描件或纯图片），抽不出字"
    return {"kind": "pdf", "units": units, "warning": warn}


def do_docx(p: Path) -> dict:
    import docx

    d = docx.Document(str(p))
    units = []
    buf = []

    def flush(label):
        if buf:
            units.append({"label": label, "text": "\n".join(buf).strip()})
            buf.clear()

    for para in d.paragraphs:
        t = (para.text or "").strip()
        if not t:
            continue
        style = (para.style.name if para.style is not None else "") or ""
        # 标题行单独成一块，后面生成知识点时能当章节名用
        if style.lower().startswith("heading") or style.lower().startswith("title"):
            flush("body")
            units.append({"label": style, "text": t})
        else:
            buf.append(t)
    flush("body")

    # 表格单独抽，课件里很多公式/对照表只在表格里
    for ti, table in enumerate(d.tables, 1):
        rows = []
        for row in table.rows:
            cells = [(c.text or "").strip().replace("\n", " ") for c in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            units.append({"label": f"table{ti}", "text": "\n".join(rows)})

    return {"kind": "docx", "units": units, "warning": ""}


def do_pptx(p: Path) -> dict:
    from pptx import Presentation

    prs = Presentation(str(p))
    units = []
    for i, slide in enumerate(prs.slides, 1):
        lines = []
        for shape in slide.shapes:
            # 文本框 / 占位符
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    t = "".join(r.text or "" for r in para.runs).strip()
                    if not t:
                        t = (para.text or "").strip()
                    if t:
                        # 靠缩进记层级，后面拼大纲时有用
                        lvl = para.level or 0
                        lines.append(("  " * lvl) + t)
            # 表格
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [(c.text or "").strip().replace("\n", " ") for c in row.cells]
                    if any(cells):
                        lines.append(" | ".join(cells))
        # 演讲者备注常有老师补充的说明
        note = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            note = (slide.notes_slide.notes_text_frame.text or "").strip()
        if note:
            lines.append("[备注] " + note.replace("\n", " "))
        if lines:
            units.append({"label": f"slide{i}", "text": "\n".join(lines)})
    warn = "" if units else "这份 pptx 里没读到文字（可能全是图片）"
    return {"kind": "pptx", "units": units, "warning": warn}


def do_xlsx(p: Path) -> dict:
    import openpyxl

    wb = openpyxl.load_workbook(str(p), data_only=True, read_only=True)
    units = []
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c.strip() for c in cells):
                rows.append(" | ".join(cells))
        if rows:
            units.append({"label": ws.title, "text": "\n".join(rows)})
    wb.close()
    return {"kind": "xlsx", "units": units, "warning": ""}


def do_text(p: Path) -> dict:
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return {"kind": "text", "units": [{"label": "text", "text": raw.decode(enc)}], "warning": ""}
        except UnicodeDecodeError:
            continue
    return {"kind": "text", "units": [], "warning": "读不出编码"}


HANDLERS = {
    ".pdf": do_pdf,
    ".docx": do_docx,
    ".pptx": do_pptx,
    ".xlsx": do_xlsx,
    ".txt": do_text,
    ".md": do_text,
    ".csv": do_text,
}


def main() -> int:
    if len(sys.argv) < 2:
        out({"ok": False, "error": "usage: extract.py <file>"})
        return 2
    p = Path(sys.argv[1])
    if not p.exists():
        out({"ok": False, "error": f"文件不存在：{p}"})
        return 2

    handler = HANDLERS.get(p.suffix.lower())
    if handler is None:
        out({"ok": False, "error": f"不支持的类型：{p.suffix}", "kind": "unsupported"})
        return 2

    try:
        r = handler(p)
    except ModuleNotFoundError as e:
        out({"ok": False, "error": f"缺 python 库 {e.name}，装一下：pip install {e.name}"})
        return 3
    except Exception as e:  # noqa: BLE001 — 任何解析错误都降级，不让 node 侧崩
        out({"ok": False, "error": f"{type(e).__name__}: {e}"})
        return 1

    chars = sum(len(u["text"]) for u in r["units"])
    # 太长就按块截，保留前面最有用的部分
    kept = []
    total = 0
    for u in r["units"]:
        if total >= MAX_CHARS:
            break
        t = u["text"][: MAX_CHARS - total]
        kept.append({"label": u["label"], "text": t})
        total += len(t)

    out({
        "ok": True,
        "file": str(p),
        "name": p.name,
        "kind": r["kind"],
        "units": kept,
        "chars": total,
        "truncated": chars > total,
        "warning": r.get("warning", ""),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main())
