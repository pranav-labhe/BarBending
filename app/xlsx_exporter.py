"""Excel (.xlsx) Bar Bending Schedule exporter with live formulas and native DrawingML shapes."""

from __future__ import annotations

import io
import re
from typing import Optional

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.drawingml_injector import inject_drawingml_shapes
from app.models import DIAMETER_COLUMNS, BbsDocument, ShapeSpec

COL_WIDTHS: dict[int, float] = {
    1: 13.2,
    2: 16.5,
    3: 35.7,
    4: 12.0,
    5: 9.5,
    6: 7.8,
    7: 7.8,
    8: 9.0,
    9: 9.3,
    10: 15.2,
    11: 12.0,
    12: 33.0,
    13: 13.5,
    14: 13.8,
    15: 15.7,
    16: 21.3,
    17: 14.5,
    18: 15.7,
    19: 15.0,
    20: 16.7,
    21: 12.7,
    22: 12.7,
    23: 12.7,
    24: 12.7,
    25: 26.3,
}

THIN = Side(style="thin", color="BFBFBF")
MED = Side(style="medium", color="404040")
CELL_BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEADER_BORDER = Border(left=THIN, right=THIN, top=MED, bottom=MED)

TITLE_FILL = PatternFill(start_color="D9E1F2", end_color="D9E1F2", fill_type="solid")
SUBHDR_FILL = PatternFill(start_color="EDF2F8", end_color="EDF2F8", fill_type="solid")
TOTAL_GREEN_FILL = PatternFill(start_color="92D050", end_color="92D050", fill_type="solid")
INFERRED_FILL = PatternFill(start_color="FFF9DB", end_color="FFF9DB", fill_type="solid")

WEIGHT_FMT = '_-* #,##0.000_-;\\-* #,##0.000_-;_-* "-"_-;_-@_-'
TOTAL_MT_FMT = "#,##0.000_ ;\\-#,##0.000\\ "


def _resolve_formula(
    expr: Optional[str],
    excel_row: int,
    first_tie_row: Optional[int],
) -> Optional[str]:
    """Resolve symbolic row-relative formula tokens into valid Excel A1 formulas."""
    if not expr or not expr.startswith("="):
        return None
    out = expr
    out = out.replace("SELF_SPAN", f"D{excel_row}")
    out = out.replace("PREV_SPAN", f"D{excel_row - 1}")
    out = out.replace("PREV_CUT", f"N{excel_row - 1}")
    if "FIRST_TIE_NOS" in out:
        target = first_tie_row if first_tie_row is not None else excel_row - 1
        out = out.replace("FIRST_TIE_NOS", f"K{target}")
    if "PREV_TIE" in out:
        out = out.replace("PREV_TIE", f"D{excel_row - 1}")
    return out


def export_bbs_xlsx(doc: BbsDocument) -> bytes:
    """Build an .xlsx workbook with live Excel formulas and injected DrawingML rebar shapes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "FORMAT"
    ws.views.sheetView[0].showGridLines = True

    for col_idx, width in COL_WIDTHS.items():
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # Row heights for header
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

    # Rows 2-4: Metadata block
    meta_font = Font(name="Calibri Light", size=18, bold=True)
    meta_val_font = Font(name="Calibri Light", size=16, bold=True)
    ws.merge_cells("A2:B2")
    ws.merge_cells("C2:I2")
    ws.merge_cells("J2:K2")
    ws.merge_cells("L2:Q2")
    ws.merge_cells("R2:Y4")
    ws["A2"] = "Project:- "
    ws["C2"] = doc.project_name
    ws["J2"] = "Drawing No:- "
    ws["L2"] = doc.drawing_no

    ws.merge_cells("A3:B3")
    ws.merge_cells("C3:I3")
    ws.merge_cells("J3:K3")
    ws.merge_cells("L3:N3")
    ws["A3"] = "Location: "
    ws["C3"] = doc.location
    ws["J3"] = "Date  "
    if doc.date_str:
        ws["L3"] = doc.date_str
    else:
        ws["L3"] = "=+TODAY()"
        ws["L3"].number_format = "yyyy-mm-dd"

    ws.merge_cells("A4:B4")
    ws.merge_cells("C4:I4")
    ws["A4"] = "Structure :"
    ws["C4"] = doc.structure

    for r in range(2, 5):
        for c in range(1, 26):
            cell = ws.cell(r, c)
            cell.font = meta_font if c in (1, 10) else meta_val_font
            cell.alignment = Alignment(horizontal="left", vertical="center")
            cell.border = CELL_BORDER

    # Rows 5-6: Table Headers
    hdr_font = Font(name="Calibri Light", size=18, bold=True)
    sub_font = Font(name="Calibri Light", size=16, bold=True)
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
        16: f"Total WT. IN KG. ({round(doc.total_weight_mt * 1000):.0f})",
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
    shape_rows: list[tuple[int, ShapeSpec]] = []

    data_start_row = 8
    cur_row = data_start_row
    first_tie_row_by_group: dict[str, int] = {}
    sr_merges: list[tuple[int, int]] = []
    cur_sr_start: Optional[int] = None

    for row in doc.rows:
        is_tall = row.shape.kind in ("stirrup_rect", "center_link", "combined_loop", "chair")
        ws.row_dimensions[cur_row].height = 65.25 if is_tall else 46.5

        if row.sr_no is not None:
            if cur_sr_start is not None and cur_row - 1 > cur_sr_start:
                sr_merges.append((cur_sr_start, cur_row - 1))
            cur_sr_start = cur_row
            ws.cell(cur_row, 1, row.sr_no)

        ws.cell(cur_row, 2, row.bar_mark)
        ws.cell(cur_row, 3, row.description)

        # Span (Col D)
        if "COL.TIES" in row.description and row.group_key not in first_tie_row_by_group:
            first_tie_row_by_group[row.group_key] = cur_row
        first_tie_r = first_tie_row_by_group.get(row.group_key)

        span_f = _resolve_formula(row.span_expr, cur_row, first_tie_r)
        if span_f:
            ws.cell(cur_row, 4, span_f)
        elif row.span_mm > 0:
            ws.cell(cur_row, 4, row.span_mm)

        # Dia (Col E)
        ws.cell(cur_row, 5, row.dia_mm)

        # Spacing (Col J)
        if row.spacing_mm is not None and row.spacing_mm > 0:
            ws.cell(cur_row, 10, row.spacing_mm)

        # Nos (Col K)
        nos_f = _resolve_formula(row.nos_expr, cur_row, first_tie_r)
        if nos_f:
            ws.cell(cur_row, 11, nos_f)
        elif row.nos > 0 or row.group_key not in ("CHAIRS", "SPACERS"):
            ws.cell(cur_row, 11, row.nos)

        # Multiple No (Col L)
        if row.multiple_no > 0 or row.group_key not in ("CHAIRS", "SPACERS"):
            ws.cell(cur_row, 12, row.multiple_no)

        # Total Nos (Col M) -> Live Formula =+L*K
        if row.group_key in ("CHAIRS", "SPACERS") and row.nos == 0:
            pass
        else:
            ws.cell(cur_row, 13, f"=+L{cur_row}*K{cur_row}")
            ws.cell(cur_row, 13).number_format = "0"

        # Cut Length (Col N)
        cut_f = _resolve_formula(row.cut_length_expr, cur_row, first_tie_r)
        if cut_f:
            ws.cell(cur_row, 14, cut_f)
        else:
            ws.cell(cur_row, 14, row.cut_length_mm)
        ws.cell(cur_row, 14).number_format = "0"

        # Coupler (Col O)
        if row.group_key not in ("CHAIRS", "SPACERS"):
            ws.cell(cur_row, 15, row.coupler)

        # Dia-wise Weight (Cols P..X) -> Live Excel Formula
        for idx in range(len(DIAMETER_COLUMNS)):
            col_c = 16 + idx
            col_let = get_column_letter(col_c)
            if row.group_key in ("CHAIRS", "SPACERS") and row.nos == 0:
                if row.weight_kg > 0 and DIAMETER_COLUMNS[idx] == row.dia_mm:
                    ws.cell(cur_row, col_c, row.weight_kg)
            else:
                ws.cell(
                    cur_row,
                    col_c,
                    f"=IF($E{cur_row}={col_let}$6,$M{cur_row},0)*($N{cur_row}*$E{cur_row}*$E{cur_row}/(162*1000))",
                )
            ws.cell(cur_row, col_c).number_format = WEIGHT_FMT

        # Remark (Col Y)
        if row.remark:
            ws.cell(cur_row, 25, row.remark)

        # Styling
        for c in range(1, 26):
            cell = ws.cell(cur_row, c)
            cell.font = desc_font if c == 3 else body_font
            align_h = "left" if c in (2, 3, 25) else "center"
            cell.alignment = Alignment(horizontal=align_h, vertical="center")
            cell.border = CELL_BORDER
            if row.inferred and c in (4, 11, 12, 14):
                cell.fill = INFERRED_FILL

        if row.shape and row.shape.kind:
            shape_rows.append((cur_row, row.shape))

        cur_row += 1

    if cur_sr_start is not None and cur_row - 1 > cur_sr_start:
        sr_merges.append((cur_sr_start, cur_row - 1))

    for r_start, r_end in sr_merges:
        ws.merge_cells(start_row=r_start, start_column=1, end_row=r_end, end_column=1)

    last_data_row = cur_row - 1

    # Blank spacer row + Summary rows
    sum_row = last_data_row + 2
    lbl_row = sum_row + 1
    grand_row = sum_row + 2
    note_row = sum_row + 3

    ws.row_dimensions[last_data_row + 1].height = 24.0
    ws.row_dimensions[sum_row].height = 48.0
    ws.row_dimensions[lbl_row].height = 36.0
    ws.row_dimensions[grand_row].height = 39.0
    ws.row_dimensions[note_row].height = 28.0

    ws.merge_cells(start_row=sum_row, start_column=1, end_row=sum_row, end_column=3)
    ws.cell(sum_row, 1, "Total Weight (MT)")
    for idx, dia in enumerate(DIAMETER_COLUMNS):
        col_c = 16 + idx
        col_let = get_column_letter(col_c)
        c_sum = ws.cell(sum_row, col_c, f"=SUM({col_let}{data_start_row}:{col_let}{last_data_row})/1000")
        c_sum.font = Font(name="Calibri Light", size=14, bold=True)
        c_sum.number_format = WEIGHT_FMT
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
    gt_cell.font = hdr_font
    gt_cell.number_format = TOTAL_MT_FMT
    gt_cell.alignment = Alignment(horizontal="center", vertical="center")
    for c in range(16, 25):
        ws.cell(grand_row, c).fill = TOTAL_GREEN_FILL
    for c in range(1, 26):
        ws.cell(grand_row, c).border = HEADER_BORDER

    # Footer note
    ws.merge_cells(start_row=note_row, start_column=1, end_row=note_row, end_column=25)
    note_cell = ws.cell(note_row, 1, doc.note_footer)
    note_cell.font = Font(name="Calibri", size=11, bold=True, color="C00000")
    note_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # Print setup (Landscape A3 fit 1 page wide)
    ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0

    buf = io.BytesIO()
    wb.save(buf)
    raw_bytes = buf.getvalue()

    # Inject native DrawingML vector rebar shapes into columns F:I
    return inject_drawingml_shapes(raw_bytes, shape_rows)
