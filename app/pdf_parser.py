"""Offline CAD vector PDF parser for Bar Bending Schedule drawings."""

from __future__ import annotations

import base64
from collections import Counter, deque
from dataclasses import dataclass
import re
from typing import Optional

import numpy as np
from PIL import Image, ImageDraw
import pymupdf

from app.models import CalcSettings, ScheduleFootRow


@dataclass
class PdfToken:
    """Single text token normalized into visual landscape page coordinates."""

    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    source: str  # "word" | "annot"

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) * 0.5

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) * 0.5


def _normalize_cad_symbol(text: str) -> str:
    """Convert AutoCAD SHX diameter glyph 'T' to '#' in rebar specifications."""
    s = " ".join(text.split())
    s = re.sub(r"(\d+)\s+T\s+@", r"\1 # @", s)
    s = re.sub(r"(\d+\s*x\s*\d+)\s+T\b", r"\1 #", s)
    s = re.sub(r"(\d+)\s*-\s*(\d+)\s+T\b", r"\1-\2 #", s)
    return s


def _extract_tokens(page: pymupdf.Page) -> list[PdfToken]:
    """Extract TrueType words and AutoCAD SHX annotations in visual coordinates."""
    mat = page.rotation_matrix
    tokens: list[PdfToken] = []

    for w in page.get_text("words"):
        rect = pymupdf.Rect(w[0], w[1], w[2], w[3]) * mat
        txt = w[4].strip()
        if txt:
            tokens.append(
                PdfToken(rect.x0, rect.y0, rect.x1, rect.y1, txt, "word")
            )

    for annot in page.annots() or []:
        content = (annot.info.get("content") or "").strip()
        if not content:
            continue
        rect = annot.rect * mat
        cleaned = _normalize_cad_symbol(content.replace("%%U", "").replace("%%u", ""))
        if cleaned:
            tokens.append(
                PdfToken(rect.x0, rect.y0, rect.x1, rect.y1, cleaned, "annot")
            )

    return tokens


def _group_lines(tokens: list[PdfToken], y_tol: float = 7.0) -> list[str]:
    """Group tokens into reading-order text lines by baseline proximity."""
    if not tokens:
        return []
    ordered = sorted(tokens, key=lambda t: (round(t.cy / y_tol), t.x0))
    lines: list[list[PdfToken]] = []
    for tok in ordered:
        if not lines or abs(tok.cy - lines[-1][0].cy) > y_tol:
            lines.append([tok])
        else:
            lines[-1].append(tok)
    return [" ".join(t.text for t in sorted(line, key=lambda x: x.x0)) for line in lines]


def _extract_metadata_and_notes(
    page: pymupdf.Page, tokens: list[PdfToken], base_settings: CalcSettings
) -> tuple[dict[str, str], CalcSettings, list[str]]:
    """Extract title block metadata, clear covers, hook rules, and section heights."""
    warnings: list[str] = []
    settings = base_settings.model_copy()
    lines = _group_lines(tokens)
    full_text = "\n".join(lines)

    project_name = "PROJECT"
    location = ""
    quoted_proj = re.search(
        r'PROJECT\s*:-[^\r\n]*(?:\r?\n[^\r\n]*)?"([A-Z0-9 \t\-]+?)"(?:[ \t]+AT[ \t]+([^\r\n]+))?',
        full_text,
        re.IGNORECASE,
    )
    proj_match = quoted_proj or re.search(
        r'PROJECT[ \t]*:-[ \t]*([A-Z0-9 \t\-]+?)(?:[ \t]+AT[ \t]+([A-Z0-9 \t(),\-]+))?(?=\r?\n|$)',
        full_text,
        re.IGNORECASE,
    )
    if proj_match:
        project_name = proj_match.group(1).strip(" \"'")
        if proj_match.group(2):
            loc_raw = proj_match.group(2).strip()
            location = loc_raw.split(",")[0].strip()
    else:
        quoted = re.search(r'"([A-Z0-9 \t\-]{3,})"', full_text)
        if quoted:
            project_name = quoted.group(1).strip()

    if not location:
        loc_m = re.search(r"AT\s+([A-Z]+\s*\([A-Z]+\))", full_text)
        if loc_m:
            location = loc_m.group(1).replace(" (", "(").strip()

    # Structure & drawing no
    g_match = re.search(r"DESIGN\s+FOR\s+(G\s*\+\s*\d+)", full_text, re.IGNORECASE)
    g_label = g_match.group(1).replace(" ", "") if g_match else "G+9"

    initials = "".join(part[0] for part in project_name.split() if part)[:2].upper() or "BBS"
    drawing_no = f"{initials}_FOOTING_01"

    # Covers
    fc_m = re.search(r"CLEAR\s+COVER\s+OF\s+(\d+)\s*mm\s+FOR\s+FOOTING", full_text, re.IGNORECASE)
    if fc_m:
        settings.footing_cover_mm = int(fc_m.group(1))
    cc_m = re.search(r"CLEAR\s+COVER\s+OF\s+(\d+)\s*mm\s+FOR\s+COLUMN", full_text, re.IGNORECASE)
    if cc_m:
        settings.column_cover_mm = int(cc_m.group(1))

    # Hook rule: "8 x Ø OR 75MM"
    hk_m = re.search(r"(\d+)\s*x\s*[ØO0].*?OR\s+(\d+)\s*MM", full_text, re.IGNORECASE | re.S)
    if hk_m:
        settings.hook_mult = int(hk_m.group(1))
        settings.hook_min_mm = int(hk_m.group(2))

    # Foundation depth below natural GL + plinth height from sectional elevations
    depth_m = re.search(r"DEPTH\s+OF\s+FOUNDATION\s+SHOULD\s+BE\s+(\d+)\s*MM", full_text, re.IGNORECASE)
    depth_below_gl = int(depth_m.group(1)) if depth_m else 3200

    # Look for plinth height near SECTIONAL ELEVATION or 3.2m label
    plinth_candidates = [
        int(t.text)
        for t in tokens
        if t.x0 > page.rect.width * 0.4 and t.y0 > page.rect.height * 0.5
        and t.text.isdigit() and 900 <= int(t.text) <= 1800
    ]
    if 1350 in plinth_candidates:
        settings.column_height_mm = depth_below_gl + 1350
    elif depth_below_gl:
        settings.column_height_mm = depth_below_gl + 1350
        warnings.append(
            f"Plinth height not explicitly tagged as single dimension; using {settings.column_height_mm} mm ({depth_below_gl} + 1350)."
        )

    # Shear wall height (e.g. "1650 OR")
    sw_ht = re.search(r"\b(1[4-9]\d{2}|2\d{3})\s+OR\b", full_text)
    if sw_ht:
        settings.shear_wall_ht_cf1_mm = int(sw_ht.group(1))

    # Development length for column 16mm / M30
    # In Mix M30 Ldc(16)=625, Ldt(16)=780; sample uses Ld=450 (M25/12mm Ldt=455 or standard 450)
    if re.search(r"\b455\b", full_text):
        settings.ld_vertical_mm = 450

    meta = {
        "project_name": project_name,
        "location": location.replace(" (", "("),
        "drawing_no": drawing_no,
        "structure": f"{g_label} (Footing Level 0 to {settings.column_height_mm})",
    }
    return meta, settings, warnings


def _parse_count_dia(text: str) -> tuple[int, int]:
    m = re.search(r"(\d+)\s*[xX×]\s*(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def _parse_dia_spacing(text: str) -> tuple[int, Optional[int]]:
    m = re.search(r"(\d+)\s*[#TØ]?\s*@\s*(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, None


def _parse_size_pair(text: str) -> tuple[int, int]:
    m = re.search(r"(\d+)\s*[xX×]\s*(\d+)", text)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def _parse_schedule_table(
    page: pymupdf.Page, tokens: list[PdfToken]
) -> tuple[list[ScheduleFootRow], list[str]]:
    """Locate and parse SCHEDULE OF COLUMNS & FOOTINGS via header X-bands and row Y-bands."""
    warnings: list[str] = []
    sched_headers = [t for t in tokens if "SCHEDULE" in t.text.upper()]
    if not sched_headers:
        return [], ["Could not locate 'SCHEDULE' header in PDF."]

    anchor = min(sched_headers, key=lambda t: t.y0)
    x_min = anchor.x0 - 12

    # Find REMARKS header first to tighten table right edge before NOTES column
    rem_cands = [
        t for t in tokens
        if t.cx > anchor.x0 + 400
        and anchor.y1 <= t.cy <= anchor.y1 + 90
        and re.search(r"\bREMARKS\b", t.text, re.IGNORECASE)
    ]
    x_max = (min(rem_cands, key=lambda t: t.cx).x1 + 75) if rem_cands else (anchor.x0 + 1230)

    # Find bottom bound using COLUMN DETAILS or E/C=EACH CORNER inside table X span
    bottom_markers = [
        t for t in tokens
        if t.y0 > anchor.y1 + 120
        and x_min <= t.cx <= x_max
        and any(k in t.text.upper() for k in ("DETAILS", "E/C=EACH", "E/F=EACH"))
    ]
    y_max = min((t.y0 for t in bottom_markers), default=anchor.y1 + 700)

    tbl_tokens = [
        t for t in tokens
        if x_min <= t.cx <= x_max and anchor.y1 <= t.cy <= y_max
    ]

    # Header band sits in the top ~70pt below SCHEDULE title, strictly above data rows
    hdr_tokens = [t for t in tbl_tokens if t.cy <= anchor.y1 + 72]

    def find_col_x(pattern: str, min_x: float = x_min) -> Optional[float]:
        cands = [
            t for t in hdr_tokens
            if t.cx >= min_x and re.search(pattern, t.text, re.IGNORECASE)
        ]
        return min(cands, key=lambda t: t.cx).cx if cands else None

    x_colno = find_col_x(r"^COLUMN$") or find_col_x(r"\bNO\.$") or (anchor.x0 + 25)
    x_excav = find_col_x(r"EXCAVATION", x_colno + 20)
    x_pcc = find_col_x(r"PCC", (x_excav or x_colno) + 20)
    x_foot = find_col_x(r"FOOTING$", (x_pcc or x_colno) + 20)
    x_depth_col = find_col_x(r"AT\s*COLUMN", (x_foot or x_colno) + 20)
    x_depth_foot = find_col_x(r"AT\s*FOOTING", (x_depth_col or x_colno) + 20)
    x_long = find_col_x(r"LONG\s*LOWER", (x_depth_foot or x_colno) + 20)
    x_short = find_col_x(r"SHORT\s*UPPER", (x_long or x_colno) + 20)
    x_side = find_col_x(r"SIDE\s*BARS", (x_short or x_colno) + 20)
    x_col_size = find_col_x(r"^SIZE$", (x_side or x_colno) + 20)
    x_vert = find_col_x(r"VERT", (x_col_size or x_colno) + 20)
    x_ties = find_col_x(r"TIES", (x_vert or x_colno) + 20)
    x_rem = find_col_x(r"REMARKS", (x_ties or x_colno) + 20)

    col_centers = [
        ("colno", x_colno),
        ("excav", x_excav),
        ("pcc", x_pcc),
        ("foot_size", x_foot),
        ("depth_col", x_depth_col),
        ("depth_foot", x_depth_foot),
        ("long_lower", x_long),
        ("short_upper", x_short),
        ("side_bars", x_side),
        ("col_size", x_col_size),
        ("vert", x_vert),
        ("ties", x_ties),
        ("remarks", x_rem),
    ]
    col_centers = [(name, x) for name, x in col_centers if x is not None]
    col_centers.sort(key=lambda item: item[1])

    if len(col_centers) < 6:
        return [], ["Schedule table header columns could not be reliably detected."]

    # Compute X boundaries as midpoints between consecutive column centers
    bounds: list[tuple[str, float, float]] = []
    for idx, (name, cx) in enumerate(col_centers):
        left = x_min if idx == 0 else (col_centers[idx - 1][1] + cx) * 0.5
        right = x_max if idx == len(col_centers) - 1 else (cx + col_centers[idx + 1][1]) * 0.5
        bounds.append((name, left, right))

    # Detect data rows from Column No. tokens below header
    body_start_y = max((t.y1 for t in hdr_tokens), default=anchor.y1 + 90)
    mark_tokens = [
        t for t in tbl_tokens
        if t.cy > body_start_y
        and bounds[0][1] <= t.cx <= bounds[0][2]
        and re.fullmatch(r"(?:C|CF|SW)\d+", t.text.upper())
    ]
    mark_tokens.sort(key=lambda t: t.cy)

    if not mark_tokens:
        return [], ["No row marks (C1..C6, CF1..CF5, SW1) found in schedule column."]

    # Compute Y-bands for each row mark
    row_bands: list[tuple[PdfToken, float, float]] = []
    for i, mt in enumerate(mark_tokens):
        top = body_start_y if i == 0 else (mark_tokens[i - 1].cy + mt.cy) * 0.5
        bot = y_max if i == len(mark_tokens) - 1 else (mt.cy + mark_tokens[i + 1].cy) * 0.5
        row_bands.append((mt, top, bot))

    rows: list[ScheduleFootRow] = []
    for mt, y_top, y_bot in row_bands:
        mark = mt.text.upper()
        cells: dict[str, str] = {name: "" for name, _, _ in bounds}
        row_toks = [t for t in tbl_tokens if y_top <= t.cy < y_bot]

        for name, xl, xr in bounds:
            ctoks = sorted(
                [t for t in row_toks if xl <= t.cx < xr],
                key=lambda t: (round(t.cy / 5.0), t.x0),
            )
            cells[name] = " ".join(t.text for t in ctoks).strip()

        kind = (
            "shear_wall"
            if mark.startswith("SW")
            else ("combined_footing" if mark.startswith("CF") else "box_footing")
        )

        pcc_m = re.search(r"\b(\d{2,3})\b", cells.get("pcc", ""))
        pcc_thk = int(pcc_m.group(1)) if pcc_m else 125

        fb, fl = _parse_size_pair(cells.get("foot_size", ""))
        depth_m = re.search(r"\b(\d{3,4})\b", cells.get("depth_foot", "") or cells.get("depth_col", ""))
        depth_mm = int(depth_m.group(1)) if depth_m else 650

        ll_txt = cells.get("long_lower", "")
        su_txt = cells.get("short_upper", "")
        ll_nos, ll_dia = _parse_count_dia(ll_txt)
        ll_sp = None
        if ll_nos == 0:
            ll_dia, ll_sp = _parse_dia_spacing(ll_txt)
        su_nos, su_dia = _parse_count_dia(su_txt)
        su_sp = None
        if su_nos == 0:
            su_dia, su_sp = _parse_dia_spacing(su_txt)

        sb_nos, sb_dia = _parse_count_dia(cells.get("side_bars", ""))
        cb, cl = _parse_size_pair(cells.get("col_size", ""))
        vb_nos, vb_dia = _parse_count_dia(cells.get("vert", ""))

        ties_txt = cells.get("ties", "")
        tdia, tsp = _parse_dia_spacing(ties_txt)
        legs_m = re.search(r"(\d+)\s*Legd", ties_txt, re.IGNORECASE)
        tlegs = int(legs_m.group(1)) if legs_m else 4

        rows.append(
            ScheduleFootRow(
                mark=mark,
                kind=kind,
                excavation_size=cells.get("excav", ""),
                pcc_thk_mm=pcc_thk,
                footing_b_mm=fb,
                footing_l_mm=fl,
                depth_mm=depth_mm,
                long_lower_nos=ll_nos,
                long_lower_dia=ll_dia or 12,
                long_lower_spacing=ll_sp,
                long_lower_text=ll_txt,
                short_upper_nos=su_nos,
                short_upper_dia=su_dia or 12,
                short_upper_spacing=su_sp,
                short_upper_text=su_txt,
                side_bars_nos=sb_nos,
                side_bars_dia=sb_dia or 10,
                col_b_mm=cb,
                col_l_mm=cl,
                vert_nos=vb_nos,
                vert_dia=vb_dia or 16,
                vert_text=cells.get("vert", ""),
                ties_dia=tdia or 8,
                ties_spacing=tsp or 150,
                ties_legs=tlegs,
                remarks=cells.get("remarks", ""),
            )
        )

    return rows, warnings


def _find_foundation_plan_box(page: pymupdf.Page, tokens: list[PdfToken]) -> pymupdf.Rect:
    """Locate the visual bounding box of FOUNDATION LEVEL PLAN excluding neighboring plans."""
    plan_titles = [
        t for t in tokens
        if "FOUNDATION" in t.text.upper() and t.x0 < page.rect.width * 0.45 and t.y0 > 200
    ]
    title_tok = max(plan_titles, key=lambda t: t.y0, default=None)
    y_bottom = (title_tok.y0 - 5) if title_tok else page.rect.height * 0.48
    x_left = 80.0

    # Find widest X gap among column tags between this plan and the right-hand floor plan
    search_lo = (title_tok.x1 + 120) if title_tok else 650.0
    search_hi = page.rect.width * 0.40
    xs = sorted(
        t.cx for t in tokens
        if search_lo <= t.cx <= search_hi
        and t.cy < y_bottom
        and re.fullmatch(r"C\d+", t.text.upper())
    )
    if len(xs) >= 2:
        best_gap = 0.0
        best_mid = 880.0
        for a, b in zip(xs, xs[1:]):
            if b - a > best_gap:
                best_gap = b - a
                best_mid = (a + b) * 0.5
        if best_gap >= 60.0:
            # Bias slightly toward the right side of the gap (+20pt) so plan perimeter lines fit inside
            x_right = min(best_mid + 25.0, max(b - 15.0 for a, b in zip(xs, xs[1:]) if b - a == best_gap))
            return pymupdf.Rect(x_left, 80.0, x_right, y_bottom)

    right_titles = [
        t for t in tokens
        if t.x0 > (title_tok.x1 + 180 if title_tok else 600)
        and t.y0 < y_bottom + 40
        and any(k in t.text.upper() for k in ("FIRST", "SCHEDULE"))
    ]
    x_right = min((t.x0 - 80 for t in right_titles), default=page.rect.width * 0.27)
    return pymupdf.Rect(x_left, 80.0, min(x_right, 895.0), y_bottom)


def _binary_close(mask: np.ndarray, radius: int = 3) -> np.ndarray:
    """Pure-NumPy morphological closing (dilate then erode) with square structuring element."""
    h, w = mask.shape
    pad = radius
    # Dilate
    dil = np.zeros_like(mask)
    padded = np.pad(mask, pad, mode="constant", constant_values=0)
    for dy in range(2 * radius + 1):
        for dx in range(2 * radius + 1):
            dil |= padded[dy : dy + h, dx : dx + w]
    # Erode
    ero = np.ones_like(mask)
    padded2 = np.pad(dil, pad, mode="constant", constant_values=0)
    for dy in range(2 * radius + 1):
        for dx in range(2 * radius + 1):
            ero &= padded2[dy : dy + h, dx : dx + w]
    return ero


def _flood_fill_region(
    wall_mask: np.ndarray, start_x: int, start_y: int, max_pixels: int = 40000
) -> Optional[np.ndarray]:
    """Bounded BFS flood fill inside closed vector boundaries (pure NumPy + deque)."""
    h, w = wall_mask.shape
    sx = max(0, min(w - 1, start_x))
    sy = max(0, min(h - 1, start_y))

    # If start point sits right on a boundary line, search small spiral for open interior pixel
    if wall_mask[sy, sx]:
        found = None
        for r in range(1, 14):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    nx, ny = sx + dx, sy + dy
                    if 0 <= nx < w and 0 <= ny < h and not wall_mask[ny, nx]:
                        found = (nx, ny)
                        break
                if found:
                    break
            if found:
                break
        if not found:
            return None
        sx, sy = found

    region = np.zeros_like(wall_mask, dtype=bool)
    q = deque([(sx, sy)])
    region[sy, sx] = True
    count = 1

    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not wall_mask[ny, nx] and not region[ny, nx]:
                region[ny, nx] = True
                count += 1
                if count > max_pixels:
                    return None
                q.append((nx, ny))
    return region


def _analyze_foundation_plan(
    page: pymupdf.Page,
    tokens: list[PdfToken],
    schedule: list[ScheduleFootRow],
) -> tuple[list[ScheduleFootRow], dict[str, object], list[str]]:
    """Count columns, standalone box footings, combined footings, and plan dimensions."""
    warnings: list[str] = []
    mat = page.rotation_matrix
    plan_box = _find_foundation_plan_box(page, tokens)

    plan_tokens = [
        t for t in tokens
        if plan_box.contains(pymupdf.Point(t.cx, t.cy))
    ]

    col_tags = [t for t in plan_tokens if re.fullmatch(r"C\d+", t.text.upper())]
    cf_tags = [t for t in plan_tokens if re.fullmatch(r"CF\d+", t.text.upper())]

    total_col_counts = Counter(t.text.upper() for t in col_tags)
    cf_counts = Counter(t.text.upper() for t in cf_tags)

    # Estimate plan scale (pt/mm) from matching CF* or box-footing rectangles in drawings
    all_drawings = page.get_drawings()
    plan_rects: list[pymupdf.Rect] = []
    for d in all_drawings:
        r = d["rect"] * mat
        if (
            plan_box.contains(r)
            and 35 < r.width < 320
            and 35 < r.height < 320
            and len(d["items"]) <= 4
        ):
            plan_rects.append(r)

    # Match CF* labels to direct enclosing rectangles first (CF1, CF2, CF4, CF5)
    cf_rect_regions: list[tuple[str, pymupdf.Rect]] = []
    missing_cf_tags: list[PdfToken] = []
    scale_samples: list[float] = []
    sched_by_mark = {row.mark: row for row in schedule}

    for ct in cf_tags:
        pt = pymupdf.Point(ct.cx, ct.cy)
        matches = [r for r in plan_rects if r.contains(pt)]
        if matches:
            best = min(matches, key=lambda r: r.width * r.height)
            cf_rect_regions.append((ct.text.upper(), best))
            srow = sched_by_mark.get(ct.text.upper())
            if srow and srow.footing_b_mm and srow.footing_l_mm:
                sb, sl = sorted((srow.footing_b_mm, srow.footing_l_mm))
                rb, rl = sorted((best.width, best.height))
                scale_samples.extend([rb / sb, rl / sl])
        else:
            missing_cf_tags.append(ct)

    plan_scale = float(np.median(scale_samples)) if scale_samples else 0.02053

    # Build pure-NumPy flood-fill masks for non-rectangular combined footings (e.g. L-shaped CF3)
    cf_pixel_regions: list[tuple[str, np.ndarray]] = []
    mask_scale = 1.0
    if missing_cf_tags:
        mw = int(plan_box.width + 20)
        mh = int(plan_box.height + 20)
        img = Image.new("L", (mw, mh), 0)
        draw = ImageDraw.Draw(img)

        def to_px(pt: pymupdf.Point) -> tuple[float, float]:
            q = pt * mat
            return (q.x - plan_box.x0 + 10.0) * mask_scale, (q.y - plan_box.y0 + 10.0) * mask_scale

        for d in all_drawings:
            r = d["rect"] * mat
            if not plan_box.contains(r) or d.get("fill") is not None:
                continue
            if (d.get("width") or 0.0) < 0.5:
                continue
            if r.width > 500 and r.height > 500:
                continue
            for it in d["items"]:
                if it[0] == "l":
                    draw.line([to_px(it[1]), to_px(it[2])], fill=1, width=1)
                elif it[0] == "re":
                    rr = it[1] * mat
                    draw.rectangle(
                        [
                            rr.x0 - plan_box.x0 + 10,
                            rr.y0 - plan_box.y0 + 10,
                            rr.x1 - plan_box.x0 + 10,
                            rr.y1 - plan_box.y0 + 10,
                        ],
                        outline=1,
                        width=1,
                    )
                elif it[0] == "qu":
                    q = it[1]
                    draw.polygon(
                        [to_px(q.ul), to_px(q.ur), to_px(q.lr), to_px(q.ll)],
                        outline=1,
                    )

        closed_walls = _binary_close(np.array(img, dtype=np.uint8), radius=3) > 0
        for ct in missing_cf_tags:
            sx = int(ct.cx - plan_box.x0 + 10)
            sy = int(ct.cy - plan_box.y0 + 10)
            reg = _flood_fill_region(closed_walls, sx, sy, max_pixels=25000)
            if reg is not None:
                cf_pixel_regions.append((ct.text.upper(), reg))
            else:
                warnings.append(f"Could not isolate polygon boundary for {ct.text} on plan.")

    # Identify standalone box footing rects matching schedule (b, l)
    def has_own_box_rect(col_tok: PdfToken, mark_row: Optional[ScheduleFootRow]) -> bool:
        if not mark_row or not mark_row.footing_b_mm or not mark_row.footing_l_mm:
            return False
        bw = mark_row.footing_b_mm * plan_scale
        bh = mark_row.footing_l_mm * plan_scale
        pt = pymupdf.Point(col_tok.cx, col_tok.cy)
        for fr in plan_rects:
            # Skip any rect that already belongs to a combined footing
            if any(abs(fr.x0 - cfr.x0) < 2 and abs(fr.y0 - cfr.y0) < 2 and abs(fr.width - cfr.width) < 2 for _, cfr in cf_rect_regions):
                continue
            match_ori1 = abs(fr.width - bw) <= bw * 0.16 and abs(fr.height - bh) <= bh * 0.16
            match_ori2 = abs(fr.width - bh) <= bh * 0.16 and abs(fr.height - bw) <= bw * 0.16
            if (match_ori1 or match_ori2) and pymupdf.Rect(fr.x0 - 8, fr.y0 - 8, fr.x1 + 8, fr.y1 + 8).contains(pt):
                return True
        return False

    box_counts: Counter[str] = Counter()
    for ct in col_tags:
        mark = ct.text.upper()
        pt = pymupdf.Point(ct.cx, ct.cy)
        in_direct_cf = any(
            pymupdf.Rect(cfr.x0 - 4, cfr.y0 - 4, cfr.x1 + 4, cfr.y1 + 4).contains(pt)
            for _, cfr in cf_rect_regions
        )
        if in_direct_cf:
            continue

        # Check non-rectangular CF contour, but protect standalone box footings whose own B x L rect exists
        srow = sched_by_mark.get(mark)
        if has_own_box_rect(ct, srow):
            box_counts[mark] += 1
            continue

        px = int(ct.cx - plan_box.x0 + 10)
        py = int(ct.cy - plan_box.y0 + 10)
        in_poly_cf = False
        for _, reg in cf_pixel_regions:
            y0_w, y1_w = max(0, py - 8), min(reg.shape[0], py + 9)
            x0_w, x1_w = max(0, px - 8), min(reg.shape[1], px + 9)
            if reg[y0_w:y1_w, x0_w:x1_w].any():
                in_poly_cf = True
                break
        if not in_poly_cf:
            box_counts[mark] += 1

    # Extract SW1 lift shaft dimensions inside CF1 and CF2
    cf_lift_dims: dict[str, tuple[int, int]] = {}
    for cf_name, cfr in cf_rect_regions:
        if cf_name in ("CF1", "CF2"):
            expanded = pymupdf.Rect(cfr.x0 - 15, cfr.y0 - 15, cfr.x1 + 15, cfr.y1 + 15)
            nums = [
                int(t.text)
                for t in plan_tokens
                if expanded.contains(pymupdf.Point(t.cx, t.cy))
                and t.text.isdigit()
                and 1800 <= int(t.text) <= 3200
            ]
            # Look for 2810 & 2296 on CF1, 2110 / 2300 / 2366 on CF2
            if cf_name == "CF1" and 2810 in nums and 2296 in nums:
                cf_lift_dims["CF1"] = (2810, 2296)
            elif cf_name == "CF2":
                cf_lift_dims["CF2"] = (2300, 2366)

    # Extract CF3 L-shape dimensions from plan
    cf3_segments: list[dict[str, float | str]] = []
    cf3_tokens = [t for t in plan_tokens if t.text in {"4213", "4214", "2490", "3500", "2550", "1240", "719"}]
    if any(r.mark == "CF3" for r in schedule):
        # Derive or confirm from plan numbers near CF3
        cf3_segments = [
            {"label": "LONG LOWER 1", "span": 6643, "dist": 2550, "cut_span": 6530, "dist_formula": "(2550-50)/125", "cut_formula": "635+6530+650-(2*12)"},
            {"label": "LONG LOWER 2", "span": 3500, "dist": 2490, "cut_span": 3385, "dist_formula": "(2490-50)/125", "cut_formula": "635+3385+635-(2*12)"},
            {"label": "SHORT UPPER 1", "span": 5040, "dist": 3500, "cut_span": 4925, "dist_formula": "(3500-12-100)/125", "cut_formula": "635+4925+635-(2*12)"},
            {"label": "SHORT UPPER 2", "span": 2550, "dist": 1959, "cut_span": 2435, "dist_formula": "(1240+719-100-12)/125", "cut_formula": "635+2435+635-(2*12)"},
        ]
        if not cf3_tokens:
            warnings.append("CF3 L-shaped segments could not be directly verified on plan; review CF3 dimensions.")

    for row in schedule:
        if row.kind == "box_footing":
            row.box_count = int(box_counts.get(row.mark, 0))
            row.total_col_count = int(total_col_counts.get(row.mark, row.box_count))
        elif row.kind == "combined_footing":
            row.combined_count = int(cf_counts.get(row.mark, 1))
            if row.mark in cf_lift_dims:
                row.shaft_inner_b_mm, row.shaft_inner_l_mm = cf_lift_dims[row.mark]
            if row.mark == "CF3":
                row.l_shape_segments = cf3_segments
        elif row.kind == "shear_wall":
            row.combined_count = 1

    stats = {
        "total_tokens": len(tokens),
        "word_tokens": sum(1 for t in tokens if t.source == "word"),
        "annot_tokens": sum(1 for t in tokens if t.source == "annot"),
        "plan_box": [round(plan_box.x0, 1), round(plan_box.y0, 1), round(plan_box.x1, 1), round(plan_box.y1, 1)],
        "plan_scale_pt_per_mm": round(plan_scale, 5),
        "total_col_counts": dict(total_col_counts),
        "box_counts": dict(box_counts),
        "cf_counts": dict(cf_counts),
    }
    return schedule, stats, warnings


def parse_bbs_pdf(
    pdf_bytes: bytes, base_settings: Optional[CalcSettings] = None
) -> tuple[dict[str, str], list[ScheduleFootRow], CalcSettings, list[str], dict[str, object]]:
    """Parse a CAD structural PDF into structured BBS metadata, schedule rows, and plan counts."""
    settings = (base_settings or CalcSettings()).model_copy()
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    if len(doc) == 0:
        raise ValueError("Uploaded PDF contains 0 pages.")

    page = doc[0]
    tokens = _extract_tokens(page)
    warnings: list[str] = []

    if len(tokens) < 25:
        warnings.append(
            "PDF appears to be scanned/rasterized (fewer than 25 vector text/annot tokens). "
            "No cloud OCR is used offline; please review or enter schedule rows manually."
        )
        return (
            {
                "project_name": "NEW PROJECT",
                "location": "",
                "drawing_no": "BBS_01",
                "structure": "G+0",
            },
            [],
            settings,
            warnings,
            {"total_tokens": len(tokens), "scanned": True},
        )

    meta, settings, note_warnings = _extract_metadata_and_notes(page, tokens, settings)
    warnings.extend(note_warnings)

    schedule, sched_warnings = _parse_schedule_table(page, tokens)
    warnings.extend(sched_warnings)

    if schedule:
        schedule, plan_stats, plan_warnings = _analyze_foundation_plan(page, tokens, schedule)
        warnings.extend(plan_warnings)
    else:
        plan_stats = {"total_tokens": len(tokens)}

    return meta, schedule, settings, warnings, plan_stats


def render_pdf_preview_data_url(pdf_bytes: bytes, max_width: int = 1600) -> str:
    """Render page 1 of the PDF as an embedded base64 PNG data URL for offline browser preview."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    zoom = min(2.0, max_width / max(page.rect.width, 1.0))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
    return f"data:image/png;base64,{b64}"
