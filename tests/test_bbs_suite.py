"""Portable test suite for offline CAD PDF parsing, BBS math, DrawingML XLSX export, and FastAPI."""

from __future__ import annotations

import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

from fastapi.testclient import TestClient
import openpyxl
import pymupdf
import pytest

from app.bbs_calculator import build_bbs_document, compute_weight_kg, recalculate_document
from app.main import app
from app.models import CalcSettings, ScheduleFootRow
from app.pdf_parser import parse_bbs_pdf
from app.xlsx_exporter import export_bbs_xlsx

SAMPLE_PDF_LOCAL = Path(
    r"C:\Users\DELL\.gemini\antigravity\brain\e54f59fe-69f9-4756-a44e-dad5f51add13\.user_uploaded\media_1794408262193_440da2ba.pdf"
)
SAMPLE_XLSX_LOCAL = Path(
    r"C:\Users\DELL\.gemini\antigravity\brain\e54f59fe-69f9-4756-a44e-dad5f51add13\.user_uploaded\media_1794408257366_30e16730.xlsx"
)


def _make_synthetic_cad_pdf() -> bytes:
    """Create a self-contained CAD-style vector PDF with Schedule, Notes, and Foundation Plan."""
    doc = pymupdf.open()
    page = doc.new_page(width=2000, height=1400)

    # Notes & Title Block
    page.insert_text((1500, 80), 'NOTES:-', fontsize=14)
    page.insert_text((1500, 105), '# PROVIDE CLEAR COVER OF 50 mm FOR FOOTING R/F.', fontsize=10)
    page.insert_text((1500, 125), '# PROVIDE CLEAR COVER OF 40 mm FOR COLUMN R/F.', fontsize=10)
    page.insert_text((1500, 145), '# DEPTH OF FOUNDATION SHOULD BE 3200 MM', fontsize=10)
    page.insert_text((1500, 220), 'DETAILS OF RING HOOK 8 x O OR 75MM', fontsize=10)
    page.insert_text((1500, 900), 'DESIGN FOR G+5', fontsize=12)
    page.insert_text((1500, 930), 'PROJECT :- "ALPHA TOWERS" AT NAGPUR(EAST)', fontsize=11)
    page.insert_text((1500, 1050), '1350', fontsize=10)

    # Schedule Table Header (Y=100..155)
    page.insert_text((700, 90), 'SCHEDULE OF COLUMNS & FOOTINGS', fontsize=14)
    cols = [
        (710, 130, 'COLUMN'), (710, 145, 'NO.'),
        (780, 130, 'EXCAVATION'), (780, 145, 'SIZE'),
        (860, 130, 'PCC'), (860, 145, 'THK.'),
        (930, 130, 'FOOTING'), (930, 145, 'SIZE'),
        (1010, 145, 'AT COLUMN'), (1080, 145, 'AT FOOTING'),
        (1150, 145, 'LONG LOWER'), (1230, 145, 'SHORT UPPER'),
        (1310, 145, 'SIDE BARS'), (1380, 145, 'SIZE'),
        (1440, 145, 'VERT.BARS'), (1510, 145, 'TIES'), (1580, 145, 'REMARKS'),
    ]
    for x, y, txt in cols:
        page.insert_text((x, y), txt, fontsize=8)

    # Row C1 (Y=180) and CF1 (Y=220)
    row_c1 = [
        (710, 180, 'C1'), (780, 180, '2500 x 2900'), (860, 180, '125'),
        (930, 180, '2300 x 2700'), (1010, 180, '650'), (1080, 180, '650'),
        (1150, 180, '18 x 12'), (1230, 180, '20 x 12'), (1310, 180, '2 x 10'),
        (1380, 180, '300x600'), (1440, 180, '12x16'), (1510, 180, '8 @150 4 Legd.'),
        (1580, 180, 'BOX'),
    ]
    row_cf4 = [
        (710, 220, 'CF4'), (780, 220, '3300 x 6200'), (860, 220, '125'),
        (930, 220, '3100 x 6000'), (1010, 220, '750'), (1080, 220, '750'),
        (1150, 220, '12 # @ 125'), (1230, 220, '12 # @ 125'), (1310, 220, '3 x 10'),
        (1380, 220, '-'), (1440, 220, '-'), (1510, 220, '-'),
        (1580, 220, 'COMBINED'),
    ]
    for x, y, txt in row_c1 + row_cf4:
        page.insert_text((x, y), txt, fontsize=8)

    # Foundation Level Plan (X=100..650, Y=120..700)
    # 2 standalone C1 box footings (approx 47x55 pt at 0.0205 scale)
    for bx, by in [(160, 200), (260, 200)]:
        page.draw_rect(pymupdf.Rect(bx, by, bx + 47, by + 55), width=0.6)
        page.insert_text((bx + 15, by + 28), 'C1', fontsize=9)

    # 1 combined footing CF4 (64x123 pt) holding 2 C1 columns inside it
    cf_rect = pymupdf.Rect(160, 340, 283, 404)
    page.draw_rect(cf_rect, width=0.6)
    page.insert_text((215, 372), 'CF4', fontsize=9)
    page.insert_text((180, 372), 'C1', fontsize=9)
    page.insert_text((255, 372), 'C1', fontsize=9)

    page.insert_text((220, 740), 'FOUNDATION LEVEL PLAN', fontsize=12)
    return doc.tobytes()


def test_weight_formula_accuracy() -> None:
    # 144 * 3.676 * (12^2 / 162) == 470.528
    assert compute_weight_kg(144, 3676, 12) == pytest.approx(470.528, abs=1e-6)
    assert compute_weight_kg(0, 500, 12) == 0.0


def test_synthetic_cad_pdf_end_to_end() -> None:
    pdf_bytes = _make_synthetic_cad_pdf()
    meta, sched, settings, warnings, stats = parse_bbs_pdf(pdf_bytes)

    assert meta["project_name"] == "ALPHA TOWERS"
    assert meta["location"] == "NAGPUR(EAST)"
    assert settings.footing_cover_mm == 50
    assert settings.column_cover_mm == 40
    assert settings.column_height_mm == 4550

    by_mark = {r.mark: r for r in sched}
    assert "C1" in by_mark and "CF4" in by_mark
    assert by_mark["C1"].box_count == 2
    assert by_mark["C1"].total_col_count == 4  # 2 standalone + 2 inside CF4
    assert by_mark["CF4"].combined_count == 1

    doc = build_bbs_document(meta, sched, settings, warnings, stats)
    assert doc.total_weight_mt > 0

    # User-entered Chairs/Spacers must flow through live Excel formulas just like design rows
    chairs = next(r for r in doc.rows if r.id == "chairs_wastage")
    chairs.span_mm = 1000.0
    chairs.nos = 10.0
    doc = recalculate_document(doc)
    assert chairs.weight_kg == pytest.approx(10.0 * 1.0 * (144.0 / 162.0), abs=1e-9)

    xlsx_bytes = export_bbs_xlsx(doc)
    wb_f = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    wb_v = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    ws = wb_f["FORMAT"]
    ws_v = wb_v["FORMAT"]
    assert ws["S2"].value == 50.0  # Footing Cover constant cell
    assert ws["W3"].value == 162.0  # Unit Wt divisor constant cell
    assert ws["Y3"].value == 1000.0  # Kg/MT scale constant cell
    assert ws["Z8"].value == 650.0  # Footing Depth parameter cell
    assert ws["L8"].value == "=AC8*AD8"
    assert ws["M8"].value == "=+L8*K8"
    assert ws["N8"].value == "=(Z8-2*$S$2)+(D8-2*$S$2)+(Z8-2*$S$2)-(2*E8)"
    assert ws["P8"].value == "=IF($E8=P$6,$M8,0)*($N8*$E8*$E8/($W$3*$Y$3))"

    # Verify Chairs row also uses formulas AND cached <v> is populated for data_only readers
    chairs_r = 8 + doc.rows.index(next(r for r in doc.rows if r.id == "chairs_wastage"))
    assert ws[f"L{chairs_r}"].value == f"=AC{chairs_r}*AD{chairs_r}"
    assert ws[f"M{chairs_r}"].value == f"=+L{chairs_r}*K{chairs_r}"
    assert ws[f"N{chairs_r}"].value == f"=D{chairs_r}"
    assert ws[f"R{chairs_r}"].value == f"=IF($E{chairs_r}=R$6,$M{chairs_r},0)*($N{chairs_r}*$E{chairs_r}*$E{chairs_r}/($W$3*$Y$3))"
    assert ws_v[f"R{chairs_r}"].value == pytest.approx(10.0 * 1.0 * (144.0 / 162.0), abs=1e-9)

    # Mutating a global constant must recalculate dependent UI/model values with zero rounding
    doc.settings.footing_cover_mm = 40.0
    updated_doc = recalculate_document(doc)
    assert updated_doc.rows[0].cut_length_mm == 3736.0  # (650-80)+(2700-80)+(650-80)-24

    # Verify DrawingML XML integrity
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as z:
        assert "xl/drawings/drawing1.xml" in z.namelist()
        droot = ET.fromstring(z.read("xl/drawings/drawing1.xml"))
        ids = [el.attrib["id"] for el in droot.iter() if el.tag.endswith("cNvPr")]
        assert len(ids) > 0
        assert len(ids) == len(set(ids))
        assert "rIdDrawing1" in z.read("xl/worksheets/_rels/sheet1.xml.rels").decode()


def test_scanned_pdf_fallback_warning() -> None:
    doc = pymupdf.open()
    doc.new_page(width=400, height=400)
    meta, sched, _, warnings, stats = parse_bbs_pdf(doc.tobytes())
    assert sched == []
    assert stats.get("scanned") is True
    assert any("scanned/rasterized" in w for w in warnings)


def test_uniform_strict_geometry_and_arbitrary_l_shape_polygon() -> None:
    # 1. Even if legacy mode string is supplied, uniform zero-hardcoding unrounded geometry applies
    sched = [
        ScheduleFootRow(
            mark="CF_CUSTOM",
            kind="combined_footing",
            footing_b_mm=3100,
            footing_l_mm=6000,
            depth_mm=750,
            long_lower_dia=12,
            long_lower_spacing=125,
            side_bars_nos=3,
            side_bars_dia=10,
            combined_count=6,
        )
    ]
    exact_doc = build_bbs_document({}, sched, CalcSettings(mode="sample_compat", include_chairs_spacers=False), [], {})
    roundup_doc = build_bbs_document({}, sched, CalcSettings(round_up_nos=True, include_chairs_spacers=False), [], {})

    assert exact_doc.settings.mode == "strict_geometry"
    assert exact_doc.rows[0].cut_length_mm == 650.0 + 5900.0 + 650.0 - 24.0  # 7176 exact, no 6635 or -15 hack
    assert exact_doc.rows[0].nos == pytest.approx(((3100 - 100 - 12) / 125.0) + 1.0, abs=1e-12)  # 24.904 unrounded
    assert roundup_doc.rows[0].nos == 25.0

    # 2. Arbitrary L-shaped combined footing in synthetic CAD PDF (verifies zero hardcoded CF3 dims)
    pdf_doc = pymupdf.open()
    page = pdf_doc.new_page(width=2000, height=1400)
    page.insert_text((1500, 90), 'PROJECT :- "CUSTOM POLYGON" AT PUNE', fontsize=11)
    page.insert_text((700, 90), "SCHEDULE OF COLUMNS & FOOTINGS", fontsize=14)
    hdrs = [
        (710, 145, "COLUMN"), (780, 145, "EXCAVATION"), (860, 145, "PCC"), (930, 145, "FOOTING"),
        (1080, 145, "AT FOOTING"), (1150, 145, "LONG LOWER"), (1230, 145, "SHORT UPPER"),
        (1310, 145, "SIDE BARS"), (1380, 145, "SIZE"), (1440, 145, "VERT.BARS"), (1510, 145, "TIES"), (1580, 145, "REMARKS"),
    ]
    for x, y, txt in hdrs:
        page.insert_text((x, y), txt, fontsize=8)
    for x, y, txt in [
        (710, 180, "CF1"), (780, 180, "2200 x 3200"), (860, 180, "125"), (930, 180, "2000 x 3000"),
        (1080, 180, "650"), (1150, 180, "12 # @ 150"), (1230, 180, "12 # @ 150"),
        (1310, 180, "2 x 10"), (1580, 180, "COMBINED"),
        (710, 210, "CF9"), (780, 210, "-"), (860, 210, "125"), (930, 210, "REFER PLAN"),
        (1080, 210, "750"), (1150, 210, "12 # @ 125"), (1230, 210, "12 # @ 125"),
        (1310, 210, "3 x 10"), (1580, 210, "COMBINED"),
    ]:
        page.insert_text((x, y), txt, fontsize=8)

    # Calibration rect CF1 (2000x3000 mm at 0.025 scale -> 50x75 pt) + L-shaped CF9 (5000x4000 mm, step 2500x2000)
    page.draw_rect(pymupdf.Rect(100, 180, 150, 255), width=0.6)
    page.insert_text((118, 218), "CF1", fontsize=9)
    cf9_pts = [(200, 300), (262.5, 300), (262.5, 350), (325, 350), (325, 400), (200, 400)]
    for a, b in zip(cf9_pts, cf9_pts[1:] + [cf9_pts[0]]):
        page.draw_line(a, b, width=0.5)
    page.insert_text((240, 375), "CF9", fontsize=10)
    page.insert_text((220, 740), "FOUNDATION LEVEL PLAN", fontsize=12)

    _, parsed_sched, _, _, _ = parse_bbs_pdf(pdf_doc.tobytes())
    cf9 = next(r for r in parsed_sched if r.mark == "CF9")
    assert len(cf9.l_shape_segments) == 4
    spans = sorted(s["span"] for s in cf9.l_shape_segments)
    assert spans == pytest.approx([2000.0, 2500.0, 4000.0, 5000.0], abs=80.0)


def test_fastapi_endpoints() -> None:
    client = TestClient(app)
    assert client.get("/api/health").json() == {"status": "ok", "offline": True}
    assert "100% OFFLINE" in client.get("/").text

    # Reject non-PDF
    bad = client.post("/api/parse", files={"file": ("fake.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 400

    # Full parse -> recalculate -> export roundtrip
    pdf_bytes = _make_synthetic_cad_pdf()
    resp = client.post(
        "/api/parse",
        files={"file": ("sample.pdf", pdf_bytes, "application/pdf")},
        data={"mode": "strict_geometry", "round_up_nos": "false"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["preview_image"].startswith("data:image/png;base64,")

    doc = payload["document"]
    doc["rows"][0]["nos"] = 25
    recalc = client.post("/api/recalculate", json=doc)
    assert recalc.status_code == 200
    assert recalc.json()["rows"][0]["total_nos"] == pytest.approx(50.0)

    exp = client.post("/api/export", json=recalc.json())
    assert exp.status_code == 200
    assert exp.content[:2] == b"PK"

    exp_form = client.post("/api/export-form", data={"payload": json.dumps(recalc.json())})
    assert exp_form.status_code == 200
    assert exp_form.content[:2] == b"PK"
    assert "attachment;" in exp_form.headers.get("content-disposition", "")

    bad_form = client.post("/api/export-form", data={"payload": ""})
    assert bad_form.status_code == 400


@pytest.mark.skipif(
    not SAMPLE_PDF_LOCAL.exists() or not SAMPLE_XLSX_LOCAL.exists(),
    reason="Local-only client sample files not present",
)
def test_local_client_sample_validation() -> None:
    """Local-only verification: compare exported .xlsx (formulas + cached <v>) against client sample."""
    meta, sched, settings, warnings, stats = parse_bbs_pdf(SAMPLE_PDF_LOCAL.read_bytes())
    assert meta["project_name"] == "SHIVAM HEIGHTS"
    assert meta["location"] == "PANJARI(FARMS)"
    assert stats["total_col_counts"] == {"C1": 8, "C2": 16, "C3": 8, "C4": 20, "C5": 4, "C6": 4}
    assert stats["box_counts"] == {"C1": 8, "C2": 6, "C3": 4, "C4": 10, "C5": 4, "C6": 2}
    assert stats["cf_counts"] == {"CF1": 1, "CF2": 1, "CF3": 2, "CF4": 6, "CF5": 2}

    doc = build_bbs_document(meta, sched, settings, warnings, stats)
    xlsx_bytes = export_bbs_xlsx(doc)

    # 1. Verify exported .xlsx cached <v> values (data_only=True) match UI/doc calculations with zero roundoff
    wb_f = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    wb_v = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    ws_f, ws_v = wb_f["FORMAT"], wb_v["FORMAT"]

    dia_cols = {8: "P", 10: "Q", 12: "R", 16: "S", 20: "T", 25: "U", 32: "V", 36: "W", 40: "X"}
    for idx, row in enumerate(doc.rows):
        er = 8 + idx
        assert ws_f[f"M{er}"].value == f"=+L{er}*K{er}"
        for col_let in dia_cols.values():
            assert ws_f[f"{col_let}{er}"].value == f"=IF($E{er}={col_let}$6,$M{er},0)*($N{er}*$E{er}*$E{er}/($W$3*$Y$3))"
        assert ws_v[f"D{er}"].value == pytest.approx(row.span_mm, abs=1e-9)
        assert ws_v[f"K{er}"].value == pytest.approx(row.nos, abs=1e-9)
        assert ws_v[f"L{er}"].value == pytest.approx(row.multiple_no, abs=1e-9)
        assert ws_v[f"M{er}"].value == pytest.approx(row.total_nos, abs=1e-9)
        assert ws_v[f"N{er}"].value == pytest.approx(row.cut_length_mm, abs=1e-9)
        target_col = dia_cols[int(round(row.dia_mm))]
        assert ws_v[f"{target_col}{er}"].value == pytest.approx(row.weight_kg, abs=1e-9)

    sum_r = 8 + len(doc.rows) + 1
    grand_r = sum_r + 2
    assert ws_v[f"P{grand_r}"].value == pytest.approx(doc.total_weight_mt, abs=1e-9)
    assert f"{doc.total_weight_mt * 1000.0:.6f}"[:7] in str(ws_v["P5"].value)

    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as z:
        droot = ET.fromstring(z.read("xl/drawings/drawing1.xml"))
        assert len(list(droot)) > 200

    # 2. Row-by-row decimal audit against client sample .xlsx (local-only reference)
    wb_sv = openpyxl.load_workbook(SAMPLE_XLSX_LOCAL, data_only=True)
    wb_sf = openpyxl.load_workbook(SAMPLE_XLSX_LOCAL, data_only=False)
    ws_sv, ws_sf = wb_sv["FORMAT"], wb_sf["FORMAT"]

    def samp_weight(r_s: int) -> float:
        return sum(
            float(ws_sv[f"{c}{r_s}"].value or 0.0)
            for c in dia_cols.values()
            if isinstance(ws_sv[f"{c}{r_s}"].value, (int, float))
        )

    # All 27 formula-consistent rows must match exported .xlsx identically on D, K, L, M, N, and weight_kg
    exact_row_ids = {
        "C1_long_lower", "C1_short_upper", "C1_col_vert", "C1_tie_outer", "C1_tie_middle", "C1_tie_inner",
        "C2_col_vert", "C3_long_lower", "C3_short_upper", "C3_col_vert",
        "C4_long_lower", "C4_short_upper", "C4_tie_outer", "C4_tie_center",
        "C5_long_lower", "C5_short_upper", "C5_col_vert", "C5_tie_outer", "C5_tie_center",
        "C6_long_lower", "C6_short_upper", "C6_col_vert", "C6_tie_outer", "C6_tie_middle", "C6_tie_inner",
        "CF1_sw_ef", "CF1_sw_ec",
    }
    by_id = {r.id: (8 + idx, r) for idx, r in enumerate(doc.rows)}
    for idx, row in enumerate(doc.rows):
        if row.id not in exact_row_ids:
            continue
        er = 8 + idx
        r_s = er if idx < 46 else er - 1
        assert ws_v[f"D{er}"].value == pytest.approx(float(ws_sv[f"D{r_s}"].value), abs=1e-9)
        assert ws_v[f"K{er}"].value == pytest.approx(float(ws_sv[f"K{r_s}"].value), abs=1e-9)
        assert ws_v[f"L{er}"].value == pytest.approx(float(ws_sv[f"L{r_s}"].value), abs=1e-9)
        assert ws_v[f"M{er}"].value == pytest.approx(float(ws_sv[f"M{r_s}"].value), abs=1e-9)
        assert ws_v[f"N{er}"].value == pytest.approx(float(ws_sv[f"N{r_s}"].value), abs=1e-9)
        assert row.weight_kg == pytest.approx(samp_weight(r_s), abs=1e-9)

    # Explicit proof assertions on client sample defects:
    # (a) Sample C2 box footings used 4 instead of 6 drawn on CAD plan
    assert ws_v[f"L{by_id['C2_long_lower'][0]}"].value == 6.0 and ws_sv["L15"].value == 4
    # (b) Sample C4 Col Vert used 10 while CAD & its own R33-R36 stirrups confirm 20
    assert ws_v[f"L{by_id['C4_col_vert'][0]}"].value == 20.0 and ws_sv["L32"].value == 10 and ws_sv["L33"].value == 20
    # (c) Sample rounded 820/6=136.6667 to 137 in R34/R35 while formula keeps exact unrounded step
    assert ws_sf["D34"].value == "=D33-137-137"
    assert ws_v[f"D{by_id['C4_tie_middle'][0]}"].value == pytest.approx(2258.0 - 2.0 * (820.0 / 6.0), abs=1e-9)
    assert ws_v[f"D{by_id['C4_tie_inner'][0]}"].value == pytest.approx(2258.0 - 4.0 * (820.0 / 6.0), abs=1e-9)
    # (d) Sample CF4 LONG LOWER has 6635 fat-finger typo for 635 leg
    assert str(ws_sf["N70"].value).startswith("=6635+")
    assert ws_v[f"N{by_id['CF4_long'][0]}"].value == pytest.approx(2 * (750 - 100) + (6000 - 100) - 24, abs=1e-9)
    # (e) Sample Spacers (10mm) was hardcoded in 12mm column R77 instead of 10mm Q
    assert ws_sv["E77"].value == 10 and ws_sv["R77"].value == 200
    assert all(r.source_note for r in doc.rows if r.inferred)
    legend_r = grand_r + 2
    assert "YELLOW HIGHLIGHT LEGEND:" in str(ws_v[f"A{legend_r}"].value)
    assert ws_v[f"A{legend_r}"].fill.start_color.rgb.endswith("FFF9DB")


def test_inferred_rows_source_notes_and_xlsx_legend() -> None:
    """Ensure inferred rows carry dynamic source notes (without fake PDF schedule refs) and .xlsx exports a yellow legend."""
    schedule = [
        ScheduleFootRow(
            mark="CF1",
            kind="combined_footing",
            footing_b_mm=4200,
            footing_l_mm=5600,
            depth_mm=700,
            long_lower_dia=16,
            long_lower_spacing=125,
            short_upper_dia=12,
            short_upper_spacing=150,
            side_bars_nos=2,
            side_bars_dia=10,
            combined_count=1,
            shaft_inner_b_mm=1300,
            shaft_inner_l_mm=3800,
        ),
        ScheduleFootRow(
            mark="SW1",
            kind="shear_wall",
            vert_nos=4,
            vert_dia=12,
            ties_dia=8,
            ties_spacing=150,
        ),
        ScheduleFootRow(
            mark="CF3",
            kind="combined_footing",
            depth_mm=650,
            long_lower_dia=12,
            long_lower_spacing=125,
            side_bars_nos=3,
            side_bars_dia=10,
            combined_count=1,
            l_shape_segments=[
                {"label": "CF3 LONG SPAN", "span": 6400, "dist": 2100},
                {"label": "CF3 WING SPAN", "span": 3200, "dist": 1800},
                {"label": "CF3 ORTH SPAN", "span": 4100, "dist": 1950},
            ],
        ),
    ]
    doc = build_bbs_document(
        meta={"project_name": "TEST TOWER", "drawing_no": "DRG-01"},
        schedule=schedule,
        settings=CalcSettings(shear_wall_ht_cf1_mm=2900.0, sw_inner_offset_mm=145.0),
        warnings=[],
        parse_stats={},
        date_str="2026-11-12",
    )
    inferred_rows = [r for r in doc.rows if r.inferred]
    assert len(inferred_rows) == 6  # CF1 tie_outer/tie_inner + 3 CF3 segs + CF3 side
    for r in inferred_rows:
        assert r.source_note
        low = r.source_note.lower()
        assert "not" in low or "omitted" in low
        assert "actual design / site sizes" in low

    tie_outer = next(r for r in inferred_rows if r.id == "CF1_tie_outer")
    tie_inner = next(r for r in inferred_rows if r.id == "CF1_tie_inner")
    seg_1 = next(r for r in inferred_rows if r.id == "CF3_seg_1")
    assert "1300x3800 mm" in tie_outer.source_note
    assert "2900 mm" in tie_outer.source_note
    assert "145 mm" in tie_inner.source_note
    assert "6400 mm" in seg_1.source_note and "2100 mm" in seg_1.source_note

    xlsx_bytes = export_bbs_xlsx(doc)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    ws = wb["FORMAT"]
    legend_r = 8 + len(doc.rows) + 5
    assert "YELLOW HIGHLIGHT LEGEND:" in str(ws[f"A{legend_r}"].value)
    assert "actual structural design / site sizes" in str(ws[f"A{legend_r}"].value)
    assert ws[f"A{legend_r}"].fill.start_color.rgb.endswith("FFF9DB")
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as z:
        sroot = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        leg_cells = sroot.findall(f".//s:row[@r='{legend_r}']/s:c", ns)
        assert len(leg_cells) == 25 and all(c.get("s") for c in leg_cells)
    assert any(str(rng) == f"A{legend_r}:Y{legend_r}" for rng in ws.merged_cells.ranges)
    assert f"$Y${legend_r}" in str(ws.print_area)

