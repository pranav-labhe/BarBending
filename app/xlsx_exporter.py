"""Excel (.xlsx) Bar Bending Schedule exporter with constant cells, column formulas, and DrawingML shapes."""

from __future__ import annotations

import io
from typing import Optional

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.bbs_calculator import recalculate_document
from app.drawingml_injector import inject_drawingml_shapes
from app.formula_engine import GLOBAL_CONST_CELLS, format_exact, resolve_row_formula
from app.models import DIAMETER_COLUMNS, BbsDocument, ShapeSpec

COL_WIDTHS: dict[int, float] = {
    1: 13.2,
    2: 16.5,
    3: 35.7,
    4: 13.5,
    5: 9.5,
    6: 7.8,
    7: 7.8,
    8: 9.0,
    9: 9.3,
    10: 15.2,
    11: 14.5,
    12: 33.0,
    13: 15.0,
    14: 15.0,
    15: 15.7,
    16: 21.3,
    17: 15.5,
    18: 16.5,
    19: 15.5,
    20: 17.0,
    21: 14.0,
    22: 14.5,
    23: 14.0,
    24: 14.5,
    25: 26.3,
    # Reference Parameter Constants Block (Z..AE)
    26: 15.5,  # Z
    27: 16.5,  # AA
    28: 15.5,  # AB
    29: 14.5,  # AC
    30: 15.5,  # AD
    31: 42.0,  # AE
}

THIN = Side(style="thin", color="BFBFBF")
MED = Side(style="medium", color="404040")
CELL_BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEADER_BORDER = Border(left=THIN, right=THIN, top=MED, bottom=MED)

TITLE_FILL = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
SUBHDR_FILL = PatternFill(start_color="EDF2F8", end_color="EDF2F8", fill_type="solid")
CONST_LBL_FILL = PatternFill(start_color="EEF2FF", end_color="EEF2FF", fill_type="solid")
CONST_VAL_FILL = PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid")
PARAM_HDR_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
TOTAL_GREEN_FILL = PatternFill(start_color="92D050", end_color="92D050", fill_type="solid")
INFERRED_FILL = PatternFill(start_color="FFF9DB", end_color="FFF9DB", fill_type="solid")

# Strict zero-rounding display: "General" shows exact unrounded decimals without trailing dots
EXACT_FMT = "General"


def _set_const_pair(
    ws: openpyxl.worksheet.worksheet.Worksheet,
    row: int,
    lbl_col: int,
    val_col: int,
    label: str,
    value: float,
    lbl_font: Font,
    val_font: Font,
) -> None:
    c_lbl = ws.cell(row, lbl_col, label)
    c_lbl.font = lbl_font
    c_lbl.fill = CONST_LBL_FILL
    c_lbl.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    c_val = ws.cell(row, val_col, value)
    c_val.font = val_font
    c_val.fill = CONST_VAL_FILL
    c_val.number_format = EXACT_FMT
    c_val.alignment = Alignment(horizontal="center", vertical="center")


def export_bbs_xlsx(doc: BbsDocument) -> bytes:
    """Build an .xlsx workbook with global constant cells, column formulas, and DrawingML shapes."""
    recalc = recalculate_document(doc.model_copy(deep=True))

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FORMAT"
    ws.views.sheetView[0].showGridLines = True

    for col_idx, width in COL_WIDTHS.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 49.9
    ws.row_dimensions[2].height = 38.45
    ws.row_dimensions[3].height = 38.45
    ws.row_dimensions[4].height = 38.45
    ws.row_dimensions[5].height = 38.25
    ws.row_dimensions[6].height = 38.45
    ws.row_dimensions[7].height = 31.5

    # Row 1: Banner Title
    ws.merge_cells("A1:Y1")
    ws["A1"] = "BAR BENDING SCHEDULE "
    ws["A1"].font = Font(name="Calibri Light", size=24, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    for c in range(1, 26):
        ws.cell(1, c).fill = TITLE_FILL
        ws.cell(1, c).border = HEADER_BORDER

    # Rows 2-4: Metadata (A..Q) & Labeled Engineering Constants (O3:Q4, R2:Y4)
    meta_font = Font(name="Calibri Light", size=18, bold=True)
    meta_val_font = Font(name="Calibri Light", size=16, bold=True)
    const_lbl_font = Font(name="Calibri", size=11, bold=True, color="1E3A8A")
    const_val_font = Font(name="Calibri", size=13, bold=True, color="0F172A")

    ws.merge_cells("A2:B2")
    ws.merge_cells("C2:I2")
    ws.merge_cells("J2:K2")
    ws.merge_cells("L2:Q2")
    ws["A2"] = "Project:- "
    ws["C2"] = recalc.project_name
    ws["J2"] = "Drawing No:- "
    ws["L2"] = recalc.drawing_no

    ws.merge_cells("A3:B3")
    ws.merge_cells("C3:I3")
    ws.merge_cells("J3:K3")
    ws.merge_cells("L3:N3")
    ws.merge_cells("P3:Q3")
    ws["A3"] = "Location: "
    ws["C3"] = recalc.location
    ws["J3"] = "Date  "
    if recalc.date_str:
        ws["L3"] = recalc.date_str
    else:
        ws["L3"] = "=+TODAY()"
        ws["L3"].number_format = "yyyy-mm-dd"

    ws.merge_cells("A4:B4")
    ws.merge_cells("C4:I4")
    ws.merge_cells("J4:K4")
    ws.merge_cells("L4:M4")
    ws["A4"] = "Structure :"
    ws["C4"] = recalc.structure
    ws["J4"] = "Rule Mode"
    ws["L4"] = f"{recalc.settings.mode}{' (ROUNDUP)' if recalc.settings.round_up_nos else ' (EXACT)'}"

    for r in range(2, 5):
        for c in range(1, 26):
            cell = ws.cell(r, c)
            cell.font = meta_font if c in (1, 10) else meta_val_font
            cell.alignment = Alignment(horizontal="left", vertical="center")
            cell.border = CELL_BORDER

    # Explicit global constant cells ($P$3, $O$4, $S$2:$Y$4)
    _set_const_pair(ws, 3, 15, 16, "SW Dowel", recalc.settings.sw_dowel_mm, const_lbl_font, const_val_font)
    _set_const_pair(ws, 4, 14, 15, "SW Inner Off", recalc.settings.sw_inner_offset_mm, const_lbl_font, const_val_font)

    const_layout = [
        (2, 18, 19, "$S$2"),
        (2, 20, 21, "$U$2"),
        (2, 22, 23, "$W$2"),
        (2, 24, 25, "$Y$2"),
        (3, 18, 19, "$S$3"),
        (3, 20, 21, "$U$3"),
        (3, 22, 23, "$W$3"),
        (3, 24, 25, "$Y$3"),
        (4, 18, 19, "$S$4"),
        (4, 20, 21, "$U$4"),
        (4, 22, 23, "$W$4"),
        (4, 24, 25, "$Y$4"),
    ]
    for r_c, l_c, v_c, ref_key in const_layout:
        attr_name, disp_lbl = GLOBAL_CONST_CELLS[ref_key]
        _set_const_pair(
            ws,
            r_c,
            l_c,
            v_c,
            disp_lbl,
            float(getattr(recalc.settings, attr_name)),
            const_lbl_font,
            const_val_font,
        )

    # Row-count indices precomputed so P5 header can reference grand_row & $Y$3 dynamically
    cached_values: dict[str, tuple[float | str, bool]] = {}
    data_start_row = 8
    last_data_row = data_start_row + max(0, len(recalc.rows) - 1)
    sum_row = last_data_row + 2
    lbl_row = sum_row + 1
    grand_row = sum_row + 2
    note_row = sum_row + 3
    legend_row = sum_row + 4

    total_kg_exact = format_exact(recalc.total_weight_mt * float(recalc.settings.scale_divisor or 1000.0))
    cached_values["P5"] = (f"Total WT. IN KG. ({total_kg_exact})", True)

    # Rows 5-6: Main Table Headers (A..Y) + Row Parameter Headers (Z..AE)
    hdr_font = Font(name="Calibri Light", size=18, bold=True)
    sub_font = Font(name="Calibri Light", size=16, bold=True)
    param_hdr_font = Font(name="Calibri", size=11, bold=True, color="1E293B")
    headers_5 = {
        1: "Sr.No",
        2: "Bar Mark",
        3: "Description",
        4: "Span",
        5: "Dia.",
        6: "Shape",
        10: "Spacing",
        11: "Nos.",
        12: "MULTIPLE NO.",
        13: "Total nos",
        14: "Cut Length",
        15: "Coupler",
        16: f'="Total WT. IN KG. ("&(P{grand_row}*$Y$3)&")"',
        25: "Remark",
    }
    for col_idx, label in headers_5.items():
        ws.cell(5, col_idx, label)

    for col_idx in (1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15, 25):
        ws.merge_cells(start_row=5, start_column=col_idx, end_row=6, end_column=col_idx)
    ws.merge_cells("F5:I6")
    ws.merge_cells("P5:X5")

    for idx, dia in enumerate(DIAMETER_COLUMNS):
        ws.cell(6, 16 + idx, dia)

    for r in (5, 6):
        for c in range(1, 26):
            cell = ws.cell(r, c)
            cell.font = hdr_font
            cell.fill = SUBHDR_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = HEADER_BORDER

    # Reference parameter columns Z..AE (Rows 5-6)
    ws.merge_cells("Z5:AE5")
    ws["Z5"] = "ROW REFERENCE CONSTANTS (EXCEL FORMULA INPUTS — EXCLUDED FROM A3 PRINT)"
    param_sub = {
        26: "Param Z\n(Depth / B)",
        27: "Param AA\n(Width / Dist)",
        28: "Param AB\n(Offset / Adj)",
        29: "Param AC\n(Qty / Units)",
        30: "Param AD\n(Layers / Const)",
        31: "Param AE\n(Formula Basis)",
    }
    for col_idx, lbl in param_sub.items():
        ws.cell(6, col_idx, lbl)
    for r in (5, 6):
        for c in range(26, 32):
            cell = ws.cell(r, c)
            cell.font = param_hdr_font
            cell.fill = PARAM_HDR_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            cell.border = HEADER_BORDER

    # Row 7: Structure Name sub-banner
    ws.merge_cells("A7:Y7")
    ws["A7"] = "Structure Name"
    ws["A7"].font = sub_font
    ws["A7"].alignment = Alignment(horizontal="left", vertical="center")
    for c in range(1, 26):
        ws.cell(7, c).border = CELL_BORDER

    # Rows 8..: Data Rows
    body_font = Font(name="Calibri Light", size=14, bold=False)
    desc_font = Font(name="Calibri Light", size=14, bold=True)
    param_body_font = Font(name="Calibri", size=11, color="334155")
    shape_rows: list[tuple[int, ShapeSpec]] = []

    cur_row = data_start_row
    first_tie_row_by_group: dict[str, int] = {}
    sr_merges: list[tuple[int, int]] = []
    cur_sr_start: Optional[int] = None

    for idx, row in enumerate(recalc.rows):
        is_tall = row.shape.kind in ("stirrup_rect", "center_link", "combined_loop", "chair")
        ws.row_dimensions[cur_row].height = 65.25 if is_tall else 46.5

        if row.sr_no is not None:
            if cur_sr_start is not None and cur_row - 1 > cur_sr_start:
                sr_merges.append((cur_sr_start, cur_row - 1))
            cur_sr_start = cur_row
            ws.cell(cur_row, 1, row.sr_no)

        ws.cell(cur_row, 2, row.bar_mark)
        ws.cell(cur_row, 3, row.description)

        if "COL.TIES" in row.description and row.group_key not in first_tie_row_by_group:
            first_tie_row_by_group[row.group_key] = cur_row
        first_tie_r = first_tie_row_by_group.get(row.group_key)

        # Span (Col D)
        span_f, _, _ = resolve_row_formula(row.span_expr, idx, recalc.rows, recalc.settings, first_tie_r)
        if span_f:
            ws.cell(cur_row, 4, span_f)
            cached_values[f"D{cur_row}"] = (row.span_mm, False)
        else:
            ws.cell(cur_row, 4, row.span_mm)
        ws.cell(cur_row, 4).number_format = EXACT_FMT

        # Dia (Col E)
        ws.cell(cur_row, 5, row.dia_mm)
        ws.cell(cur_row, 5).number_format = EXACT_FMT

        # Spacing (Col J)
        if row.spacing_mm is not None and row.spacing_mm > 0:
            ws.cell(cur_row, 10, row.spacing_mm)
            ws.cell(cur_row, 10).number_format = EXACT_FMT

        # Nos (Col K)
        nos_f, _, _ = resolve_row_formula(row.nos_expr, idx, recalc.rows, recalc.settings, first_tie_r)
        if nos_f:
            ws.cell(cur_row, 11, nos_f)
            cached_values[f"K{cur_row}"] = (row.nos, False)
        else:
            ws.cell(cur_row, 11, row.nos)
        ws.cell(cur_row, 11).number_format = EXACT_FMT

        # Multiple No (Col L) -> dynamic formula if multiple_expr present
        mult_f, _, _ = resolve_row_formula(row.multiple_expr, idx, recalc.rows, recalc.settings, first_tie_r)
        if mult_f:
            ws.cell(cur_row, 12, mult_f)
            cached_values[f"L{cur_row}"] = (row.multiple_no, False)
        else:
            ws.cell(cur_row, 12, row.multiple_no)
        ws.cell(cur_row, 12).number_format = EXACT_FMT

        # Total Nos (Col M) -> Always live formula =+L*K on every row
        ws.cell(cur_row, 13, f"=+L{cur_row}*K{cur_row}")
        ws.cell(cur_row, 13).number_format = EXACT_FMT
        cached_values[f"M{cur_row}"] = (row.total_nos, False)

        # Cut Length (Col N)
        cut_f, _, _ = resolve_row_formula(row.cut_length_expr, idx, recalc.rows, recalc.settings, first_tie_r)
        if cut_f:
            ws.cell(cur_row, 14, cut_f)
            cached_values[f"N{cur_row}"] = (row.cut_length_mm, False)
        else:
            ws.cell(cur_row, 14, row.cut_length_mm)
        ws.cell(cur_row, 14).number_format = EXACT_FMT

        # Coupler (Col O)
        ws.cell(cur_row, 15, row.coupler)

        # Dia-wise Weight (Cols P..X) -> Always live formula referencing $W$3 (162) & $Y$3 (1000)
        for d_idx in range(len(DIAMETER_COLUMNS)):
            col_c = 16 + d_idx
            col_let = get_column_letter(col_c)
            ws.cell(
                cur_row,
                col_c,
                f"=IF($E{cur_row}={col_let}$6,$M{cur_row},0)*($N{cur_row}*$E{cur_row}*$E{cur_row}/($W$3*$Y$3))",
            )
            ws.cell(cur_row, col_c).number_format = EXACT_FMT
            cached_w = row.weight_kg if abs(float(DIAMETER_COLUMNS[d_idx]) - float(row.dia_mm)) < 1e-9 else 0.0
            cached_values[f"{col_let}{cur_row}"] = (cached_w, False)

        # Remark (Col Y)
        if row.remark:
            ws.cell(cur_row, 25, row.remark)

        # Row Reference Constants (Cols Z..AE)
        for col_c, pval in (
            (26, row.param_z),
            (27, row.param_aa),
            (28, row.param_ab),
            (29, row.param_ac),
            (30, row.param_ad),
        ):
            if pval is not None:
                c_p = ws.cell(cur_row, col_c, pval)
                c_p.number_format = EXACT_FMT
        if row.param_ae:
            ws.cell(cur_row, 31, row.param_ae)

        # Styling
        for c in range(1, 26):
            cell = ws.cell(cur_row, c)
            cell.font = desc_font if c == 3 else body_font
            align_h = "left" if c in (2, 3, 25) else "center"
            cell.alignment = Alignment(horizontal=align_h, vertical="center")
            cell.border = CELL_BORDER
            if row.inferred and c in (4, 11, 12, 14):
                cell.fill = INFERRED_FILL
        for c in range(26, 32):
            pcell = ws.cell(cur_row, c)
            pcell.font = param_body_font
            pcell.alignment = Alignment(horizontal="left" if c == 31 else "center", vertical="center")
            pcell.border = CELL_BORDER

        if row.shape and row.shape.kind:
            shape_rows.append((cur_row, row.shape))

        cur_row += 1

    if cur_sr_start is not None and cur_row - 1 > cur_sr_start:
        sr_merges.append((cur_sr_start, cur_row - 1))

    for r_start, r_end in sr_merges:
        ws.merge_cells(start_row=r_start, start_column=1, end_row=r_end, end_column=1)

    # Blank spacer row + Summary rows
    ws.row_dimensions[last_data_row + 1].height = 24.0
    ws.row_dimensions[sum_row].height = 48.0
    ws.row_dimensions[lbl_row].height = 36.0
    ws.row_dimensions[grand_row].height = 39.0
    ws.row_dimensions[note_row].height = 28.0
    ws.row_dimensions[legend_row].height = 30.0

    ws.merge_cells(start_row=sum_row, start_column=1, end_row=sum_row, end_column=3)
    ws.cell(sum_row, 1, "Total Weight (MT)")
    for idx, dia in enumerate(DIAMETER_COLUMNS):
        col_c = 16 + idx
        col_let = get_column_letter(col_c)
        c_sum = ws.cell(sum_row, col_c, f"=SUM({col_let}{data_start_row}:{col_let}{last_data_row})/$Y$3")
        c_sum.font = Font(name="Calibri Light", size=14, bold=True)
        c_sum.number_format = EXACT_FMT
        cached_values[f"{col_let}{sum_row}"] = (float(recalc.totals_by_dia_mt.get(dia, 0.0)), False)
        ws.cell(lbl_row, col_c, f"{dia} mm" if dia == 8 else f"{dia}mm").font = desc_font

    for c in range(1, 26):
        ws.cell(sum_row, c).border = HEADER_BORDER
        ws.cell(sum_row, c).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(lbl_row, c).alignment = Alignment(horizontal="center", vertical="center")
        ws.cell(lbl_row, c).border = CELL_BORDER
    ws.cell(sum_row, 1).font = desc_font

    # Grand Total MT row
    ws.merge_cells(start_row=grand_row, start_column=1, end_row=grand_row, end_column=15)
    ws.merge_cells(start_row=grand_row, start_column=16, end_row=grand_row, end_column=24)
    ws.cell(grand_row, 1, "Total Weight (MT)").font = hdr_font
    ws.cell(grand_row, 1).alignment = Alignment(horizontal="right", vertical="center")
    gt_cell = ws.cell(grand_row, 16, f"=SUM(P{sum_row}:X{sum_row})")
    cached_values[f"P{grand_row}"] = (float(recalc.total_weight_mt), False)
    gt_cell.font = hdr_font
    gt_cell.number_format = EXACT_FMT
    gt_cell.alignment = Alignment(horizontal="center", vertical="center")
    for c in range(16, 25):
        ws.cell(grand_row, c).fill = TOTAL_GREEN_FILL
    for c in range(1, 26):
        ws.cell(grand_row, c).border = HEADER_BORDER

    # Footer note
    ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=25)
    note_cell = ws.cell(note_row, 1, recalc.note_footer)
    note_cell.font = Font(name="Calibri", size=11, bold=True, color="C00000")
    note_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # Yellow highlight legend row
    ws.merge_cells(start_row=legend_row, start_column=1, end_row=legend_row, end_column=25)
    legend_text = (
        "YELLOW HIGHLIGHT LEGEND: Shaded cells (D, K, L, N) were NOT printed in the PDF Schedule Table — "
        "values were derived from CAD Plan geometry / Section heights or Sheet Constants (Cols O..AD). "
        "Confirm against actual structural design / site sizes before approval."
    )
    leg_cell = ws.cell(legend_row, 1, legend_text)
    leg_cell.font = Font(name="Calibri", size=11, bold=True, color="854D0E")
    leg_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    for c in range(1, 26):
        c_leg = ws.cell(legend_row, c)
        c_leg.fill = INFERRED_FILL
        c_leg.border = CELL_BORDER

    # Print setup (Landscape A3 fit 1 page wide across A..Y printable columns)
    ws.print_area = f"A1:Y{legend_row}"
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0

    buf = io.BytesIO()
    wb.save(buf)
    return inject_drawingml_shapes(buf.getvalue(), shape_rows, cached_values=cached_values)
