"""
dsh-study-coach / _figure.py

把题目自带的图（顶点 + 边 + 权重）画成 PNG —— 给 Word 排版用。

为什么不和面板共用一份代码：面板里画的是 SVG（浏览器现画，缩放不糊），
docx 要的是位图。两边的布局规则必须对着来 ——
布局在 `lib/client.js` 的 paperFigureSvg() 和这里各有一份，改一处记得改另一处。

线画在 4 倍大的画布上再缩回去，边缘才不狗牙（PIL 的 line 不抗锯齿）。
"""

from __future__ import annotations

import os
import platform

from PIL import Image, ImageDraw, ImageFont

SS = 4                    # 超采样倍数
LOGIC_W = 380             # 与 client.js 的 viewBox 一致
LOGIC_H = 320
EDGE_R = 48               # 圆周半径 = min(W,H)/2 - 48，和前端同一个值

BG = (255, 255, 255)
INK = (26, 29, 33)
ACCENT = (11, 143, 122)
EDGE = (120, 128, 140)


def _font_candidates():
    sysname = platform.system()
    if sysname == "Windows":
        root = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
        return [
            os.path.join(root, "arialbd.ttf"),
            os.path.join(root, "arial.ttf"),
            os.path.join(root, "segoeuib.ttf"),
            os.path.join(root, "msyhbd.ttc"),
            os.path.join(root, "msyh.ttc"),
        ]
    if sysname == "Darwin":
        return [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ]
    return [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]


def _font(size: int):
    """按平台找一个能用的字体文件；一个都找不到就用内置点阵字体（丑但能看）。"""
    for p in _font_candidates():
        try:
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)      # Pillow >= 9.1
    except Exception:
        return ImageFont.load_default()


def _text_size(draw, text, font):
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1], box


def normalize(fig):
    """和 lib/paper.js 的 normalizeFigure() 同一个口径：认不出就返回 None。"""
    if not isinstance(fig, dict):
        return None
    kind = str(fig.get("kind") or "graph").lower()
    if kind not in ("graph", "tree"):
        return None
    raw_nodes = fig.get("nodes") or []
    raw_edges = fig.get("edges") or []
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        return None
    if not raw_nodes or not raw_edges:
        return None

    nodes = []
    for n in raw_nodes:
        if isinstance(n, dict):
            nid = str(n.get("id") or n.get("name") or n.get("label") or "").strip()
            label = str(n.get("label") or n.get("name") or n.get("id") or nid).strip()
        else:
            nid = label = str(n or "").strip()
        if nid:
            nodes.append({"id": nid, "label": label or nid})
    if len(nodes) < 2:
        return None
    ids = {n["id"] for n in nodes}

    edges = []
    for e in raw_edges:
        if isinstance(e, (list, tuple)):
            if len(e) < 2:
                continue
            a, b = str(e[0]).strip(), str(e[1]).strip()
            w = "" if len(e) < 3 or e[2] in (None, "") else str(e[2]).strip()
        elif isinstance(e, dict):
            a = str(e.get("from") or e.get("a") or e.get("u") or e.get("source") or "").strip()
            b = str(e.get("to") or e.get("b") or e.get("v") or e.get("target") or "").strip()
            wv = e.get("w", e.get("weight", e.get("cost", e.get("dist", ""))))
            w = "" if wv in (None, "") else str(wv).strip()
        else:
            continue
        if a and b and a != b and a in ids and b in ids:
            edges.append({"a": a, "b": b, "w": w})
    if not edges:
        return None

    return {
        "kind": kind,
        "directed": bool(fig.get("directed")) if kind == "graph" else False,
        "nodes": nodes,
        "edges": edges,
    }


def render_figure(fig, out_png, width_px: int = 900) -> dict:
    """
    画图并写到 out_png。返回 {'ok': True, 'out': path, 'w': px, 'h': px}
    或者 {'ok': False, 'error': '...'}。
    """
    f = normalize(fig)
    if not f:
        return {"ok": False, "error": "figure 结构认不出来"}

    scale = (width_px / LOGIC_W) * SS
    W = int(LOGIC_W * scale)
    H = int(LOGIC_H * scale)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    import math

    cx, cy = W / 2, H / 2
    R = (min(W, H) / 2) - EDGE_R * scale
    pos = {}
    n = len(f["nodes"])
    for i, node in enumerate(f["nodes"]):
        a = (i / n) * math.tau - math.pi / 2
        pos[node["id"]] = (cx + math.cos(a) * R, cy + math.sin(a) * R)

    node_r = 16 * scale
    edge_w = max(1, int(1.6 * scale))
    font_w = _font(max(9, int(12 * scale)))
    font_n = _font(max(9, int(12.5 * scale)))

    # 边
    for e in f["edges"]:
        p, q = pos.get(e["a"]), pos.get(e["b"])
        if not p or not q:
            continue
        d.line([p, q], fill=EDGE, width=edge_w)

    # 有向箭头
    if f["directed"]:
        for e in f["edges"]:
            p, q = pos.get(e["a"]), pos.get(e["b"])
            if not p or not q:
                continue
            ang = math.atan2(q[1] - p[1], q[0] - p[0])
            tipx = q[0] - math.cos(ang) * (node_r + 2 * scale)
            tipy = q[1] - math.sin(ang) * (node_r + 2 * scale)
            s = 7 * scale
            left = (tipx - math.cos(ang - 0.42) * s * 1.7, tipy - math.sin(ang - 0.42) * s * 1.7)
            right = (tipx - math.cos(ang + 0.42) * s * 1.7, tipy - math.sin(ang + 0.42) * s * 1.7)
            d.polygon([(tipx, tipy), left, right], fill=EDGE)

    # 权重：白底方框 + 深色数字（跟前面板长得一样）
    for e in f["edges"]:
        if not e["w"]:
            continue
        p, q = pos.get(e["a"]), pos.get(e["b"])
        if not p or not q:
            continue
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        tw, th, box = _text_size(d, e["w"], font_w)
        pad_x, pad_y = 5 * scale, 3 * scale
        bw, bh = tw + pad_x * 2, th + pad_y * 2 + (box[1] * 0.4)
        x0, y0 = mx - bw / 2, my - bh / 2
        d.rectangle([x0, y0, x0 + bw, y0 + bh], fill=BG, outline=(216, 222, 230), width=max(1, int(scale)))
        d.text((mx - tw / 2 - box[0], my - th / 2 - box[1]), e["w"], font=font_w, fill=ACCENT)

    # 顶点
    for node in f["nodes"]:
        p = pos.get(node["id"])
        if not p:
            continue
        d.ellipse(
            [p[0] - node_r, p[1] - node_r, p[0] + node_r, p[1] + node_r],
            fill=BG, outline=INK, width=max(2, int(1.8 * scale)),
        )
        label = node["label"] or node["id"]
        tw, th, bx = _text_size(d, label, font_n)
        d.text((p[0] - tw / 2 - bx[0], p[1] - th / 2 - bx[1]), label, font=font_n, fill=INK)

    # 缩小回目标尺寸：4 倍超采样的抗锯齿在这一步生效
    img = img.resize((int(W / SS), int(H / SS)), Image.LANCZOS)

    os.makedirs(os.path.dirname(os.path.abspath(out_png)) or ".", exist_ok=True)
    img.save(out_png, "PNG")
    return {"ok": True, "out": out_png, "w": img.width, "h": img.height}


if __name__ == "__main__":  # 手工试一下：python _figure.py out.png
    import json
    import sys

    demo = {
        "kind": "graph",
        "nodes": ["A", "B", "C", "D", "E"],
        "edges": [["A", "B", 4], ["A", "C", 2], ["B", "C", 1], ["B", "D", 5], ["C", "D", 8], ["C", "E", 10], ["D", "E", 2]],
    }
    out = sys.argv[1] if len(sys.argv) > 1 else "figure-demo.png"
    print(json.dumps(render_figure(demo, out), ensure_ascii=False))
