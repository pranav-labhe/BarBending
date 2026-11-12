"""Bar Bending Schedule (BBS) engineering calculation engine (unrounded, cell-formula linked)."""

from __future__ import annotations

import re
from typing import Optional

from app.formula_engine import format_exact, resolve_row_formula
from app.models import (
    DIAMETER_COLUMNS,
    BbsDocument,
    BbsRow,
    CalcSettings,
    ScheduleFootRow,
    ShapeSpec,
)


def compute_weight_kg(
    total_nos: float,
    cut_length_mm: float,
    dia_mm: float,
    unit_wt_divisor: float = 162.0,
    scale_divisor: float = 1000.0,
) -> float:
    """Standard Indian rebar unit-weight formula: (D^2 / 162) * (L_mm / 1000) * N."""
    if total_nos <= 0 or cut_length_mm <= 0 or dia_mm <= 0 or unit_wt_divisor <= 0 or scale_divisor <= 0:
        return 0.0
    return (
        float(total_nos)
        * (float(cut_length_mm) / float(scale_divisor))
        * ((float(dia_mm) * float(dia_mm)) / float(unit_wt_divisor))
    )


def _wrap_roundup(inner_expr: str, round_up: bool) -> str:
    body = inner_expr.lstrip("=")
    if round_up:
        return f"=ROUNDUP({body},0)"
    return f"={body}"


def _sync_roundup_expr(expr: Optional[str], round_up: bool) -> Optional[str]:
    """Toggle ROUNDUP(...,0) cleanly when round_up_nos changes in UI/settings."""
    if not expr or not expr.startswith("="):
        return expr
    body = expr[1:].strip()
    # Direct reference like =K12 or =@ID:...:K inherits rounding from target row
    if body.startswith("@ID:") or re.fullmatch(r"[A-Z]+\d+", body):
        return expr
    m = re.fullmatch(r"ROUNDUP\((.*),0\)", body, flags=re.IGNORECASE)
    if m and not round_up:
        return f"={m.group(1)}"
    if not m and round_up and "/" in body:
        return f"=ROUNDUP({body},0)"
    return expr


def _build_box_footing_rows(
    item: ScheduleFootRow, sr_no: int, settings: CalcSettings
) -> list[BbsRow]:
    """Generate footing mesh, side bars, column verticals, and stirrup rows for C1..C6."""
    rows: list[BbsRow] = []
    mark = item.mark
    ll_dia = float(item.long_lower_dia or 12)
    su_dia = float(item.short_upper_dia or 12)
    sb_dia = float(item.side_bars_dia or 10)
    v_dia = float(item.vert_dia or 16)
    t_dia = float(item.ties_dia or 8)
    t_sp = float(item.ties_spacing or 150)

    box_mult = float(item.box_count)
    col_mult = float(item.total_col_count or item.box_count)
    depth = float(item.depth_mm)
    cov = settings.footing_cover_mm
    ccov = settings.column_cover_mm
    d_eff = max(100.0, depth - 2.0 * cov)
    l_eff = max(100.0, float(item.footing_l_mm) - 2.0 * cov)
    b_eff = max(100.0, float(item.footing_b_mm) - 2.0 * cov)

    ll_id = f"{mark}_long_lower"
    su_id = f"{mark}_short_upper"

    # 1. LONG LOWER
    rows.append(
        BbsRow(
            id=ll_id,
            sr_no=sr_no,
            group_key=mark,
            bar_mark=f"{mark} Footing",
            description="LONG LOWER",
            span_mm=float(item.footing_l_mm),
            dia_mm=ll_dia,
            shape=ShapeSpec(kind="u_bar", labels={"span": f"{l_eff:g}", "leg": f"{d_eff:g}"}),
            nos=float(item.long_lower_nos),
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=box_mult,
            cut_length_expr="=(@SELF:Z-2*$S$2)+(@SELF:D-2*$S$2)+(@SELF:Z-2*$S$2)-(2*@SELF:E)",
            param_z=depth,
            param_ac=box_mult,
            param_ad=1.0,
            param_ae="Z=Depth(mm); AC=BoxQty; AD=Layers",
            remark="",
        )
    )

    # 2. SHORT UPPER
    rows.append(
        BbsRow(
            id=su_id,
            sr_no=None,
            group_key=mark,
            bar_mark=f"{mark} Footing",
            description="SHORT UPPER",
            span_mm=float(item.footing_b_mm),
            dia_mm=su_dia,
            shape=ShapeSpec(kind="u_bar", labels={"span": f"{b_eff:g}", "leg": f"{d_eff:g}"}),
            nos=float(item.short_upper_nos),
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=box_mult,
            cut_length_expr="=(@SELF:Z-2*$S$2)+(@SELF:D-2*$S$2)+(@SELF:Z-2*$S$2)-(2*@SELF:E)",
            param_z=depth,
            param_ac=box_mult,
            param_ad=1.0,
            param_ae="Z=Depth(mm); AC=BoxQty; AD=Layers",
            remark="",
        )
    )

    # 3. SIDE BARS — links directly to LONG LOWER Span/Dia and SHORT UPPER Span
    hook_part = "+2*MAX($S$3*@SELF:E,$U$3)"
    sb_span_expr = (
        f"=2*(@ID:{ll_id}:D-2*$S$2)+2*(@ID:{su_id}:D-2*$S$2)"
        f"{hook_part}-(4*@ID:{ll_id}:E)+@SELF:AB"
    )
    rows.append(
        BbsRow(
            id=f"{mark}_side_bars",
            sr_no=None,
            group_key=mark,
            bar_mark=f"{mark} Footing",
            description="SIDE BARS",
            span_expr=sb_span_expr,
            dia_mm=sb_dia,
            shape=ShapeSpec(kind="straight", labels={"text": "Along Perimeter"}),
            nos=float(item.side_bars_nos),
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=box_mult,
            cut_length_expr="=@SELF:D",
            param_ab=0.0,
            param_ac=box_mult,
            param_ad=1.0,
            param_ae="AB=ManualAdj(mm); AC=BoxQty; AD=Layers",
            inferred=False,
        )
    )

    # 4. COLUMN VERTICAL
    h_col = settings.column_height_mm
    ld = settings.ld_vertical_mm
    rows.append(
        BbsRow(
            id=f"{mark}_col_vert",
            sr_no=None,
            group_key=mark,
            bar_mark=f"{mark} Col. Vertical",
            description=f"COLUMN(upto {h_col / 1000:.3f} m)",
            span_expr="=$Y$2+$W$2",
            dia_mm=v_dia,
            shape=ShapeSpec(kind="l_bar", labels={"ld": f"{ld:g}", "height": f"{h_col:g}"}),
            nos=float(item.vert_nos),
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=col_mult,
            cut_length_expr="=@SELF:D",
            param_ac=col_mult,
            param_ad=1.0,
            param_ae="Span=$Y$2(Ld)+$W$2(ColHt); AC=ColQty; AD=Layers",
            remark=f"Ld={ld:g}" if mark == "C1" else "",
        )
    )

    # 5. COLUMN STIRRUPS (strictly unrounded ch/6 or ch/5 step)
    cw = max(100.0, float(item.col_b_mm) - 2.0 * ccov)
    ch = max(100.0, float(item.col_l_mm) - 2.0 * ccov)
    hk = max(settings.hook_mult * t_dia, settings.hook_min_mm)

    outer_tie_id = f"{mark}_tie_outer"
    outer_span_expr = (
        "=2*(@SELF:Z-2*$U$2)+2*(@SELF:AA-2*$U$2)"
        "+2*MAX($S$3*@SELF:E,$U$3)-(3*2*@SELF:E)-(3*@SELF:E)"
    )
    outer_nos_expr = _wrap_roundup("$W$2/@SELF:J", settings.round_up_nos)

    rows.append(
        BbsRow(
            id=outer_tie_id,
            sr_no=None,
            group_key=mark,
            bar_mark=f"{mark} Col. Stirrups",
            description="COL.TIES(OUTER)",
            span_expr=outer_span_expr,
            dia_mm=t_dia,
            shape=ShapeSpec(kind="stirrup_rect", labels={"a": f"{ch:g}", "b": f"{cw:g}", "hook": f"{hk:g}"}),
            spacing_mm=t_sp,
            nos_expr=outer_nos_expr,
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=col_mult,
            cut_length_expr="=@SELF:D",
            param_z=float(item.col_b_mm),
            param_aa=float(item.col_l_mm),
            param_ac=col_mult,
            param_ad=1.0,
            param_ae="Z=ColB(mm); AA=ColL(mm); Nos uses $W$2(ColHt)/J; AC=ColQty",
        )
    )

    div_ref = "$W$4" if item.vert_nos >= 16 else "$Y$4"
    div_val = settings.tie_step_div_ge16 if item.vert_nos >= 16 else settings.tie_step_div_lt16
    step = ch / div_val  # strictly unrounded
    cur_ch = ch
    for idx_layer, lname in enumerate(("MIDDLE", "INNER"), start=1):
        cur_ch = cur_ch - 2.0 * step
        rows.append(
            BbsRow(
                id=f"{mark}_tie_{lname.lower()}",
                sr_no=None,
                group_key=mark,
                bar_mark=f"{mark} Col. Stirrups",
                description=f"COL.TIES({lname})",
                span_expr=f"=@PREV:D-2*((@ID:{outer_tie_id}:AA-2*$U$2)/{div_ref})",
                dia_mm=t_dia,
                shape=ShapeSpec(
                    kind="stirrup_rect",
                    labels={"a": f"{cur_ch:.6g}", "b": f"{cw:g}", "hook": f"{hk:g}"},
                ),
                spacing_mm=t_sp,
                nos_expr=f"=@ID:{outer_tie_id}:K",
                multiple_expr=f"=@ID:{outer_tie_id}:L",
                multiple_no=col_mult,
                cut_length_expr="=@SELF:D",
                param_ae=f"Step=2*(ColL_eff/{div_ref} unrounded)",
            )
        )

    if item.vert_nos >= 16:
        rows.append(
            BbsRow(
                id=f"{mark}_tie_center",
                sr_no=None,
                group_key=mark,
                bar_mark=f"{mark} Col. Stirrups",
                description="COL.TIES(CENTER)",
                span_expr=f"=(@ID:{outer_tie_id}:Z-2*$U$2)+2*MAX($S$3*@SELF:E,$U$3)-(3*@SELF:E*2)",
                dia_mm=t_dia,
                shape=ShapeSpec(kind="center_link", labels={"a": f"{cw:g}", "hook": f"{hk:g}"}),
                spacing_mm=t_sp,
                nos_expr=f"=@ID:{outer_tie_id}:K",
                multiple_expr=f"=@ID:{outer_tie_id}:L",
                multiple_no=col_mult,
                cut_length_expr="=@SELF:D",
                param_ae="Link uses OuterTie Z(ColB)-2*$U$2",
            )
        )

    return rows


def _build_cf1_or_cf2_rows(
    item: ScheduleFootRow,
    sw_item: Optional[ScheduleFootRow],
    sr_no: int,
    settings: CalcSettings,
) -> list[BbsRow]:
    """Generate mesh, side bar, and enclosing shear-wall rows for a lift/core combined footing."""
    rows: list[BbsRow] = []
    mark = item.mark
    cov = settings.footing_cover_mm
    ccov = settings.column_cover_mm
    sp = float(item.long_lower_spacing or 150)
    dia = float(item.long_lower_dia or 12)
    cf_count = float(max(1, item.combined_count))
    depth = float(item.depth_mm)

    b_dim = float(item.footing_b_mm or 0)
    l_dim = float(item.footing_l_mm or 0)
    long_span = max(b_dim, l_dim)
    short_span = min(b_dim, l_dim)
    leg = max(100.0, depth - 2.0 * cov)
    long_eff = max(100.0, long_span - 2.0 * cov)
    short_eff = max(100.0, short_span - 2.0 * cov)
    nos_expr = _wrap_roundup("((@SELF:AA-2*$S$2-@SELF:E)/@SELF:J)+1", settings.round_up_nos)
    cut_expr = "=2*(@SELF:Z-2*$S$2-@SELF:AB)+(@SELF:D-2*$S$2-@SELF:AB)-(2*@SELF:E)"

    cf_long_id = f"{mark}_long"
    cf_short_id = f"{mark}_short"
    rows.append(
        BbsRow(
            id=cf_long_id,
            sr_no=sr_no,
            group_key=mark,
            bar_mark=mark,
            description=f"{mark} SHAFT (LONG LOWER)",
            span_mm=long_span,
            dia_mm=dia,
            shape=ShapeSpec(kind="combined_loop", labels={"span": f"{long_eff:g}", "leg": f"{leg:g}"}),
            spacing_mm=sp,
            nos_expr=nos_expr,
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=cf_count * 2.0,
            cut_length_expr=cut_expr,
            param_z=depth,
            param_aa=short_span,
            param_ab=0.0,
            param_ac=cf_count,
            param_ad=2.0,
            param_ae="Z=Depth; AA=PerpSpan; AB=ManualOff(mm); AC=Qty; AD=Layers(2)",
        )
    )
    rows.append(
        BbsRow(
            id=cf_short_id,
            sr_no=None,
            group_key=mark,
            bar_mark=mark,
            description=f"{mark} SHAFT (SHORT UPPER)",
            span_mm=short_span,
            dia_mm=dia,
            shape=ShapeSpec(kind="combined_loop", labels={"span": f"{short_eff:g}", "leg": f"{leg:g}"}),
            spacing_mm=sp,
            nos_expr=nos_expr,
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=cf_count * 2.0,
            cut_length_expr=cut_expr,
            param_z=depth,
            param_aa=long_span,
            param_ab=0.0,
            param_ac=cf_count,
            param_ad=2.0,
            param_ae="Z=Depth; AA=PerpSpan; AB=ManualOff(mm); AC=Qty; AD=Layers(2)",
        )
    )
    rows.append(
        BbsRow(
            id=f"{mark}_side",
            sr_no=None,
            group_key=mark,
            bar_mark=mark,
            description="SIDE BARS",
            span_expr=(
                f"=2*(@ID:{cf_long_id}:D-2*$S$2)+2*(@ID:{cf_short_id}:D-2*$S$2)"
                f"+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:{cf_long_id}:E)+@SELF:AB"
            ),
            dia_mm=float(item.side_bars_dia or 10),
            shape=ShapeSpec(kind="straight", labels={"text": "Along Perimeter"}),
            nos=float(item.side_bars_nos or 2),
            multiple_expr="=@SELF:AC*@SELF:AD",
            multiple_no=cf_count,
            cut_length_expr="=@SELF:D",
            param_ab=0.0,
            param_ac=cf_count,
            param_ad=1.0,
            param_ae="Perimeter linked to LONG/SHORT spans + Hook($S$3/$U$3); AC=Qty; AD=Layers",
        )
    )

    if item.shaft_inner_b_mm and item.shaft_inner_l_mm:
        ib = float(item.shaft_inner_b_mm)
        il = float(item.shaft_inner_l_mm)
        ht_ref = "$S$4" if mark == "CF1" else "$U$4"
        ht_val = settings.shear_wall_ht_cf1_mm if mark == "CF1" else settings.shear_wall_ht_cf2_mm
        sw_cut_est = (
            (ht_val - ccov + depth - cov - dia - dia + settings.sw_dowel_mm)
            if mark == "CF1"
            else (ht_val + settings.sw_dowel_mm)
        )
        sw_cut_expr = (
            f"={ht_ref}-$U$2+@ID:{cf_long_id}:Z-$S$2-2*@ID:{cf_long_id}:E+$P$3"
            if mark == "CF1"
            else f"=$P$3+{ht_ref}"
        )
        sw_cut_ae = (
            f"Z=ShaftB; AA=ShaftL; CutLen={ht_ref}-$U$2+Z-$S$2-2*Dia+$P$3"
            if mark == "CF1"
            else f"Z=ShaftB; AA=ShaftL; CutLen=$P$3(Dowel)+{ht_ref}(SW_Ht)"
        )
        sw_label = f"{sw_item.mark} {mark}" if sw_item else f"SW {mark}"
        sw_ef_id = f"{mark}_sw_ef"
        sw_ec_id = f"{mark}_sw_ec"
        sw_tie_sp = float(sw_item.ties_spacing if sw_item and sw_item.ties_spacing else sp)

        rows.append(
            BbsRow(
                id=sw_ef_id,
                sr_no=None,
                group_key=mark,
                bar_mark=sw_label,
                description="SHEAR WALL E/F",
                span_expr="=2*(@SELF:Z+@SELF:AA)",
                dia_mm=10.0,
                shape=ShapeSpec(kind="l_bar", labels={"ld": f"{settings.sw_dowel_mm:g}", "height": f"{sw_cut_est - settings.sw_dowel_mm:g}"}),
                spacing_mm=sp,
                nos_expr=_wrap_roundup("@SELF:D/@SELF:J", settings.round_up_nos),
                multiple_expr="=@SELF:AC*@SELF:AD",
                multiple_no=cf_count * 2.0,
                cut_length_expr=sw_cut_expr,
                param_z=ib,
                param_aa=il,
                param_ac=cf_count,
                param_ad=2.0,
                param_ae=sw_cut_ae,
                remark=f"upto {ht_val:g} ht.",
            )
        )
        ec_nos = float(sw_item.vert_nos if sw_item and sw_item.vert_nos else 4)
        ec_dia = float(sw_item.vert_dia if sw_item and sw_item.vert_dia else 12)
        rows.append(
            BbsRow(
                id=sw_ec_id,
                sr_no=None,
                group_key=mark,
                bar_mark=sw_label,
                description="SHEAR WALL E/C",
                span_expr=f"=@ID:{sw_ef_id}:D",
                dia_mm=ec_dia,
                shape=ShapeSpec(kind="l_bar", labels={"ld": f"{settings.sw_dowel_mm:g}", "height": f"{sw_cut_est - settings.sw_dowel_mm:g}"}),
                nos=ec_nos,
                multiple_expr="=@SELF:AC*@SELF:AD",
                multiple_no=cf_count * 4.0,
                cut_length_expr=f"=@ID:{sw_ef_id}:N",
                param_ac=cf_count,
                param_ad=4.0,
                param_ae="Span & CutLen linked to SHEAR WALL E/F; AD=4 corners",
            )
        )
        sw_tie_dia = float(sw_item.ties_dia if sw_item and sw_item.ties_dia else 8)
        rows.append(
            BbsRow(
                id=f"{mark}_tie_outer",
                sr_no=None,
                group_key=mark,
                bar_mark=sw_label,
                description="SHEAR WALL TIES Outer",
                span_expr=f"=@ID:{sw_ef_id}:D-(4*$U$2)+2*MAX($S$3*@SELF:E,$U$3)-(3*2*@SELF:E)-(3*@SELF:E)",
                dia_mm=sw_tie_dia,
                shape=ShapeSpec(kind="stirrup_rect"),
                spacing_mm=sw_tie_sp,
                nos_expr=_wrap_roundup(f"{ht_ref}/@SELF:J", settings.round_up_nos),
                multiple_expr="=@SELF:AC",
                multiple_no=cf_count,
                cut_length_expr="=@SELF:D",
                param_ac=cf_count,
                param_ae=f"Perimeter - 4*ColCover($U$2) + Hook($S$3/$U$3); Nos={ht_ref}/J",
                inferred=True,
                source_note=(
                    f"Not printed in the PDF Schedule Table. Horizontal ties for {sw_label} "
                    f"are derived from the CAD Plan shaft box ({format_exact(ib)}x{format_exact(il)} mm, perimeter=2*(B+L)) "
                    f"and Shear Wall Height {format_exact(ht_val)} mm ({ht_ref}); stirrup size {format_exact(sw_tie_dia)}mm @ {format_exact(sw_tie_sp)} c/c. "
                    f"Confirm against actual design / site sizes before export."
                ),
            )
        )
        rows.append(
            BbsRow(
                id=f"{mark}_tie_inner",
                sr_no=None,
                group_key=mark,
                bar_mark=sw_label,
                description="SHEAR WALL TIES Inner",
                span_expr="=@PREV:D-(4*$O$4)",
                dia_mm=sw_tie_dia,
                shape=ShapeSpec(kind="stirrup_rect"),
                spacing_mm=sw_tie_sp,
                nos_expr=f"=@ID:{mark}_tie_outer:K",
                multiple_expr="=@SELF:AC",
                multiple_no=cf_count,
                cut_length_expr="=@SELF:D",
                param_ac=cf_count,
                param_ae="OuterTie - 4*SWInnerOff($O$4)",
                inferred=True,
                source_note=(
                    f"Not printed in the PDF Schedule Table. Inner stirrup ring for {sw_label} "
                    f"steps inward 4*SWInnerOff ({format_exact(settings.sw_inner_offset_mm)} mm in $O$4) from Outer Ties and matches Outer Nos. "
                    f"Confirm against actual design / site sizes before export."
                ),
            )
        )
    return rows


def _build_cf3_cf4_cf5_rows(
    item: ScheduleFootRow, sr_no: int, settings: CalcSettings
) -> list[BbsRow]:
    """Generate uniform unrounded column-formula rows for polygon and rectangular combined footings."""
    rows: list[BbsRow] = []
    mark = item.mark
    cov = settings.footing_cover_mm
    dia = float(item.long_lower_dia or 12)
    sp = float(item.long_lower_spacing or 125)
    depth = float(item.depth_mm)
    leg = max(100.0, depth - 2.0 * cov)
    cf_count = float(max(1, item.combined_count))
    cf_mult = cf_count * 2.0
    cut_loop_expr = "=2*(@SELF:Z-2*$S$2-@SELF:AB)+(@SELF:D-2*$S$2-@SELF:AB)-(2*@SELF:E)"
    nos_inner = "((@SELF:AA-2*$S$2-@SELF:E)/@SELF:J)+1"

    if item.l_shape_segments:
        segs = item.l_shape_segments
        for idx, seg in enumerate(segs):
            span_v = float(seg["span"])
            dist_v = float(seg["dist"])
            cut_span_v = max(100.0, span_v - 2.0 * cov)
            rows.append(
                BbsRow(
                    id=f"{mark}_seg_{idx+1}",
                    sr_no=sr_no if idx == 0 else None,
                    group_key=mark,
                    bar_mark=mark,
                    description=str(seg["label"]),
                    span_mm=span_v,
                    dia_mm=dia,
                    shape=ShapeSpec(kind="combined_loop", labels={"span": f"{cut_span_v:g}", "leg": f"{leg:g}"}),
                    spacing_mm=sp,
                    nos_expr=_wrap_roundup(nos_inner, settings.round_up_nos),
                    multiple_expr="=@SELF:AD*@SELF:AC",
                    multiple_no=cf_mult,
                    cut_length_expr=cut_loop_expr,
                    param_z=depth,
                    param_aa=dist_v,
                    param_ab=0.0,
                    param_ac=cf_count,
                    param_ad=2.0,
                    param_ae="Z=Depth; AA=DistWidth; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
                    inferred=True,
                    source_note=(
                        f"Irregular polygon band dimensions for {mark} ({seg['label']}) are not tabulated in the PDF Schedule Table; "
                        f"span {format_exact(span_v)} mm and distribution width {format_exact(dist_v)} mm are measured from CAD Plan geometry "
                        f"(depth {format_exact(depth)} mm, Dia/Spacing from Schedule, {format_exact(cf_count)} No.). "
                        f"Confirm against actual design / site sizes before export."
                    ),
                )
            )
        sb_dia = float(item.side_bars_dia or 10)
        sb_nos = float(item.side_bars_nos or 3)
        seg1_id = f"{mark}_seg_1"
        seg_orth_id = f"{mark}_seg_3" if len(segs) >= 3 else f"{mark}_seg_{min(2, len(segs))}"
        rows.append(
            BbsRow(
                id=f"{mark}_side",
                sr_no=None,
                group_key=mark,
                bar_mark=mark,
                description="SIDE BARS",
                span_expr=(
                    f"=2*(@ID:{seg1_id}:D-2*$S$2)+2*(@ID:{seg_orth_id}:D-2*$S$2)"
                    f"+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:{seg1_id}:E)+@SELF:AB"
                ),
                dia_mm=sb_dia,
                shape=ShapeSpec(kind="straight", labels={"text": "Along Perimeter"}),
                nos=sb_nos,
                multiple_expr="=@SELF:AC",
                multiple_no=cf_count,
                cut_length_expr="=@SELF:D",
                param_ab=0.0,
                param_ac=cf_count,
                param_ae="Perimeter linked to outer orthogonal spans + Hook($S$3/$U$3); AC=CFQty",
                inferred=True,
                source_note=(
                    f"Single B x L box perimeter for {mark} SIDE BARS ({format_exact(sb_nos)} bars of {format_exact(sb_dia)}mm) is omitted from the PDF Schedule Table; "
                    f"span is derived dynamically from Plan-measured orthogonal spans ({seg1_id} & {seg_orth_id}) less concrete cover ($S$2) plus hooks ($S$3/$U$3). "
                    f"Confirm against actual design / site sizes before export."
                ),
            )
        )
        return rows

    if item.footing_b_mm <= 0 or item.footing_l_mm <= 0:
        return rows

    b = float(min(item.footing_b_mm, item.footing_l_mm))
    l = float(max(item.footing_b_mm, item.footing_l_mm))
    l_eff = max(100.0, l - 2.0 * cov)
    b_eff = max(100.0, b - 2.0 * cov)

    long_id = f"{mark}_long"
    short_id = f"{mark}_short"
    rows.append(
        BbsRow(
            id=long_id,
            sr_no=sr_no,
            group_key=mark,
            bar_mark=mark,
            description="LONG LOWER",
            span_mm=l,
            dia_mm=dia,
            shape=ShapeSpec(kind="combined_loop", labels={"span": f"{l_eff:g}", "leg": f"{leg:g}"}),
            spacing_mm=sp,
            nos_expr=_wrap_roundup(nos_inner, settings.round_up_nos),
            multiple_expr="=@SELF:AD*@SELF:AC",
            multiple_no=cf_mult,
            cut_length_expr=cut_loop_expr,
            param_z=depth,
            param_aa=b,
            param_ab=0.0,
            param_ac=cf_count,
            param_ad=2.0,
            param_ae="Z=Depth; AA=PerpB; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
        )
    )
    rows.append(
        BbsRow(
            id=short_id,
            sr_no=None,
            group_key=mark,
            bar_mark=mark,
            description="SHORT UPPER",
            span_mm=b,
            dia_mm=dia,
            shape=ShapeSpec(kind="combined_loop", labels={"span": f"{b_eff:g}", "leg": f"{leg:g}"}),
            spacing_mm=sp,
            nos_expr=_wrap_roundup(nos_inner, settings.round_up_nos),
            multiple_expr="=@SELF:AD*@SELF:AC",
            multiple_no=cf_mult,
            cut_length_expr=cut_loop_expr,
            param_z=depth,
            param_aa=l,
            param_ab=0.0,
            param_ac=cf_count,
            param_ad=2.0,
            param_ae="Z=Depth; AA=PerpL; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
        )
    )

    sb_dia = float(item.side_bars_dia or 10)
    sb_nos = float(item.side_bars_nos or 3)
    sb_span_expr = (
        f"=2*(@ID:{long_id}:D-2*$S$2)+2*(@ID:{short_id}:D-2*$S$2)"
        f"+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:{long_id}:E)+@SELF:AB"
    )
    rows.append(
        BbsRow(
            id=f"{mark}_side",
            sr_no=None,
            group_key=mark,
            bar_mark=mark,
            description="SIDE BARS",
            span_expr=sb_span_expr,
            dia_mm=sb_dia,
            shape=ShapeSpec(kind="straight", labels={"text": "Along Perimeter"}),
            nos=sb_nos,
            multiple_expr="=@SELF:AC",
            multiple_no=cf_count,
            cut_length_expr="=@SELF:D",
            param_ab=0.0,
            param_ac=cf_count,
            param_ae="Perimeter linked to LONG/SHORT spans + Hook($S$3/$U$3); AC=CFQty",
        )
    )
    return rows


def generate_bbs_rows(
    schedule: list[ScheduleFootRow], settings: CalcSettings
) -> list[BbsRow]:
    """Generate ordered BBS rows from parsed schedule entries."""
    rows: list[BbsRow] = []
    sw_item = next((s for s in schedule if s.kind == "shear_wall"), None)
    sr_counter = 1

    for item in schedule:
        if item.kind == "shear_wall":
            continue
        if item.kind == "box_footing":
            rows.extend(_build_box_footing_rows(item, sr_counter, settings))
            sr_counter += 1
        elif item.kind == "combined_footing":
            if item.shaft_inner_b_mm and item.shaft_inner_l_mm:
                rows.extend(_build_cf1_or_cf2_rows(item, sw_item, sr_counter, settings))
            else:
                rows.extend(_build_cf3_cf4_cf5_rows(item, sr_counter, settings))
            sr_counter += 1

    if settings.include_chairs_spacers:
        rows.append(
            BbsRow(
                id="chairs_wastage",
                sr_no=sr_counter,
                group_key="CHAIRS",
                bar_mark="",
                description="Chairs (from Wastage bars)",
                span_mm=0.0,
                dia_mm=12.0,
                shape=ShapeSpec(kind="chair", labels={}),
                nos=0.0,
                multiple_expr="=@SELF:AC*@SELF:AD",
                multiple_no=1.0,
                total_nos=0.0,
                cut_length_expr="=@SELF:D",
                cut_length_mm=0.0,
                weight_kg=0.0,
                param_ac=1.0,
                param_ad=1.0,
                param_ae="Enter Span(D) & Nos(K) to compute via formula",
                remark="Suite at Site",
            )
        )
        rows.append(
            BbsRow(
                id="spacers_wastage",
                sr_no=sr_counter + 1,
                group_key="SPACERS",
                bar_mark="",
                description="Spacers (from Wastage bars)",
                span_mm=0.0,
                dia_mm=10.0,
                shape=ShapeSpec(kind="straight", labels={}),
                nos=0.0,
                multiple_expr="=@SELF:AC*@SELF:AD",
                multiple_no=1.0,
                total_nos=0.0,
                cut_length_expr="=@SELF:D",
                cut_length_mm=0.0,
                weight_kg=0.0,
                param_ac=1.0,
                param_ad=1.0,
                param_ae="Enter Span(D) & Nos(K) to compute via formula",
                remark="Suite at Site",
            )
        )

    return rows


def recalculate_document(doc: BbsDocument) -> BbsDocument:
    """Re-evaluate all cell-linked formulas and unrounded steel totals top-to-bottom."""
    totals_kg: dict[int, float] = {d: 0.0 for d in DIAMETER_COLUMNS}
    first_tie_by_group: dict[str, int] = {}
    settings = doc.settings

    for idx, row in enumerate(doc.rows):
        excel_r = 8 + idx
        if "COL.TIES" in row.description and row.group_key not in first_tie_by_group:
            first_tie_by_group[row.group_key] = excel_r
        ft_row = first_tie_by_group.get(row.group_key)

        if row.nos_expr:
            row.nos_expr = _sync_roundup_expr(row.nos_expr, settings.round_up_nos)

        if row.span_expr:
            resolved_f, _, val = resolve_row_formula(
                row.span_expr, idx, doc.rows, settings, ft_row
            )
            if resolved_f is None:
                row.span_expr = None
            elif val is not None:
                row.span_mm = val

        if row.nos_expr:
            resolved_f, _, val = resolve_row_formula(
                row.nos_expr, idx, doc.rows, settings, ft_row
            )
            if resolved_f is None:
                row.nos_expr = None
            elif val is not None:
                row.nos = val

        if row.multiple_expr:
            resolved_f, _, val = resolve_row_formula(
                row.multiple_expr, idx, doc.rows, settings, ft_row
            )
            if resolved_f is None:
                row.multiple_expr = None
            elif val is not None:
                row.multiple_no = val

        row.total_nos = float(row.nos) * float(row.multiple_no)

        if row.cut_length_expr:
            resolved_f, _, val = resolve_row_formula(
                row.cut_length_expr, idx, doc.rows, settings, ft_row
            )
            if resolved_f is None:
                row.cut_length_expr = None
            elif val is not None:
                row.cut_length_mm = val

        # Sync column description when col_height changes
        if row.id.endswith("_col_vert"):
            row.description = f"COLUMN(upto {settings.column_height_mm / 1000.0:.3f} m)"
            row.shape.labels = {
                "ld": f"{settings.ld_vertical_mm:g}",
                "height": f"{settings.column_height_mm:g}",
            }

        row.weight_kg = compute_weight_kg(
            row.total_nos,
            row.cut_length_mm,
            row.dia_mm,
            settings.unit_wt_divisor,
            settings.scale_divisor,
        )
        dia_key = int(round(row.dia_mm)) if abs(row.dia_mm - round(row.dia_mm)) < 1e-9 else None
        if dia_key in totals_kg:
            totals_kg[dia_key] += row.weight_kg

    scale = float(settings.scale_divisor or 1000.0)
    doc.totals_by_dia_mt = {d: totals_kg[d] / scale for d in DIAMETER_COLUMNS}
    doc.total_weight_mt = sum(doc.totals_by_dia_mt.values())
    return doc


def build_bbs_document(
    meta: dict[str, str],
    schedule: list[ScheduleFootRow],
    settings: CalcSettings,
    warnings: list[str],
    parse_stats: dict[str, object],
    date_str: str = "",
) -> BbsDocument:
    """Assemble and calculate a complete unrounded BbsDocument."""
    rows = generate_bbs_rows(schedule, settings)
    doc = BbsDocument(
        project_name=meta.get("project_name", "PROJECT"),
        drawing_no=meta.get("drawing_no", "SH_FOOTING_01"),
        location=meta.get("location", ""),
        date_str=date_str,
        structure=meta.get("structure", "G+9 (Footing Level 0 to 4550)"),
        settings=settings,
        schedule=schedule,
        rows=rows,
        warnings=warnings,
        parse_stats=parse_stats,
    )
    return recalculate_document(doc)
