"""
dsh-study-coach / _fonts.py

按平台挑字体名。

为什么需要：docx / pptx 里存的是**字体名字**，渲染时才由 Word / Keynote 去找。
写死「微软雅黑」在 macOS 上找不到，Word 会回退成默认字体 —— 版面立刻塌。
反过来在 Linux 上写「宋体」也一样。

这里只给「该平台默认装了就有的名字」，不检测字体文件：
- 检测字体文件要遍历系统字体目录，几十毫秒，而结果只影响观感
- 存名字进文件，跨机器打开时由对方的 Office 决定怎么回退，是正常做法
"""

from __future__ import annotations

import platform


def font_set() -> dict:
    """返回 {'cjk', 'serif', 'sans', 'mono'} 四个字体名。"""
    sysname = platform.system()

    if sysname == "Darwin":  # macOS
        return {
            "cjk": "PingFang SC",       # 苹方，系统自带
            "serif": "Times New Roman",
            "sans": "Helvetica Neue",
            "mono": "Menlo",
        }

    if sysname == "Windows":
        return {
            "cjk": "微软雅黑",
            "serif": "Times New Roman",
            "sans": "微软雅黑",
            "mono": "Consolas",
        }

    # Linux 及其他：Noto / Liberation 是绝大多数发行版的默认包
    return {
        "cjk": "Noto Sans CJK SC",
        "serif": "Liberation Serif",
        "sans": "DejaVu Sans",
        "mono": "DejaVu Sans Mono",
    }


def set_east_asia(run_or_style_element, font_name: str) -> None:
    """给 w:rPr / w:pPr 里的 w:rFonts 补上 w:eastAsia —— 中文必须单独设这一项。"""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    rpr = run_or_style_element
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), font_name)
    return rfonts
