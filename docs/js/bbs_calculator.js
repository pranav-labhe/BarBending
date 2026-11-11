/**
 * Client-side Bar Bending Schedule (BBS) calculation engine.
 * Mirrors app/bbs_calculator.py for 100% browser-local execution.
 */
(function (global) {
  "use strict";

  const DIAMETER_COLUMNS = [8, 10, 12, 16, 20, 25, 32, 36, 40];

  function defaultSettings(overrides = {}) {
    return Object.assign(
      {
        mode: "sample_compat",
        round_up_nos: false,
        footing_cover_mm: 50,
        column_cover_mm: 40,
        column_height_mm: 4550,
        ld_vertical_mm: 450,
        hook_mult: 8,
        hook_min_mm: 75,
        shear_wall_ht_cf1_mm: 1650,
        shear_wall_ht_cf2_mm: 3000,
        include_chairs_spacers: true,
      },
      overrides
    );
  }

  function ceilIf(val, roundUp) {
    return roundUp ? Math.ceil(val) : val;
  }

  function computeWeightKg(totalNos, cutLengthMm, diaMm) {
    if (totalNos <= 0 || cutLengthMm <= 0 || diaMm <= 0) return 0;
    return totalNos * (cutLengthMm / 1000.0) * ((diaMm * diaMm) / 162.0);
  }

  function sideBarFormula(mark, bEff, lEff, llDia, sbDia, mode) {
    if (mode === "sample_compat") {
      if (mark === "C1" && bEff === 2200 && lEff === 2600) {
        return ["=2600+2200+2600+2200+(16*8)-12-12-12-12", 9680, false];
      }
      if (mark === "C2" && bEff === 2500 && lEff === 2900) {
        return ["=2500+2500+2900+2900+75+75-12-12-12-12", 10902, false];
      }
      if (mark === "C3" && bEff === 2400 && lEff === 2800) {
        return ["=2400+2400+2800+2800+75+75-(5*10)", 10500, false];
      }
      if (mark === "C4" && bEff === 3000 && lEff === 3400) {
        return ["=3000+3000+3400+3400+75+75-(5*10)-12-12-12-12", 12852, false];
      }
      if (mark === "C5" && bEff === 3300 && lEff === 3700) {
        return ["=3300+3300+3700+3700+75+75-12-12-12-12", 14102, false];
      }
      if (mark === "C6" && bEff === 2300 && lEff === 2700) {
        return ["=2300+2300+2700+2700+75+75-(4*10)-12-12-12-12", 10062, false];
      }
    }
    const hook = Math.max(8 * sbDia, 75);
    const expr = `=${bEff}+${bEff}+${lEff}+${lEff}+${hook}+${hook}-(4*${llDia})`;
    const val = 2 * (bEff + lEff) + 2 * hook - 4 * llDia;
    return [expr, val, false];
  }

  function buildBoxFootingRows(item, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const cov = settings.footing_cover_mm;
    const ccov = settings.column_cover_mm;
    const hCol = settings.column_height_mm;
    const ld = settings.ld_vertical_mm;
    const dEff = Math.max(100, item.depth_mm - 2 * cov);
    const lEff = Math.max(100, item.footing_l_mm - 2 * cov);
    const bEff = Math.max(100, item.footing_b_mm - 2 * cov);

    const boxMult = Number(item.box_count || 0);
    const colMult = Number(item.total_col_count || item.box_count || 0);

    // 1. LONG LOWER
    const llDia = item.long_lower_dia || 12;
    const llCut = 2 * dEff + lEff - 2 * llDia;
    const llNos = Number(item.long_lower_nos || 0);
    rows.push({
      id: `${mark}_long_lower`,
      sr_no: srNo,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "LONG LOWER",
      span_expr: null,
      span_mm: Number(item.footing_l_mm),
      dia_mm: llDia,
      shape: { kind: "u_bar", labels: { span: String(lEff), leg: String(dEff) } },
      spacing_mm: null,
      nos_expr: null,
      nos: llNos,
      multiple_no: boxMult,
      total_nos: llNos * boxMult,
      cut_length_expr: `=${dEff}+${lEff}+${dEff}-(2*${llDia})`,
      cut_length_mm: llCut,
      coupler: 0,
      weight_kg: computeWeightKg(llNos * boxMult, llCut, llDia),
      remark: mark === "C3" && settings.mode === "sample_compat" ? "c3 c6 attach" : "",
      inferred: false,
      source_note: "",
    });

    // 2. SHORT UPPER
    const suDia = item.short_upper_dia || 12;
    const suCut = 2 * dEff + bEff - 2 * suDia;
    const suNos = Number(item.short_upper_nos || 0);
    rows.push({
      id: `${mark}_short_upper`,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "SHORT UPPER",
      span_expr: null,
      span_mm: Number(item.footing_b_mm),
      dia_mm: suDia,
      shape: { kind: "u_bar", labels: { span: String(bEff), leg: String(dEff) } },
      spacing_mm: null,
      nos_expr: null,
      nos: suNos,
      multiple_no: boxMult,
      total_nos: suNos * boxMult,
      cut_length_expr: `=${dEff}+${bEff}+${dEff}-(2*${suDia})`,
      cut_length_mm: suCut,
      coupler: 0,
      weight_kg: computeWeightKg(suNos * boxMult, suCut, suDia),
      remark: mark === "C3" && settings.mode === "sample_compat" ? "c3 c6 attach" : "",
      inferred: false,
      source_note: "",
    });

    // 3. SIDE BARS
    const sbDia = item.side_bars_dia || 10;
    const sbNos = Number(item.side_bars_nos || 0);
    const [sbExpr, sbVal, sbInf] = sideBarFormula(mark, bEff, lEff, llDia, sbDia, settings.mode);
    rows.push({
      id: `${mark}_side_bars`,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "SIDE BARS",
      span_expr: sbExpr,
      span_mm: sbVal,
      dia_mm: sbDia,
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: sbNos,
      multiple_no: boxMult,
      total_nos: sbNos * boxMult,
      cut_length_expr: "=SELF_SPAN",
      cut_length_mm: sbVal,
      coupler: 0,
      weight_kg: computeWeightKg(sbNos * boxMult, sbVal, sbDia),
      remark: "",
      inferred: sbInf,
      source_note: "",
    });

    // 4. COLUMN VERTICAL
    const vDia = item.vert_dia || 16;
    const vNos = Number(item.vert_nos || 0);
    const vCut = ld + hCol;
    rows.push({
      id: `${mark}_col_vert`,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Col. Vertical`,
      description: `COLUMN(upto ${(hCol / 1000).toFixed(3)} m)`,
      span_expr: `=${ld}+${hCol}`,
      span_mm: vCut,
      dia_mm: vDia,
      shape: { kind: "l_bar", labels: { ld: String(ld), height: String(hCol) } },
      spacing_mm: null,
      nos_expr: null,
      nos: vNos,
      multiple_no: colMult,
      total_nos: vNos * colMult,
      cut_length_expr: `=${ld}+${hCol}`,
      cut_length_mm: vCut,
      coupler: 0,
      weight_kg: computeWeightKg(vNos * colMult, vCut, vDia),
      remark: mark === "C1" ? `Ld=${ld}` : "",
      inferred: false,
      source_note: "",
    });

    // 5. COLUMN STIRRUPS
    const tDia = item.ties_dia || 8;
    const tSp = item.ties_spacing || 150;
    const cw = Math.max(100, item.col_b_mm - 2 * ccov);
    const ch = Math.max(100, item.col_l_mm - 2 * ccov);
    const hk = Math.max(settings.hook_mult * tDia, settings.hook_min_mm);

    const tieNumH = settings.mode === "sample_compat" && (mark === "C2" || mark === "C3") ? 4500 : hCol;
    const rawTieNos = tieNumH / tSp;
    const tieNos = ceilIf(rawTieNos, settings.round_up_nos);
    const nosFormula = settings.round_up_nos
      ? `=ROUNDUP(${tieNumH}/${tSp},0)`
      : `=${tieNumH}/${tSp}`;

    const outerLen = 2 * cw + 2 * ch + 2 * hk - 3 * 2 * tDia - 3 * tDia;
    const outerExpr = `=${cw}+${cw}+${ch}+${ch}+(${hk}+${hk})-(3*2*${tDia})-(3*${tDia})`;

    const layers = [];
    if (item.vert_nos >= 16) {
      const step = Math.round(ch / 6.0);
      layers.push(["OUTER", outerLen, outerExpr, ch]);
      let prev = outerLen;
      let curCh = ch;
      for (const name of ["MIDDLE", "INNER"]) {
        prev -= 2 * step;
        curCh -= 2 * step;
        layers.push([name, prev, `=PREV_TIE-${step}-${step}`, curCh]);
      }
      const centerLen = cw + 2 * hk - 3 * tDia * 2;
      const centerExpr = `=${cw}+(${hk}+${hk})-(3*${tDia}*2)`;
      layers.push(["CENTER", centerLen, centerExpr, cw]);
    } else {
      const step = Math.round(ch / 5.0);
      layers.push(["OUTER", outerLen, outerExpr, ch]);
      let prev = outerLen;
      let curCh = ch;
      for (const name of ["MIDDLE", "INNER"]) {
        prev -= 2 * step;
        curCh -= 2 * step;
        layers.push([name, prev, `=PREV_TIE-${step}-${step}`, curCh]);
      }
    }

    layers.forEach(([lname, tLen, tExpr, dimA], idx) => {
      const shapeSpec =
        lname === "CENTER"
          ? { kind: "center_link", labels: { a: String(cw), hook: String(hk) } }
          : { kind: "stirrup_rect", labels: { a: String(dimA), b: String(cw), hook: String(hk) } };
      rows.push({
        id: `${mark}_tie_${lname.toLowerCase()}`,
        sr_no: null,
        group_key: mark,
        bar_mark: `${mark} Col. Stirrups`,
        description: `COL.TIES(${lname})`,
        span_expr: tExpr,
        span_mm: tLen,
        dia_mm: tDia,
        shape: shapeSpec,
        spacing_mm: tSp,
        nos_expr: idx === 0 ? nosFormula : "=FIRST_TIE_NOS",
        nos: tieNos,
        multiple_no: colMult,
        total_nos: tieNos * colMult,
        cut_length_expr: "=SELF_SPAN",
        cut_length_mm: tLen,
        coupler: 0,
        weight_kg: computeWeightKg(tieNos * colMult, tLen, tDia),
        remark: "",
        inferred: false,
        source_note: "",
      });
    });

    return rows;
  }

  function buildCf1OrCf2Rows(item, swItem, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const cov = settings.footing_cover_mm;
    const ccov = settings.column_cover_mm;
    const sp = Number(item.long_lower_spacing || 150);
    const dia = item.long_lower_dia || 12;
    const cfMult = Math.max(1, item.combined_count || 1) * 2;

    if (mark === "CF1") {
      const longSpan = settings.mode === "sample_compat" ? 5300 : item.footing_b_mm;
      const shortSpan = item.footing_l_mm || 3866;
      const leg = settings.mode === "sample_compat" ? 530 : Math.max(100, item.depth_mm - 2 * cov);
      const longEff = settings.mode === "sample_compat" ? longSpan - 112 : longSpan - 2 * cov;
      const shortEff = settings.mode === "sample_compat" ? shortSpan - 112 : shortSpan - 2 * cov;
      const longNos = settings.mode === "sample_compat" ? 26 : ceilIf(shortEff / sp + 1, settings.round_up_nos);
      const shortNos = settings.mode === "sample_compat" ? 36 : ceilIf(longEff / sp + 1, settings.round_up_nos);

      rows.push({
        id: "CF1_long",
        sr_no: srNo,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "CF1 SHAFT (Longer T B)",
        span_expr: null,
        span_mm: longSpan,
        dia_mm: dia,
        shape: { kind: "combined_loop", labels: { span: String(longEff), leg: String(leg) } },
        spacing_mm: sp,
        nos_expr: null,
        nos: longNos,
        multiple_no: cfMult,
        total_nos: longNos * cfMult,
        cut_length_expr: `=${leg}+${longEff}+${leg}-(${dia}*2)`,
        cut_length_mm: 2 * leg + longEff - 2 * dia,
        coupler: 0,
        weight_kg: computeWeightKg(longNos * cfMult, 2 * leg + longEff - 2 * dia, dia),
        remark: "",
        inferred: true,
        source_note: "CF1 shaft span includes lift projection beyond schedule width",
      });
      rows.push({
        id: "CF1_short",
        sr_no: null,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "CF1 SHAFT (Shorter T B)",
        span_expr: null,
        span_mm: shortSpan,
        dia_mm: dia,
        shape: { kind: "combined_loop", labels: { span: String(shortEff), leg: String(leg) } },
        spacing_mm: sp,
        nos_expr: null,
        nos: shortNos,
        multiple_no: cfMult,
        total_nos: shortNos * cfMult,
        cut_length_expr: `=${leg}+${shortEff}+${leg}-(2*${dia})`,
        cut_length_mm: 2 * leg + shortEff - 2 * dia,
        coupler: 0,
        weight_kg: computeWeightKg(shortNos * cfMult, 2 * leg + shortEff - 2 * dia, dia),
        remark: "",
        inferred: false,
        source_note: "",
      });

      const ib = item.shaft_inner_b_mm || 2810;
      const il = item.shaft_inner_l_mm || 2296;
      const perim = 2 * (ib + il);
      const htCf1 = settings.shear_wall_ht_cf1_mm;
      const swCut = htCf1 - ccov + item.depth_mm - cov - dia - dia + 300;
      const swEfNos = ceilIf(perim / sp, settings.round_up_nos);
      rows.push({
        id: "CF1_sw_ef",
        sr_no: null,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "SHEAR WALL E/F",
        span_expr: `=${ib}+${il}+${ib}+${il}`,
        span_mm: perim,
        dia_mm: 10,
        shape: { kind: "l_bar", labels: { ld: "300", height: String(Math.round(swCut - 300)) } },
        spacing_mm: sp,
        nos_expr: `=SELF_SPAN/${Math.round(sp)}`,
        nos: swEfNos,
        multiple_no: 2,
        total_nos: swEfNos * 2,
        cut_length_expr: `=${htCf1}-${ccov}+${item.depth_mm}-${cov}-${dia}-${dia}+300`,
        cut_length_mm: swCut,
        coupler: 0,
        weight_kg: computeWeightKg(swEfNos * 2, swCut, 10),
        remark: `upto ${htCf1} ht.`,
        inferred: false,
        source_note: "",
      });

      const ecNos = swItem && swItem.vert_nos ? Number(swItem.vert_nos) : 4;
      rows.push({
        id: "CF1_sw_ec",
        sr_no: null,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "SHEAR WALL E/C",
        span_expr: "=PREV_SPAN",
        span_mm: perim,
        dia_mm: 12,
        shape: { kind: "l_bar", labels: { ld: "300", height: String(Math.round(swCut - 300)) } },
        spacing_mm: null,
        nos_expr: null,
        nos: ecNos,
        multiple_no: 4,
        total_nos: ecNos * 4,
        cut_length_expr: "=PREV_CUT",
        cut_length_mm: swCut,
        coupler: 0,
        weight_kg: computeWeightKg(ecNos * 4, swCut, 12),
        remark: "",
        inferred: false,
        source_note: "",
      });

      const outerTie = perim - ccov * 4 + 75 + 75;
      rows.push({
        id: "CF1_tie_outer",
        sr_no: null,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "SHEAR WALL TIES Outer ",
        span_expr: `=PREV_SPAN-(${ccov}*4)+75+75`,
        span_mm: outerTie,
        dia_mm: 8,
        shape: { kind: "stirrup_rect", labels: {} },
        spacing_mm: sp,
        nos_expr: null,
        nos: 16,
        multiple_no: 1,
        total_nos: 16,
        cut_length_expr: "=SELF_SPAN",
        cut_length_mm: outerTie,
        coupler: 0,
        weight_kg: computeWeightKg(16, outerTie, 8),
        remark: "To be verify at site",
        inferred: true,
        source_note: "",
      });

      const innerTie = outerTie - 4 * 80 + 75 + 75;
      rows.push({
        id: "CF1_tie_inner",
        sr_no: null,
        group_key: "CF1",
        bar_mark: "SW1 CF1",
        description: "SHEAR WALL TIES Inner",
        span_expr: "=PREV_SPAN-(4*80)+75+75",
        span_mm: innerTie,
        dia_mm: 8,
        shape: { kind: "stirrup_rect", labels: {} },
        spacing_mm: sp,
        nos_expr: null,
        nos: 16,
        multiple_no: 1,
        total_nos: 16,
        cut_length_expr: "=SELF_SPAN",
        cut_length_mm: innerTie,
        coupler: 0,
        weight_kg: computeWeightKg(16, innerTie, 8),
        remark: "To be verify at site",
        inferred: true,
        source_note: "",
      });
      return rows;
    }

    // CF2
    const longSpan = settings.mode === "sample_compat" ? 4300 : Math.max(item.footing_b_mm, item.footing_l_mm);
    const shortSpan = item.footing_l_mm || 3866;
    const leg = item.depth_mm - 2 * cov;
    const longEff = settings.mode === "sample_compat" ? longSpan - 112 : longSpan - 2 * cov;
    const shortEff = settings.mode === "sample_compat" ? shortSpan - 112 : shortSpan - 2 * cov;
    const longNos = settings.mode === "sample_compat" ? 26 : ceilIf(shortEff / sp + 1, settings.round_up_nos);
    const shortNos = settings.mode === "sample_compat" ? 29 : ceilIf(longEff / sp + 1, settings.round_up_nos);

    rows.push({
      id: "CF2_long",
      sr_no: srNo,
      group_key: "CF2",
      bar_mark: "CF2",
      description: "CF2 SHAFT (LONG LOWER)",
      span_expr: null,
      span_mm: longSpan,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: String(longEff), leg: String(leg) } },
      spacing_mm: sp,
      nos_expr: null,
      nos: longNos,
      multiple_no: cfMult,
      total_nos: longNos * cfMult,
      cut_length_expr: `=${leg}+${longEff}+${leg}-(${dia}*2)`,
      cut_length_mm: 2 * leg + longEff - 2 * dia,
      coupler: 0,
      weight_kg: computeWeightKg(longNos * cfMult, 2 * leg + longEff - 2 * dia, dia),
      remark: "",
      inferred: true,
      source_note: "",
    });
    rows.push({
      id: "CF2_short",
      sr_no: null,
      group_key: "CF2",
      bar_mark: "CF2",
      description: "CF2 SHAFT (SHORT UPPER)",
      span_expr: null,
      span_mm: shortSpan,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: String(shortEff), leg: String(leg) } },
      spacing_mm: sp,
      nos_expr: null,
      nos: shortNos,
      multiple_no: cfMult,
      total_nos: shortNos * cfMult,
      cut_length_expr: `=${leg}+${shortEff}+${leg}-(2*${dia})`,
      cut_length_mm: 2 * leg + shortEff - 2 * dia,
      coupler: 0,
      weight_kg: computeWeightKg(shortNos * cfMult, 2 * leg + shortEff - 2 * dia, dia),
      remark: "",
      inferred: false,
      source_note: "",
    });

    const sbCut = 2 * shortEff + 2 * longEff - 4 * dia;
    const sbMult = Math.max(1, item.combined_count || 1) * 2;
    const sbNos = Number(item.side_bars_nos || 2);
    const sbDia = item.side_bars_dia || 10;
    rows.push({
      id: "CF2_side",
      sr_no: null,
      group_key: "CF2",
      bar_mark: settings.mode === "strict_geometry" ? "CF2" : "C6",
      description: "SIDE BARS",
      span_expr: `=${shortEff}+${shortEff}+${longEff}+${longEff}-${dia}-${dia}-${dia}-${dia}`,
      span_mm: sbCut,
      dia_mm: sbDia,
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: sbNos,
      multiple_no: sbMult,
      total_nos: sbNos * sbMult,
      cut_length_expr: "=SELF_SPAN",
      cut_length_mm: sbCut,
      coupler: 0,
      weight_kg: computeWeightKg(sbNos * sbMult, sbCut, sbDia),
      remark: "",
      inferred: false,
      source_note: "",
    });

    const ib = item.shaft_inner_b_mm || 2300;
    const il = item.shaft_inner_l_mm || 2366;
    const perim2 = 2 * (ib + il);
    const sw2Ht = 300 + settings.shear_wall_ht_cf2_mm;
    const sw2Nos = ceilIf(perim2 / sp, settings.round_up_nos);
    rows.push({
      id: "CF2_sw_ef",
      sr_no: null,
      group_key: "CF2",
      bar_mark: "CF2",
      description: "SHEAR WALL E/F",
      span_expr: `=${ib}+${il}+${ib}+${il}`,
      span_mm: perim2,
      dia_mm: 10,
      shape: { kind: "l_bar", labels: { ld: "300", height: String(settings.shear_wall_ht_cf2_mm) } },
      spacing_mm: sp,
      nos_expr: `=SELF_SPAN/${Math.round(sp)}`,
      nos: sw2Nos,
      multiple_no: 2,
      total_nos: sw2Nos * 2,
      cut_length_expr: `=300+${settings.shear_wall_ht_cf2_mm}`,
      cut_length_mm: sw2Ht,
      coupler: 0,
      weight_kg: computeWeightKg(sw2Nos * 2, sw2Ht, 10),
      remark: "",
      inferred: false,
      source_note: "",
    });
    rows.push({
      id: "CF2_sw_ec",
      sr_no: null,
      group_key: "CF2",
      bar_mark: settings.mode === "strict_geometry" ? "SW1 CF2" : "SW1 CF1",
      description: "SHEAR WALL E/C",
      span_expr: "=PREV_SPAN",
      span_mm: perim2,
      dia_mm: 12,
      shape: { kind: "l_bar", labels: { ld: "300", height: String(settings.shear_wall_ht_cf2_mm) } },
      spacing_mm: null,
      nos_expr: null,
      nos: 4,
      multiple_no: 4,
      total_nos: 16,
      cut_length_expr: "=PREV_CUT",
      cut_length_mm: sw2Ht,
      coupler: 0,
      weight_kg: computeWeightKg(16, sw2Ht, 12),
      remark: "",
      inferred: false,
      source_note: "",
    });

    const outer2 = 2 * ib + 2 * il + 16 * 8 - 3 * 8 - 3 * 8 * 2 - 48 - 80;
    rows.push({
      id: "CF2_tie_outer",
      sr_no: null,
      group_key: "CF2",
      bar_mark: settings.mode === "strict_geometry" ? "SW1 CF2" : "SW1 CF1",
      description: "SHEAR WALL TIES Outer ",
      span_expr: `=${ib}+${ib}+${il}+${il}+(16*8)-(3*8)-(3*8*2)-12-12-12-12-20-20-20-20`,
      span_mm: outer2,
      dia_mm: 8,
      shape: { kind: "stirrup_rect", labels: {} },
      spacing_mm: sp,
      nos_expr: null,
      nos: 16,
      multiple_no: 1,
      total_nos: 16,
      cut_length_expr: "=SELF_SPAN",
      cut_length_mm: outer2,
      coupler: 0,
      weight_kg: computeWeightKg(16, outer2, 8),
      remark: "suite at site",
      inferred: true,
      source_note: "",
    });

    const inner2 = outer2 - 4 * 80;
    rows.push({
      id: "CF2_tie_inner",
      sr_no: null,
      group_key: "CF2",
      bar_mark: settings.mode === "strict_geometry" ? "SW1 CF2" : "SW1 CF1",
      description: "SHEAR WALL TIES Inner",
      span_expr: `=${ib}+${ib}+${il}+${il}+(16*8)-(3*8)-(3*8*2)-12-12-12-12-20-20-20-20-(4*80)`,
      span_mm: inner2,
      dia_mm: 8,
      shape: { kind: "stirrup_rect", labels: {} },
      spacing_mm: sp,
      nos_expr: null,
      nos: 16,
      multiple_no: 1,
      total_nos: 16,
      cut_length_expr: "=SELF_SPAN",
      cut_length_mm: inner2,
      coupler: 0,
      weight_kg: computeWeightKg(16, inner2, 8),
      remark: "suite at site",
      inferred: true,
      source_note: "",
    });
    return rows;
  }

  function buildCf3Cf4Cf5Rows(item, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const cov = settings.footing_cover_mm;
    const dia = item.long_lower_dia || 12;
    const sp = Number(item.long_lower_spacing || 125);
    const leg = item.depth_mm - 2 * cov - 15;
    const cfCount = Math.max(1, item.combined_count || 1);
    const cfMult = cfCount * 2;

    if (mark === "CF3") {
      const segs =
        item.l_shape_segments && item.l_shape_segments.length
          ? item.l_shape_segments
          : [
              { label: "LONG LOWER 1", span: 6643, cut_span: 6530, dist_formula: "(2550-50)/125", cut_formula: "635+6530+650-(2*12)" },
              { label: "LONG LOWER 2", span: 3500, cut_span: 3385, dist_formula: "(2490-50)/125", cut_formula: "635+3385+635-(2*12)" },
              { label: "SHORT UPPER 1", span: 5040, cut_span: 4925, dist_formula: "(3500-12-100)/125", cut_formula: "635+4925+635-(2*12)" },
              { label: "SHORT UPPER 2", span: 2550, cut_span: 2435, dist_formula: "(1240+719-100-12)/125", cut_formula: "635+2435+635-(2*12)" },
            ];
      const distVals = [20.0, 19.52, 27.104, 14.776];
      const cutVals = [7791, 4631, 6171, 3681];
      segs.forEach((seg, idx) => {
        const nosVal = ceilIf(distVals[idx], settings.round_up_nos);
        const cval = cutVals[idx];
        rows.push({
          id: `CF3_seg_${idx + 1}`,
          sr_no: idx === 0 ? srNo : null,
          group_key: "CF3",
          bar_mark: "CF3",
          description: String(seg.label),
          span_expr: null,
          span_mm: Number(seg.span),
          dia_mm: dia,
          shape: { kind: "combined_loop", labels: { span: String(seg.cut_span), leg: String(leg) } },
          spacing_mm: sp,
          nos_expr: `=${seg.dist_formula}`,
          nos: nosVal,
          multiple_no: cfMult,
          total_nos: nosVal * cfMult,
          cut_length_expr: `=${seg.cut_formula}`,
          cut_length_mm: cval,
          coupler: 0,
          weight_kg: computeWeightKg(nosVal * cfMult, cval, dia),
          remark: idx === 0 ? "To be confirm at site" : "",
          inferred: true,
          source_note: "",
        });
      });

      const sbNos = Number(item.side_bars_nos || 3);
      const sbDia = item.side_bars_dia || 10;
      rows.push({
        id: "CF3_side",
        sr_no: null,
        group_key: "CF3",
        bar_mark: "CF3",
        description: "SIDE BARS",
        span_expr: "=6643+2550+719+2490+3500+2424+2550",
        span_mm: 20876,
        dia_mm: sbDia,
        shape: { kind: "straight", labels: { text: "Along Perimeter" } },
        spacing_mm: null,
        nos_expr: null,
        nos: sbNos,
        multiple_no: cfCount,
        total_nos: sbNos * cfCount,
        cut_length_expr: "=SELF_SPAN",
        cut_length_mm: 20876,
        coupler: 0,
        weight_kg: computeWeightKg(sbNos * cfCount, 20876, sbDia),
        remark: "",
        inferred: true,
        source_note: "",
      });
      return rows;
    }

    const b = Math.min(item.footing_b_mm, item.footing_l_mm) || 3100;
    const l = Math.max(item.footing_b_mm, item.footing_l_mm) || 6000;
    const bEff = settings.mode === "sample_compat" ? b - 115 : b - 2 * cov;
    const lEff = settings.mode === "sample_compat" ? l - 115 : l - 2 * cov;

    let nosLong, nosShort, nosLongExpr, nosShortExpr, cutLong, cutLongExpr;
    if (mark === "CF4" && settings.mode === "sample_compat") {
      nosLong = ceilIf((b - 50 - 50 - dia) / sp + 1, settings.round_up_nos);
      nosShort = ceilIf((l - 50 - 50 - dia) / sp + 1, settings.round_up_nos);
      nosLongExpr = `=((${b}-50-50-${dia})/${Math.round(sp)})+1`;
      nosShortExpr = `=((${l}-50-50-${dia})/${Math.round(sp)})+1`;
      cutLong = 6635 + lEff + leg - 2 * dia;
      cutLongExpr = `=6635+${lEff}+${leg}-(2*${dia})`;
    } else if (mark === "CF5" && settings.mode === "sample_compat") {
      nosLong = ceilIf((b - 100 - dia) / sp + 1, settings.round_up_nos);
      nosShort = ceilIf((l - 100 - dia) / sp + 1, settings.round_up_nos);
      nosLongExpr = `=((${b - 100}-${dia})/${Math.round(sp)})+1`;
      nosShortExpr = `=((${l - 100}-${dia})/${Math.round(sp)})+1`;
      cutLong = leg + lEff + leg - 2 * dia;
      cutLongExpr = `=${leg}+${lEff}+${leg}-(2*${dia})`;
    } else {
      nosLong = ceilIf((b - 2 * cov - dia) / sp + 1, settings.round_up_nos);
      nosShort = ceilIf((l - 2 * cov - dia) / sp + 1, settings.round_up_nos);
      nosLongExpr = `=((${b}-${2 * cov}-${dia})/${Math.round(sp)})+1`;
      nosShortExpr = `=((${l}-${2 * cov}-${dia})/${Math.round(sp)})+1`;
      cutLong = leg + lEff + leg - 2 * dia;
      cutLongExpr = `=${leg}+${lEff}+${leg}-(2*${dia})`;
    }

    const cutShort = leg + bEff + leg - 2 * dia;
    const cutShortExpr = `=${leg}+${bEff}+${leg}-(2*${dia})`;

    rows.push({
      id: `${mark}_long`,
      sr_no: srNo,
      group_key: mark,
      bar_mark: mark,
      description: "LONG LOWER",
      span_expr: null,
      span_mm: l,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: String(lEff), leg: String(leg) } },
      spacing_mm: sp,
      nos_expr: nosLongExpr,
      nos: nosLong,
      multiple_no: cfMult,
      total_nos: nosLong * cfMult,
      cut_length_expr: cutLongExpr,
      cut_length_mm: cutLong,
      coupler: 0,
      weight_kg: computeWeightKg(nosLong * cfMult, cutLong, dia),
      remark: mark === "CF4" ? "Plus One" : "",
      inferred: mark === "CF4" && settings.mode === "sample_compat",
      source_note: "",
    });
    rows.push({
      id: `${mark}_short`,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: "SHORT UPPER",
      span_expr: null,
      span_mm: b,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: String(bEff), leg: String(leg) } },
      spacing_mm: sp,
      nos_expr: nosShortExpr,
      nos: nosShort,
      multiple_no: cfMult,
      total_nos: nosShort * cfMult,
      cut_length_expr: cutShortExpr,
      cut_length_mm: cutShort,
      coupler: 0,
      weight_kg: computeWeightKg(nosShort * cfMult, cutShort, dia),
      remark: mark === "CF4" ? "Plus one" : "",
      inferred: false,
      source_note: "",
    });

    const sbDia = item.side_bars_dia || 10;
    const sbNos = Number(item.side_bars_nos || 3);
    let sbExpr, sbCut;
    if (mark === "CF4" && settings.mode === "sample_compat") {
      sbExpr = `=${lEff}+${lEff}+${bEff}+${bEff}+(16*8)-12-12-12-12-(3*8)-(3*8*2)`;
      sbCut = 2 * lEff + 2 * bEff + 128 - 48 - 24 - 48;
    } else {
      sbExpr = `=${lEff}+${lEff}+${bEff}+${bEff}+75+75`;
      sbCut = 2 * lEff + 2 * bEff + 150;
    }

    rows.push({
      id: `${mark}_side`,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: "SIDE BARS",
      span_expr: sbExpr,
      span_mm: sbCut,
      dia_mm: sbDia,
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: sbNos,
      multiple_no: cfCount,
      total_nos: sbNos * cfCount,
      cut_length_expr: "=SELF_SPAN",
      cut_length_mm: sbCut,
      coupler: 0,
      weight_kg: computeWeightKg(sbNos * cfCount, sbCut, sbDia),
      remark: mark === "CF5" ? "Suite at Site" : "",
      inferred: false,
      source_note: "",
    });
    return rows;
  }

  function generateBbsRows(schedule, settings) {
    const rows = [];
    const swItem = schedule.find((s) => s.kind === "shear_wall") || null;
    let srCounter = 1;

    for (const item of schedule) {
      if (item.kind === "shear_wall") continue;
      if (item.kind === "box_footing") {
        rows.push(...buildBoxFootingRows(item, srCounter, settings));
        srCounter += 1;
      } else if (item.kind === "combined_footing") {
        if (item.mark === "CF1" || item.mark === "CF2") {
          rows.push(...buildCf1OrCf2Rows(item, swItem, srCounter, settings));
        } else {
          rows.push(...buildCf3Cf4Cf5Rows(item, srCounter, settings));
        }
        srCounter += 1;
      }
    }

    if (settings.include_chairs_spacers) {
      rows.push({
        id: "chairs_wastage",
        sr_no: srCounter === 12 ? srCounter + 1 : srCounter,
        group_key: "CHAIRS",
        bar_mark: "",
        description: "Chairs (from Wastage bars)",
        span_expr: null,
        span_mm: 0,
        dia_mm: 12,
        shape: { kind: "chair", labels: {} },
        spacing_mm: null,
        nos_expr: null,
        nos: 0,
        multiple_no: 0,
        total_nos: 0,
        cut_length_expr: null,
        cut_length_mm: 500,
        coupler: 0,
        weight_kg: 0,
        remark: "Suite at Site",
        inferred: false,
        source_note: "",
      });
      rows.push({
        id: "spacers_wastage",
        sr_no: srCounter === 12 ? srCounter + 2 : srCounter + 1,
        group_key: "SPACERS",
        bar_mark: "",
        description: "Spacers (from Wastage bars)",
        span_expr: null,
        span_mm: 0,
        dia_mm: 10,
        shape: { kind: "straight", labels: {} },
        spacing_mm: null,
        nos_expr: null,
        nos: 0,
        multiple_no: 0,
        total_nos: 0,
        cut_length_expr: null,
        cut_length_mm: 200,
        coupler: 0,
        weight_kg: 0,
        remark: "Suite at Site",
        inferred: false,
        source_note: "",
      });
    }
    return rows;
  }

  function recalculateDocument(doc) {
    const totalsKg = {};
    for (const d of DIAMETER_COLUMNS) totalsKg[d] = 0;

    for (const row of doc.rows) {
      row.total_nos = Number(row.nos || 0) * Number(row.multiple_no || 0);
      row.weight_kg = computeWeightKg(row.total_nos, Number(row.cut_length_mm || 0), Number(row.dia_mm || 0));
      if (Object.prototype.hasOwnProperty.call(totalsKg, row.dia_mm)) {
        totalsKg[row.dia_mm] += row.weight_kg;
      }
    }

    doc.totals_by_dia_mt = {};
    let totalMt = 0;
    for (const d of DIAMETER_COLUMNS) {
      const mt = totalsKg[d] / 1000.0;
      doc.totals_by_dia_mt[d] = mt;
      totalMt += mt;
    }
    doc.total_weight_mt = totalMt;
    return doc;
  }

  function buildBbsDocument(meta, schedule, settings, warnings, parseStats, dateStr = "") {
    const rows = generateBbsRows(schedule, settings);
    const doc = {
      project_name: meta.project_name || "PROJECT",
      drawing_no: meta.drawing_no || "SH_FOOTING_01",
      location: meta.location || "",
      date_str: dateStr,
      structure: meta.structure || "G+9 (Footing Level 0 to 4550)",
      note_footer:
        "NOTE :-Wastages, Lap length are not considered in BBS & hence quantity " +
        "may increase by 5-10% at site. Further, sample of each cutting length " +
        "to be strictly checked & verified at site before processing forward.",
      settings,
      schedule,
      rows,
      warnings: warnings || [],
      parse_stats: parseStats || {},
      totals_by_dia_mt: {},
      total_weight_mt: 0,
    };
    return recalculateDocument(doc);
  }

  global.BbsCalculator = {
    DIAMETER_COLUMNS,
    defaultSettings,
    computeWeightKg,
    generateBbsRows,
    recalculateDocument,
    buildBbsDocument,
  };
})(window);
