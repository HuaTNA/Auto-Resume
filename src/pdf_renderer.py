"""Portable PDF fallback used when a TeX engine is unavailable."""

from __future__ import annotations

import html
import io
import re

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


def _command_argument(line: str, command: str) -> str | None:
    prefix = f"\\{command}{{"
    start = line.find(prefix)
    if start < 0:
        return None
    depth = 1
    value_start = start + len(prefix)
    for index in range(value_start, len(line)):
        if line[index] == "{":
            depth += 1
        elif line[index] == "}":
            depth -= 1
            if depth == 0:
                return line[value_start:index]
    return None


def _plain_latex(value: str) -> str:
    value = re.sub(r"\\href\{[^{}]*\}\{([^{}]*)\}", r"\1", value)
    value = re.sub(r"\\(?:textbf|textit|emph|underline)\{([^{}]*)\}", r"\1", value)
    replacements = {
        r"\&": "&", r"\%": "%", r"\$": "$", r"\#": "#",
        r"\_": "_", r"\{": "{", r"\}": "}", "~": " ",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)
    value = re.sub(r"\\[a-zA-Z@]+\*?(?:\[[^]]*\])?", " ", value)
    value = value.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", value).strip()


def latex_to_blocks(tex_content: str) -> list[tuple[str, str]]:
    """Convert the resume template's semantic LaTeX commands to PDF blocks."""
    document = re.search(r"\\begin\{document\}(.*?)\\end\{document\}", tex_content, re.S)
    source = document.group(1) if document else tex_content
    blocks: list[tuple[str, str]] = []

    for raw_line in source.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("%"):
            continue
        section = _command_argument(line, "section")
        if section is not None:
            blocks.append(("section", _plain_latex(section)))
            continue
        item = _command_argument(line, "resumeItem")
        if item is not None:
            blocks.append(("bullet", _plain_latex(item)))
            continue
        heading = _command_argument(line, "resumeSubheading")
        if heading is not None:
            arguments = re.findall(r"\{([^{}]*)\}", line)
            text = " · ".join(_plain_latex(part) for part in arguments[:4] if _plain_latex(part))
            blocks.append(("heading", text))
            continue
        if line.startswith("\\") or line in {"[", "]"}:
            continue
        plain = _plain_latex(line)
        if plain:
            blocks.append(("body", plain))

    return blocks or [("body", "No printable content was found.")]


def render_pdf(blocks: list[tuple[str, str]], title: str = "Document") -> bytes:
    """Render structured text blocks into a restrained, portable PDF."""
    buffer = io.BytesIO()
    try:
        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        font = "STSong-Light"
    except Exception:
        font = "Helvetica"

    styles = getSampleStyleSheet()
    body = ParagraphStyle("HuaBody", parent=styles["BodyText"], fontName=font, fontSize=9.4, leading=14, textColor=HexColor("#1E1A14"), spaceAfter=5)
    heading = ParagraphStyle("HuaHeading", parent=body, fontSize=10.5, leading=15, spaceBefore=5, spaceAfter=2)
    section = ParagraphStyle("HuaSection", parent=body, fontSize=11, leading=15, spaceBefore=12, spaceAfter=5, borderColor=HexColor("#B8A98A"), borderWidth=0, borderPadding=(0, 0, 3, 0))
    title_style = ParagraphStyle("HuaTitle", parent=body, fontSize=16, leading=20, alignment=TA_CENTER, spaceAfter=12)
    bullet = ParagraphStyle("HuaBullet", parent=body, leftIndent=12, firstLineIndent=-8, bulletIndent=0)

    document = SimpleDocTemplate(buffer, pagesize=LETTER, rightMargin=0.62 * inch, leftMargin=0.62 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch, title=title)
    story = [Paragraph(html.escape(title), title_style), Spacer(1, 4)]
    style_map = {"body": body, "heading": heading, "section": section, "bullet": bullet}
    for kind, text in blocks:
        safe = html.escape(text)
        if kind == "bullet":
            safe = f"• {safe}"
        story.append(Paragraph(safe, style_map.get(kind, body)))
    document.build(story)
    return buffer.getvalue()


def render_latex_fallback(tex_content: str, title: str = "Resume") -> bytes:
    return render_pdf(latex_to_blocks(tex_content), title)
