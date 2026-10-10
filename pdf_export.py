"""Generate readable, selectable travel-plan PDFs on the server."""

from __future__ import annotations

import re
from functools import lru_cache
from html import escape
from io import BytesIO
from pathlib import Path

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


INK = colors.HexColor("#20392b")
BODY = colors.HexColor("#526359")
GREEN = colors.HexColor("#1e604b")
MUTED = colors.HexColor("#829187")
RULE = colors.HexColor("#e5ebe4")


@lru_cache(maxsize=1)
def _register_fonts() -> None:
    font_dir = Path(reportlab.__file__).resolve().parent / "fonts"
    pdfmetrics.registerFont(TTFont("TripMate", str(font_dir / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("TripMate-Bold", str(font_dir / "VeraBd.ttf")))
    pdfmetrics.registerFontFamily(
        "TripMate",
        normal="TripMate",
        bold="TripMate-Bold",
        italic="TripMate",
        boldItalic="TripMate-Bold",
    )


def _inline_markup(text: str) -> str:
    """Escape model output, then retain a small safe subset of Markdown."""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    safe_text = escape(text, quote=False)
    safe_text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", safe_text)
    safe_text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", safe_text)
    safe_text = re.sub(r"`([^`]+)`", r"<font name='TripMate'>\1</font>", safe_text)
    return safe_text


def _make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TripTitle",
            parent=base["Title"],
            fontName="TripMate-Bold",
            fontSize=19,
            leading=25,
            alignment=TA_LEFT,
            textColor=INK,
            spaceAfter=9,
        ),
        "h2": ParagraphStyle(
            "TripHeading2",
            parent=base["Heading2"],
            fontName="TripMate-Bold",
            fontSize=13,
            leading=18,
            textColor=INK,
            spaceBefore=13,
            spaceAfter=6,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "TripHeading3",
            parent=base["Heading3"],
            fontName="TripMate-Bold",
            fontSize=10.5,
            leading=15,
            textColor=GREEN,
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "TripBody",
            parent=base["BodyText"],
            fontName="TripMate",
            fontSize=9.3,
            leading=15,
            textColor=BODY,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "TripBullet",
            parent=base["BodyText"],
            fontName="TripMate",
            fontSize=9.2,
            leading=14,
            leftIndent=14,
            firstLineIndent=-10,
            textColor=BODY,
            spaceAfter=4,
        ),
        "eyebrow": ParagraphStyle(
            "TripEyebrow",
            parent=base["Normal"],
            fontName="TripMate-Bold",
            fontSize=7,
            leading=10,
            textColor=MUTED,
            spaceAfter=8,
        ),
    }


def _story_from_markdown(markdown: str):
    styles = _make_styles()
    story = [
        Paragraph("TRIPMATE AI  |  YOUR JOURNEY", styles["eyebrow"]),
        HRFlowable(width="100%", thickness=0.7, color=RULE, spaceAfter=16),
    ]

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            story.append(Spacer(1, 3))
            continue
        if re.fullmatch(r"[-*_]{3,}", line):
            story.append(HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=5, spaceAfter=9))
            continue

        heading = re.match(r"^(#{1,3})\s+(.+)$", line)
        if heading:
            level = len(heading.group(1))
            story.append(Paragraph(_inline_markup(heading.group(2)), styles["title"] if level == 1 else styles[f"h{level}"]))
            continue

        bullet = re.match(r"^(?:[-*]|•)\s+(.+)$", line)
        if bullet:
            story.append(Paragraph(f"-  {_inline_markup(bullet.group(1))}", styles["bullet"]))
            continue

        numbered = re.match(r"^(\d+[.)])\s+(.+)$", line)
        if numbered:
            story.append(Paragraph(f"{escape(numbered.group(1))}  {_inline_markup(numbered.group(2))}", styles["bullet"]))
            continue

        story.append(Paragraph(_inline_markup(line), styles["body"]))

    return story


def _draw_page_chrome(canvas, document) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(document.leftMargin, height - 36, width - document.rightMargin, height - 36)
    canvas.setFont("TripMate-Bold", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(document.leftMargin, height - 27, "TRIPMATE AI")
    canvas.setFont("TripMate", 7)
    canvas.drawRightString(width - document.rightMargin, 24, f"Page {document.page}")
    canvas.restoreState()


def build_travel_pdf(markdown: str) -> bytes:
    """Render Markdown-like itinerary text into a paginated PDF byte string."""
    _register_fonts()
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=52,
        leftMargin=52,
        topMargin=54,
        bottomMargin=45,
        title="TripMate AI Travel Plan",
        author="TripMate AI",
    )
    story = _story_from_markdown(markdown)
    document.build(story, onFirstPage=_draw_page_chrome, onLaterPages=_draw_page_chrome)
    return output.getvalue()
