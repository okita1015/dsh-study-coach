"""
dsh-study-coach / extract_images.py

把讲义 / 真卷里嵌的图片抽出来，存成能挂到题目上的文件。

为什么需要：`figure` 只能表达「顶点 + 边」这种结构化的东西。别人的科目是电路、
化学结构、组织切片、地图、财务报表 —— 那些图模型根本描述不出来，
但它们**本来就在老师发的 PDF / PPTX / DOCX 里**。抽出来让人挑，比让模型瞎画靠谱。

用法：
    python extract_images.py <源文件> <输出目录> [--max N]
输出（最后一行）：
    {"ok": true, "out": "<目录>", "images": [{"path": "...", "w": 800, "h": 600, "from": "p12"}, ...]}
"""

from __future__ import annotations

import io
import json
import hashlib
import os
import sys
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

MIN_PX = 48          # 小于这个尺寸的多半是项目符号 / 图标 / 分隔线，不是图
RASTER_EXT = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}


def _save_pixmap_bytes(data: bytes, out_path: str) -> bool:
    try:
        with open(out_path, "wb") as f:
            f.write(data)
        return os.path.getsize(out_path) > 0
    except Exception:  # noqa: BLE001
        return False


def _size_of(path: str):
    """尽力拿到图片的像素尺寸；拿不到就当 0（不影响返回，只是排序用）。"""
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext == ".png" and os.path.getsize(path) > 24:
            with open(path, "rb") as f:
                head = f.read(26)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                w = int.from_bytes(head[16:20], "big")
                h = int.from_bytes(head[20:24], "big")
                return w, h
        if ext in (".jpg", ".jpeg"):
            from PIL import Image
            with Image.open(path) as im:
                return im.size
    except Exception:  # noqa: BLE001
        pass
    return 0, 0


def from_pdf(src: str, out_dir: str, limit: int):
    """PDF：按页把嵌入的位图抽出来。矢量图（老师用 Word 画的流程图）抽不到 —— 有兜底方案见页面渲染。"""
    try:
        import fitz  # PyMuPDF
    except Exception as e:  # noqa: BLE001
        return [], "没有 PyMuPDF：%s" % e

    got = []
    seen = set()          # 同一张图在每页都会出现一次（页眉 logo、水印、母版底纹），按内容去重
    doc = fitz.open(src)
    stem = os.path.splitext(os.path.basename(src))[0]
    try:
        for pno in range(len(doc)):
            if len(got) >= limit:
                break
            try:
                infos = doc.get_page_images(pno, full=True)
            except Exception:  # noqa: BLE001
                continue
            for idx, info in enumerate(infos):
                if len(got) >= limit:
                    break
                xref = info[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    # 带 alpha / CMYK 的处理：转成普通 RGB
                    if pix.n - pix.alpha >= 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    if pix.width < MIN_PX or pix.height < MIN_PX:
                        continue
                    data = pix.tobytes("png")
                    digest = hashlib.md5(data).hexdigest()
                    if digest in seen:
                        continue          # 页眉/水印/母版底纹，每页都一样
                    seen.add(digest)
                    name = "%s-p%d-%d.png" % (stem, pno + 1, idx + 1)
                    out = os.path.join(out_dir, _safe(name))
                    if _save_pixmap_bytes(data, out):
                        got.append({"path": out, "w": pix.width, "h": pix.height, "from": "p%d" % (pno + 1)})
                except Exception:  # noqa: BLE001
                    continue
    finally:
        doc.close()
    return got, ""


def from_office(src: str, out_dir: str, limit: int):
    """PPTX / DOCX / XLSX：都是 zip，媒体文件在 ppt/media、word/media、xl/media 里。"""
    ext = os.path.splitext(src)[1].lower()
    prefixes = {
        ".pptx": "ppt/media/", ".ppsx": "ppt/media/",
        ".docx": "word/media/", ".docm": "word/media/",
        ".xlsx": "xl/media/", ".xlsm": "xl/media/",
    }
    prefix = prefixes.get(ext)
    if not prefix:
        return [], "这个类型（%s）不是 Office 压缩包" % ext

    got = []
    stem = os.path.splitext(os.path.basename(src))[0]
    try:
        zf = zipfile.ZipFile(src)
    except Exception as e:  # noqa: BLE001
        return [], "打不开这个文件：%s" % e

    with zf:
        names = sorted(n for n in zf.namelist() if n.startswith(prefix) and not n.endswith("/"))
        for n in names:
            if len(got) >= limit:
                break
            base = os.path.basename(n)
            if os.path.splitext(base)[1].lower() not in RASTER_EXT:
                continue          # emf / wmf / svg 浏览器不认，跳过
            try:
                data = zf.read(n)
            except Exception:  # noqa: BLE001
                continue
            out = os.path.join(out_dir, _safe("%s-%s" % (stem, base)))
            if not _save_pixmap_bytes(data, out):
                continue
            w, h = _size_of(out)
            if w and h and (w < MIN_PX or h < MIN_PX):
                try:
                    os.remove(out)
                except OSError:
                    pass
                continue
            got.append({"path": out, "w": w, "h": h, "from": "media"})
    return got, ""


def _safe(name: str) -> str:
    """只留安全字符。**括号要去掉** —— 文件名会被写进 Markdown 的 ![说明](路径)，
    路径里带 `)` 会把语法截断，笔记里的图就插不进 Word 了。"""
    keep = []
    for ch in str(name):
        keep.append(ch if (ch.isalnum() or ch in "-_.[] ") else "_")
    return "".join(keep)[:120]


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    limit = 60
    for a in sys.argv[1:]:
        if a.startswith("--max"):
            try:
                limit = max(1, int(a.split("=", 1)[1])) if "=" in a else limit
            except Exception:  # noqa: BLE001
                pass
    if len(args) < 2:
        print(json.dumps({"ok": False, "error": "用法: extract_images.py <源文件> <输出目录>"}, ensure_ascii=False))
        return 1
    src, out_dir = args[0], args[1]
    if not os.path.isfile(src):
        print(json.dumps({"ok": False, "error": "源文件不存在"}, ensure_ascii=False))
        return 1
    os.makedirs(out_dir, exist_ok=True)

    ext = os.path.splitext(src)[1].lower()
    if ext == ".pdf":
        images, warn = from_pdf(src, out_dir, limit)
    elif ext in (".pptx", ".ppsx", ".docx", ".docm", ".xlsx", ".xlsm"):
        images, warn = from_office(src, out_dir, limit)
    else:
        images, warn = [], "这个类型（%s）抽不了图" % ext

    images = [i for i in images if i.get("w") != 0 or i.get("h") != 0] or images
    images.sort(key=lambda i: -(i.get("w", 0) * i.get("h", 0)))
    out = {"ok": True, "out": out_dir, "count": len(images), "images": images}
    if warn:
        out["warning"] = warn
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
