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

    xlsx_bytes = export_bbs_xlsx(doc)
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)
    ws = wb["FORMAT"]
    assert ws["S2"].value == 50.0  # Footing Cover constant cell
    assert ws["W3"].value == 162.0  # Unit Wt divisor constant cell
    assert ws["Y3"].value == 1000.0  # Kg/MT scale constant cell
    assert ws["Z8"].value == 650.0  # Footing Depth parameter cell
    assert ws["L8"].value == "=AC8*AD8"
    assert ws["M8"].value == "=+L8*K8"
    assert ws["N8"].value == "=(Z8-2*$S$2)+(D8-2*$S$2)+(Z8-2*$S$2)-(2*E8)"
    assert ws["P8"].value == "=IF($E8=P$6,$M8,0)*($N8*$E8*$E8/($W$3*$Y$3))"

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


def test_strict_geometry_vs_sample_compat_and_rounding() -> None:
    sched = [
        ScheduleFootRow(
            mark="CF4",
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
    compat_doc = build_bbs_document({}, sched, CalcSettings(mode="sample_compat", include_chairs_spacers=False), [], {})
    strict_doc = build_bbs_document({}, sched, CalcSettings(mode="strict_geometry", round_up_nos=True, include_chairs_spacers=False), [], {})

    assert compat_doc.rows[0].cut_length_mm == 13131.0
    assert strict_doc.rows[0].cut_length_mm == 635 + 5900 + 635 - 24
    assert strict_doc.rows[0].nos == 25.0  # ROUNDUP(((3100-100-12)/125)+1) = 25


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
        data={"mode": "sample_compat", "round_up_nos": "false"},
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


@pytest.mark.skipif(not SAMPLE_PDF_LOCAL.exists(), reason="Local sample PDF not present")
def test_real_shivam_heights_regression() -> None:
    meta, sched, settings, warnings, stats = parse_bbs_pdf(SAMPLE_PDF_LOCAL.read_bytes())
    assert meta["project_name"] == "SHIVAM HEIGHTS"
    assert meta["location"] == "PANJARI(FARMS)"
    assert stats["total_col_counts"] == {"C1": 8, "C2": 16, "C3": 8, "C4": 20, "C5": 4, "C6": 4}
    assert stats["box_counts"] == {"C1": 8, "C2": 6, "C3": 4, "C4": 10, "C5": 4, "C6": 2}
    assert stats["cf_counts"] == {"CF1": 1, "CF2": 1, "CF3": 2, "CF4": 6, "CF5": 2}

    doc = build_bbs_document(meta, sched, settings, warnings, stats)
    assert doc.totals_by_dia_mt[8] == pytest.approx(4.001529679, abs=1e-6)
    assert doc.totals_by_dia_mt[16] == pytest.approx(1.137777778, abs=1e-6)
    assert doc.total_weight_mt == pytest.approx(32.165540827, abs=1e-6)

    xlsx_bytes = export_bbs_xlsx(doc)
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes), "r") as z:
        droot = ET.fromstring(z.read("xl/drawings/drawing1.xml"))
        assert len(list(droot)) == 206
