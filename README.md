# BarBending — Offline CAD PDF to Bar Bending Schedule (`.xlsx`) Generator

**BarBending** reads structural engineering CAD drawings (PDF) and generates formatted **Bar Bending Schedule (BBS)** Excel workbooks (`.xlsx`) containing **live Excel formulas** and **native vector rebar bending diagrams**—running **100% offline with zero external API calls**.

Your structural drawings never leave your phone or computer.

---

## What It Does

- **Extracts Metadata & Notes**: Project name, location, structure type (`G+9`), clear covers (`50 mm` footing, `40 mm` column), ring hook rules (`8×Ø` or `75 mm`), foundation depth, and section heights.
- **Reads Schedule of Columns & Footings**: Parses footing sizes, depths, main reinforcement, side bars, column dimensions, vertical bars, and stirrup ties (`C1`–`C6`, `SW1`, `CF1`–`CF5`), including AutoCAD SHX text annotations.
- **Counts Foundation Level Plan Elements (`MULTIPLE NO.`)**: Geometrically separates **standalone box footings** from **columns sitting inside combined footings** (both rectangular `CF1`/`CF2`/`CF4`/`CF5` and L-shaped `CF3`).
- **Calculates Cut Lengths & Weights**:
  - U-bars, perimeter side bars, L-bars, multi-layer stirrups (`OUTER`, `MIDDLE`, `INNER`, `CENTER`), combined-footing meshes, and shear wall ties.
  - Weight formula: `Total Nos × (Cut Length / 1000) × (Dia² / 162)`, summarized in MT by bar diameter (`8 mm` to `40 mm`).
- **Exports Native Excel `.xlsx`**:
  - Live formulas (`=+L*K`, `=IF(...)`, `=SUM(...)/1000`, cut-length formulas, `=+TODAY()`) with pre-cached values so sheets display immediately in Microsoft Excel, iOS QuickLook, and Apple Numbers.
  - Native OpenXML DrawingML vector rebar diagrams and dimension labels inside columns `F:I`.

---

## Option 1: Use Directly on iPhone / Browser (No PC or Install Needed)

The [`docs/`](./docs/) folder is a **100% client-side static web app** powered by local `PDF.js` and `JSZip` (no backend server and no external CDN calls).

### Enable GitHub Pages (One-Time Repo Setup)
1. Open **Settings → Pages** in this GitHub repository.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Select branch **`main`** and folder **`/docs`**, then click **Save**.
4. Open the published URL: `https://pranav-labhe.github.io/BarBending/`.

### How to Use on iPhone Safari
1. Open `https://pranav-labhe.github.io/BarBending/` in **iPhone Safari**.
   - *Offline tip*: Tap Safari's **Share** icon → **Add to Home Screen**. Once loaded once, the Service Worker caches all scripts locally so it works even offline.
2. Tap **Choose File** and pick your CAD PDF from iPhone **Files** (e.g., saved from WhatsApp or Mail).
3. Review the generated table:
   - Check the **Grand Total (MT)** and diameter cards at the top.
   - Check **Box Footings vs. Total Columns** under the drawing preview.
   - Review any **yellow `verify` rows** (derived/inferred dimensions such as `CF3` L-shape segments, `CF1`/`CF2` shafts, or shear-wall ties) and edit any cell (`Nos`, `Mult`, `Cut Len`, `Dia`)—totals recalculate live.
   - Tap **Hide Drawing Preview** for wider table scrolling on mobile screens.
4. Tap **Share / Open in Excel** (opens iPhone's native Share Sheet straight into Excel/Files) or **Download .xlsx**.
   - *Tip*: Open the `.xlsx` in the **Microsoft Excel** app to view both live formulas and native DrawingML rebar shape sketches.

---

## Option 2: Run Locally on Windows / Mac / Linux (Python Backend)

For desktop or local Wi-Fi usage with the FastAPI + `PyMuPDF` + `openpyxl` backend:

```powershell
# 1. Clone and install dependencies
git clone https://github.com/pranav-labhe/BarBending.git
cd BarBending
pip install -r requirements.txt

# 2. Start the local server (0.0.0.0 allows other Wi-Fi devices to connect)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- Open `http://127.0.0.1:8000` on your PC/Mac, or `http://<YOUR_PC_LAN_IP>:8000` from an iPhone on the same Wi-Fi.
- See [`PYTHON_CHEATSHEET.md`](./PYTHON_CHEATSHEET.md) for air-gapped wheel bundling (`pip download` / `--no-index`) and [`Containerfile`](./Containerfile) (Docker/Podman) instructions.

---

## Rule Modes

- **Sample-Compatible (`sample_compat`)**: Preserves standard site/template conventions (e.g., `4500/150` vs. `4550/150` stirrup spacing rules, `CF4` continuous loop cut length, `Plus One` mesh spacing) while accurately surfacing plan counts.
- **Strict Uniform Geometry (`strict_geometry`)**: Applies uniform clear-cover, bend-deduction, and hook formulas across every footing/column mark, with an optional **Round Up (`ROUNDUP`)** toggle for bar counts.

---

## Project Layout

```text
├── docs/                  # 100% browser-only iPhone/GitHub Pages app (PDF.js + JSZip)
├── app/                   # Python FastAPI backend (PyMuPDF + openpyxl + DrawingML injector)
├── tests/                 # Automated pytest suite
├── Containerfile          # Offline-ready Docker/Podman container image
├── PYTHON_CHEATSHEET.md   # Local setup, offline wheels, and container runbook
└── .github/workflows/     # CI workflow (pytest + Containerfile build check)
```

---

## Running Tests

```bash
pytest -v
```
