"""FastAPI offline Bar Bending Schedule (BBS) web server."""

from __future__ import annotations

import io
from pathlib import Path
import re
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.bbs_calculator import build_bbs_document, recalculate_document
from app.models import BbsDocument, CalcSettings
from app.pdf_parser import parse_bbs_pdf, render_pdf_preview_data_url
from app.xlsx_exporter import export_bbs_xlsx

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB guard for large CAD sheets
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(
    title="Offline Bar Bending Schedule Generator",
    version="1.0.0",
    docs_url="/api/docs",
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/api/health")
def health() -> dict[str, object]:
    """Liveness and offline readiness probe."""
    return {"status": "ok", "offline": True}


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    """Serve the 100% offline self-contained web UI."""
    html_path = STATIC_DIR / "index.html"
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.post("/api/parse")
async def parse_pdf_endpoint(
    file: UploadFile = File(...),
    mode: Literal["sample_compat", "strict_geometry"] = Form("sample_compat"),
    round_up_nos: bool = Form(False),
) -> dict[str, object]:
    """Parse an uploaded CAD structural PDF into a calculated BbsDocument + preview image."""
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 50 MB upload limit.")
    if not pdf_bytes.lstrip().startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Invalid PDF file header.")

    base_settings = CalcSettings(mode=mode, round_up_nos=round_up_nos)
    try:
        meta, schedule, settings, warnings, stats = parse_bbs_pdf(pdf_bytes, base_settings)
        doc = build_bbs_document(meta, schedule, settings, warnings, stats)
        preview = render_pdf_preview_data_url(pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse PDF: {exc}") from exc

    return {"document": doc.model_dump(), "preview_image": preview}


@app.post("/api/rebuild", response_model=BbsDocument)
def rebuild_document(doc: BbsDocument) -> BbsDocument:
    """Regenerate BBS rows from extracted schedule using updated CalcSettings."""
    meta = {
        "project_name": doc.project_name,
        "drawing_no": doc.drawing_no,
        "location": doc.location,
        "structure": doc.structure,
    }
    return build_bbs_document(
        meta=meta,
        schedule=doc.schedule,
        settings=doc.settings,
        warnings=doc.warnings,
        parse_stats=doc.parse_stats,
        date_str=doc.date_str,
    )


@app.post("/api/recalculate", response_model=BbsDocument)
def recalculate_endpoint(doc: BbsDocument) -> BbsDocument:
    """Recalculate row totals and dia-wise tonnage after manual grid edits."""
    return recalculate_document(doc)


def _build_xlsx_response(doc: BbsDocument) -> StreamingResponse:
    """Recalculate, serialize to .xlsx with DrawingML shapes, and return download response."""
    recalculated = recalculate_document(doc)
    xlsx_bytes = export_bbs_xlsx(recalculated)
    safe_name = re.sub(r"[^A-Za-z0-9_\-]+", "_", doc.drawing_no or "BBS").strip("_") or "BBS"
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}_BBS.xlsx"',
    }
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.post("/api/export")
def export_xlsx_endpoint(doc: BbsDocument) -> StreamingResponse:
    """Export the reviewed BbsDocument to a native .xlsx workbook with formulas and DrawingML shapes."""
    return _build_xlsx_response(doc)


@app.post("/api/export-form")
async def export_xlsx_form_endpoint(request: Request) -> StreamingResponse:
    """Form-POST download endpoint for reliable native attachment downloads on iOS Safari."""
    form = await request.form(max_part_size=20 * 1024 * 1024)
    payload = form.get("payload")
    if not isinstance(payload, str) or not payload.strip():
        raise HTTPException(status_code=400, detail="Missing BBS payload.")
    try:
        doc = BbsDocument.model_validate_json(payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid BBS payload: {exc}") from exc
    return _build_xlsx_response(doc)
