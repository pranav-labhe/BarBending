# Offline Bar Bending Schedule (BBS) PDF-to-XLSX Web App

A **100% offline, CPU-only** Python + FastAPI web application that parses AutoCAD structural PDF drawings (Schedule of Columns & Footings, Notes, Sections, and Foundation Level Plan) and exports formatted Excel `.xlsx` Bar Bending Schedules with **live Excel formulas** and **native OpenXML DrawingML vector rebar shapes** in columns `F:I`.

## Features

- **Zero External API Calls / Zero Internet Required**: Runs purely on local CPU using `PyMuPDF`, `NumPy`, `Pillow`, and `openpyxl`.
- **CAD Vector & SHX Annotation Extraction**:
  - Reads both TrueType text spans and AutoCAD SHX `/Annots` text layers in rotated or unrotated landscape sheets.
  - Detects `FOUNDATION LEVEL PLAN` boundaries and separates **isolated box footings** from **columns sitting inside combined footings** (`CF1`–`CF5`), including L-shaped combined footings (`CF3`) via pure-NumPy morphological flood fill.
- **Dual BBS Rule Modes**:
  - **Sample-Compatible (`sample_compat`)**: Matches sample workbook conventions (`U-bars`, multi-layer `OUTER/MIDDLE/INNER/CENTER` stirrups, shear wall ties, `Plus One` combined footing mesh formulas).
  - **Strict Geometry (`strict_geometry`)**: Uniform geometric cover/hook/lap formulas with optional `ROUNDUP` bar counts.
- **Interactive Side-by-Side Browser Review UI**:
  - Zoomable PDF drawing preview alongside an editable BBS grid (with inline SVG rebar diagrams and yellow warning highlights on inferred/derived rows).
- **Native `.xlsx` Export**:
  - Live formulas (`Total nos = +L*K`, dia-wise `D²/162` weights, `SUM/1000` MT totals).
  - Native OpenXML DrawingML vector rebar diagrams and dimension callout textboxes injected into columns `F:I`.

## Quick Start

```powershell
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- **Local PC/Mac browser**: open `http://127.0.0.1:8000`
- **iPhone Safari on same Wi-Fi**: open `http://<YOUR_PC_LAN_IP>:8000` (ensure TCP port `8000` is allowed on your local firewall).

See [`PYTHON_CHEATSHEET.md`](./PYTHON_CHEATSHEET.md) for offline wheel packaging and `Containerfile` instructions.
