/**
 * Client-side Bar Bending Schedule (BBS) formula engine & calculator.
 * Mirrors app/formula_engine.py and app/bbs_calculator.py for 100% browser-local execution
 * with strict zero-rounding unrounded precision.
 */
(function (global) {
  "use strict";

  const DIAMETER_COLUMNS = [8, 10, 12, 16, 20, 25, 32, 36, 40];

  const GLOBAL_CONST_CELLS = {
    "$S$2": ["footing_cover_mm", "Footing Cover"],
    "$U$2": ["column_cover_mm", "Col Cover"],
    "$W$2": ["column_height_mm", "Col Height"],
    "$Y$2": ["ld_vertical_mm", "Vert. Ld"],
    "$P$3": ["sw_dowel_mm", "SW Dowel"],
    "$S$3": ["hook_mult", "Hook Mult"],
    "$U$3": ["hook_min_mm", "Min Hook"],
    "$W$3": ["unit_wt_divisor", "Unit Wt Div"],
    "$Y$3": ["scale_divisor", "Kg/MT Scale"],
    "$O$4": ["sw_inner_offset_mm", "SW Inner Off"],
    "$S$4": ["shear_wall_ht_cf1_mm", "CF1 SW Ht"],
    "$U$4": ["shear_wall_ht_cf2_mm", "CF2 SW Ht"],
    "$W$4": ["tie_step_div_ge16", "Tie Div (>=16)"],
    "$Y$4": ["tie_step_div_lt16", "Tie Div (<16)"],
  };

  const ROW_COL_ATTR = {
    D: "span_mm",
    E: "dia_mm",
    J: "spacing_mm",
    K: "nos",
    L: "multiple_no",
    M: "total_nos",
    N: "cut_length_mm",
    Z: "param_z",
    AA: "param_aa",
    AB: "param_ab",
    AC: "param_ac",
    AD: "param_ad",
  };

  function defaultSettings(overrides = {}) {
    const merged = Object.assign(
      {
        mode: "strict_geometry",
        round_up_nos: false,
        footing_cover_mm: 50,
        column_cover_mm: 40,
        column_height_mm: 4550,
        ld_vertical_mm: 450,
        hook_mult: 8,
        hook_min_mm: 75,
        unit_wt_divisor: 162,
        scale_divisor: 1000,
        shear_wall_ht_cf1_mm: 1650,
        shear_wall_ht_cf2_mm: 3000,
        sw_dowel_mm: 300,
        sw_inner_offset_mm: 80,
        tie_step_div_ge16: 6,
        tie_step_div_lt16: 5,
        include_chairs_spacers: true,
      },
      overrides
    );
    merged.mode = "strict_geometry";
    return merged;
  }

  function formatExact(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) return "0";
    if (Math.abs(n - Math.round(n)) < 1e-11) return String(Math.round(n));
    const s = Number(n.toPrecision(12)).toString();
    return s === "-0" ? "0" : s;
  }

  function formatCalcArg(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) return "0";
    if (Math.abs(n - Math.round(n)) < 1e-12) return String(Math.round(n));
    return String(n);
  }

  function ceilClean(val) {
    const nearest = Math.round(val);
    if (Math.abs(val - nearest) < 1e-11) return nearest;
    return Math.ceil(val);
  }

  function computeWeightKg(totalNos, cutLengthMm, diaMm, unitWtDivisor = 162, scaleDivisor = 1000) {
    if (totalNos <= 0 || cutLengthMm <= 0 || diaMm <= 0 || unitWtDivisor <= 0 || scaleDivisor <= 0) return 0;
    return Number(totalNos) * (Number(cutLengthMm) / Number(scaleDivisor)) * ((Number(diaMm) * Number(diaMm)) / Number(unitWtDivisor));
  }

  function wrapRoundup(innerExpr, roundUp) {
    const body = String(innerExpr).replace(/^=+/, "");
    return roundUp ? `=ROUNDUP(${body},0)` : `=${body}`;
  }

  function syncRoundupExpr(expr, roundUp) {
    if (!expr || !String(expr).startsWith("=")) return expr;
    const body = String(expr).slice(1).trim();
    if (body.startsWith("@ID:") || /^[A-Z]+\d+$/.test(body)) return expr;
    const m = /^ROUNDUP\((.*),0\)$/i.exec(body);
    if (m && !roundUp) return `=${m[1]}`;
    if (!m && roundUp && body.includes("/")) return `=ROUNDUP(${body},0)`;
    return expr;
  }

  function evalArithmetic(expr) {
    let s = String(expr || "").trim();
    if (s.startsWith("=")) s = s.slice(1);
    if (s.startsWith("+")) s = s.slice(1);

    const tokens = [];
    const tokenRe = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/(),]))/y;
    let pos = 0;
    while (pos < s.length) {
      if (/\s/.test(s[pos])) { pos++; continue; }
      tokenRe.lastIndex = pos;
      const m = tokenRe.exec(s);
      if (!m) throw new Error(`Unsupported token in expression: ${expr}`);
      if (m[1] !== undefined) tokens.push(["NUM", m[1]]);
      else if (m[2] !== undefined) tokens.push(["IDENT", m[2].toUpperCase()]);
      else tokens.push(["OP", m[3]]);
      pos = tokenRe.lastIndex;
    }

    let idx = 0;
    const peek = () => (idx < tokens.length ? tokens[idx] : null);
    const consume = () => tokens[idx++];

    function parseExpr() {
      let val = parseTerm();
      let tok;
      while ((tok = peek()) && tok[0] === "OP" && (tok[1] === "+" || tok[1] === "-")) {
        const op = consume()[1];
        const rhs = parseTerm();
        val = op === "+" ? val + rhs : val - rhs;
      }
      return val;
    }

    function parseTerm() {
      let val = parseFactor();
      let tok;
      while ((tok = peek()) && tok[0] === "OP" && (tok[1] === "*" || tok[1] === "/")) {
        const op = consume()[1];
        const rhs = parseFactor();
        if (op === "/") {
          if (rhs === 0) throw new Error("Division by zero");
          val /= rhs;
        } else {
          val *= rhs;
        }
      }
      return val;
    }

    function parseFactor() {
      const tok = peek();
      if (!tok) throw new Error("Unexpected end of expression");
      if (tok[0] === "OP" && tok[1] === "+") { consume(); return parseFactor(); }
      if (tok[0] === "OP" && tok[1] === "-") { consume(); return -parseFactor(); }
      if (tok[0] === "OP" && tok[1] === "(") {
        consume();
        const val = parseExpr();
        const end = peek();
        if (!end || end[0] !== "OP" || end[1] !== ")") throw new Error("Unmatched '('");
        consume();
        return val;
      }
      if (tok[0] === "NUM") { consume(); return Number(tok[1]); }
      if (tok[0] === "IDENT") {
        const fn = consume()[1];
        const lp = peek();
        if (!lp || lp[0] !== "OP" || lp[1] !== "(") throw new Error(`Unexpected ident ${fn}`);
        consume();
        const args = [];
        const np = peek();
        if (!(np && np[0] === "OP" && np[1] === ")")) {
          args.push(parseExpr());
          while (peek() && peek()[0] === "OP" && peek()[1] === ",") {
            consume();
            args.push(parseExpr());
          }
        }
        const rp = peek();
        if (!rp || rp[0] !== "OP" || rp[1] !== ")") throw new Error("Expected ')'");
        consume();
        if (fn === "MAX") return Math.max(...args);
        if (fn === "MIN") return Math.min(...args);
        if (fn === "ROUNDUP") {
          if (!args.length) return 0;
          const digits = args.length > 1 ? Math.trunc(args[1]) : 0;
          if (digits === 0) return ceilClean(args[0]);
          const f = Math.pow(10, digits);
          return ceilClean(args[0] * f) / f;
        }
        throw new Error(`Unsupported function ${fn}`);
      }
      throw new Error(`Unexpected token ${tok}`);
    }

    const out = parseExpr();
    if (idx !== tokens.length) throw new Error(`Trailing tokens in ${expr}`);
    return out;
  }

  function resolveRowFormula(expr, rowIdx, rows, settings, firstTieExcelRow = null, excelStartRow = 8) {
    if (!expr || !String(expr).startsWith("=")) return null;

    const curExcel = excelStartRow + rowIdx;
    const idToIdx = {};
    rows.forEach((r, i) => { if (r && r.id) idToIdx[r.id] = i; });
    let missingDep = false;

    let normalized = String(expr)
      .replace(/SELF_SPAN/g, "@SELF:D")
      .replace(/PREV_SPAN/g, "@PREV:D")
      .replace(/PREV_CUT/g, "@PREV:N")
      .replace(/PREV_TIE/g, "@PREV:D");

    if (normalized.includes("FIRST_TIE_NOS")) {
      const ftRow = firstTieExcelRow !== null && firstTieExcelRow !== undefined ? firstTieExcelRow : curExcel - 1;
      const ftIdx = ftRow - excelStartRow;
      if (ftIdx >= 0 && ftIdx < rows.length) {
        normalized = normalized.replace(/FIRST_TIE_NOS/g, `@ID:${rows[ftIdx].id}:K`);
      } else {
        missingDep = true;
      }
    }
    if (missingDep) return null;

    const symRe = /@(SELF|PREV):([A-Z]{1,2})|@ID:([A-Za-z0-9_]+):([A-Z]{1,2})|(\$[A-Z]+\$\d+)/g;

    const excelFormula = normalized.replace(symRe, (m, rel, col, refId, idCol, gconst) => {
      if (gconst) return gconst;
      if (rel === "SELF") return `${col}${curExcel}`;
      if (rel === "PREV") {
        if (curExcel - 1 < excelStartRow) { missingDep = true; return "0"; }
        return `${col}${curExcel - 1}`;
      }
      if (refId !== undefined) {
        if (!(refId in idToIdx)) { missingDep = true; return "0"; }
        return `${idCol}${excelStartRow + idToIdx[refId]}`;
      }
      return m;
    });
    if (missingDep) return null;

    const subWith = (fmtFn) =>
      normalized.replace(symRe, (m, rel, col, refId, idCol, gconst) => {
        if (gconst) {
          const meta = GLOBAL_CONST_CELLS[gconst];
          if (!meta) { missingDep = true; return "0"; }
          return fmtFn(Number(settings[meta[0]]));
        }
        const getAttr = (r, c) => {
          const attr = ROW_COL_ATTR[c];
          if (!attr || !r) return 0;
          const v = r[attr];
          return v === null || v === undefined ? 0 : Number(v);
        };
        if (rel === "SELF") return fmtFn(getAttr(rows[rowIdx], col));
        if (rel === "PREV") {
          if (rowIdx - 1 < 0) { missingDep = true; return "0"; }
          return fmtFn(getAttr(rows[rowIdx - 1], col));
        }
        if (refId !== undefined) {
          if (!(refId in idToIdx)) { missingDep = true; return "0"; }
          return fmtFn(getAttr(rows[idToIdx[refId]], idCol));
        }
        return m;
      });

    const evalExpr = subWith(formatCalcArg);
    const displayExpr = subWith(formatExact).replace(/^=+/, "");
    if (missingDep) return null;

    try {
      const value = evalArithmetic(evalExpr);
      return { excelFormula, displayExpr, value };
    } catch (_) {
      return { excelFormula, displayExpr, value: null };
    }
  }

  function buildBoxFootingRows(item, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const llDia = Number(item.long_lower_dia || 12);
    const suDia = Number(item.short_upper_dia || 12);
    const sbDia = Number(item.side_bars_dia || 10);
    const vDia = Number(item.vert_dia || 16);
    const tDia = Number(item.ties_dia || 8);
    const tSp = Number(item.ties_spacing || 150);

    const boxMult = Number(item.box_count || 0);
    const colMult = Number(item.total_col_count || item.box_count || 0);
    const depth = Number(item.depth_mm);
    const cov = Number(settings.footing_cover_mm);
    const ccov = Number(settings.column_cover_mm);
    const dEff = Math.max(100, depth - 2 * cov);
    const lEff = Math.max(100, Number(item.footing_l_mm) - 2 * cov);
    const bEff = Math.max(100, Number(item.footing_b_mm) - 2 * cov);

    const llId = `${mark}_long_lower`;
    const suId = `${mark}_short_upper`;

    rows.push({
      id: llId,
      sr_no: srNo,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "LONG LOWER",
      span_expr: null,
      span_mm: Number(item.footing_l_mm),
      dia_mm: llDia,
      shape: { kind: "u_bar", labels: { span: formatExact(lEff), leg: formatExact(dEff) } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.long_lower_nos || 0),
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: boxMult,
      total_nos: 0,
      cut_length_expr: "=(@SELF:Z-2*$S$2)+(@SELF:D-2*$S$2)+(@SELF:Z-2*$S$2)-(2*@SELF:E)",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: null,
      param_ab: null,
      param_ac: boxMult,
      param_ad: 1,
      param_ae: "Z=Depth(mm); AC=BoxQty; AD=Layers",
      remark: "",
      inferred: false,
      source_note: "",
    });

    rows.push({
      id: suId,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "SHORT UPPER",
      span_expr: null,
      span_mm: Number(item.footing_b_mm),
      dia_mm: suDia,
      shape: { kind: "u_bar", labels: { span: formatExact(bEff), leg: formatExact(dEff) } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.short_upper_nos || 0),
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: boxMult,
      total_nos: 0,
      cut_length_expr: "=(@SELF:Z-2*$S$2)+(@SELF:D-2*$S$2)+(@SELF:Z-2*$S$2)-(2*@SELF:E)",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: null,
      param_ab: null,
      param_ac: boxMult,
      param_ad: 1,
      param_ae: "Z=Depth(mm); AC=BoxQty; AD=Layers",
      remark: "",
      inferred: false,
      source_note: "",
    });

    const hookPart = "+2*MAX($S$3*@SELF:E,$U$3)";

    rows.push({
      id: `${mark}_side_bars`,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Footing`,
      description: "SIDE BARS",
      span_expr: `=2*(@ID:${llId}:D-2*$S$2)+2*(@ID:${suId}:D-2*$S$2)${hookPart}-(4*@ID:${llId}:E)+@SELF:AB`,
      span_mm: 0,
      dia_mm: sbDia,
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.side_bars_nos || 0),
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: boxMult,
      total_nos: 0,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: null,
      param_aa: null,
      param_ab: 0,
      param_ac: boxMult,
      param_ad: 1,
      param_ae: "AB=ManualAdj(mm); AC=BoxQty; AD=Layers",
      remark: "",
      inferred: false,
      source_note: "",
    });

    const hCol = Number(settings.column_height_mm);
    const ld = Number(settings.ld_vertical_mm);
    rows.push({
      id: `${mark}_col_vert`,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Col. Vertical`,
      description: `COLUMN(upto ${(hCol / 1000).toFixed(3)} m)`,
      span_expr: "=$Y$2+$W$2",
      span_mm: ld + hCol,
      dia_mm: vDia,
      shape: { kind: "l_bar", labels: { ld: formatExact(ld), height: formatExact(hCol) } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.vert_nos || 0),
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: colMult,
      total_nos: 0,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: null,
      param_aa: null,
      param_ab: null,
      param_ac: colMult,
      param_ad: 1,
      param_ae: "Span=$Y$2(Ld)+$W$2(ColHt); AC=ColQty; AD=Layers",
      remark: mark === "C1" ? `Ld=${formatExact(ld)}` : "",
      inferred: false,
      source_note: "",
    });

    const cw = Math.max(100, Number(item.col_b_mm) - 2 * ccov);
    const ch = Math.max(100, Number(item.col_l_mm) - 2 * ccov);
    const hk = Math.max(Number(settings.hook_mult) * tDia, Number(settings.hook_min_mm));
    const outerTieId = `${mark}_tie_outer`;
    const outerSpanExpr = "=2*(@SELF:Z-2*$U$2)+2*(@SELF:AA-2*$U$2)+2*MAX($S$3*@SELF:E,$U$3)-(3*2*@SELF:E)-(3*@SELF:E)";

    rows.push({
      id: outerTieId,
      sr_no: null,
      group_key: mark,
      bar_mark: `${mark} Col. Stirrups`,
      description: "COL.TIES(OUTER)",
      span_expr: outerSpanExpr,
      span_mm: 0,
      dia_mm: tDia,
      shape: { kind: "stirrup_rect", labels: { a: formatExact(ch), b: formatExact(cw), hook: formatExact(hk) } },
      spacing_mm: tSp,
      nos_expr: wrapRoundup("$W$2/@SELF:J", settings.round_up_nos),
      nos: 0,
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: colMult,
      total_nos: 0,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: Number(item.col_b_mm),
      param_aa: Number(item.col_l_mm),
      param_ab: null,
      param_ac: colMult,
      param_ad: 1,
      param_ae: "Z=ColB(mm); AA=ColL(mm); Nos uses $W$2(ColHt)/J; AC=ColQty",
      remark: "",
      inferred: false,
      source_note: "",
    });

    const divRef = item.vert_nos >= 16 ? "$W$4" : "$Y$4";
    const divVal = item.vert_nos >= 16 ? Number(settings.tie_step_div_ge16) : Number(settings.tie_step_div_lt16);
    const step = ch / divVal; // strictly unrounded
    let curCh = ch;
    for (const lname of ["MIDDLE", "INNER"]) {
      curCh -= 2 * step;
      rows.push({
        id: `${mark}_tie_${lname.toLowerCase()}`,
        sr_no: null,
        group_key: mark,
        bar_mark: `${mark} Col. Stirrups`,
        description: `COL.TIES(${lname})`,
        span_expr: `=@PREV:D-2*((@ID:${outerTieId}:AA-2*$U$2)/${divRef})`,
        span_mm: 0,
        dia_mm: tDia,
        shape: { kind: "stirrup_rect", labels: { a: formatExact(curCh), b: formatExact(cw), hook: formatExact(hk) } },
        spacing_mm: tSp,
        nos_expr: `=@ID:${outerTieId}:K`,
        nos: 0,
        multiple_expr: `=@ID:${outerTieId}:L`,
        multiple_no: colMult,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: null,
        param_ac: null,
        param_ad: null,
        param_ae: `Step=2*(ColL_eff/${divRef} unrounded)`,
        remark: "",
        inferred: false,
        source_note: "",
      });
    }

    if (item.vert_nos >= 16) {
      rows.push({
        id: `${mark}_tie_center`,
        sr_no: null,
        group_key: mark,
        bar_mark: `${mark} Col. Stirrups`,
        description: "COL.TIES(CENTER)",
        span_expr: `=(@ID:${outerTieId}:Z-2*$U$2)+2*MAX($S$3*@SELF:E,$U$3)-(3*@SELF:E*2)`,
        span_mm: 0,
        dia_mm: tDia,
        shape: { kind: "center_link", labels: { a: formatExact(cw), hook: formatExact(hk) } },
        spacing_mm: tSp,
        nos_expr: `=@ID:${outerTieId}:K`,
        nos: 0,
        multiple_expr: `=@ID:${outerTieId}:L`,
        multiple_no: colMult,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: null,
        param_ac: null,
        param_ad: null,
        param_ae: "Link uses OuterTie Z(ColB)-2*$U$2",
        remark: "",
        inferred: false,
        source_note: "",
      });
    }

    return rows;
  }

  function buildCf1OrCf2Rows(item, swItem, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const cov = Number(settings.footing_cover_mm);
    const ccov = Number(settings.column_cover_mm);
    const sp = Number(item.long_lower_spacing || 150);
    const dia = Number(item.long_lower_dia || 12);
    const cfCount = Math.max(1, Number(item.combined_count || 1));
    const depth = Number(item.depth_mm);

    const bDim = Number(item.footing_b_mm || 0);
    const lDim = Number(item.footing_l_mm || 0);
    const longSpan = Math.max(bDim, lDim);
    const shortSpan = Math.min(bDim, lDim);
    const leg = Math.max(100, depth - 2 * cov);
    const longEff = Math.max(100, longSpan - 2 * cov);
    const shortEff = Math.max(100, shortSpan - 2 * cov);
    const nosExpr = wrapRoundup("((@SELF:AA-2*$S$2-@SELF:E)/@SELF:J)+1", settings.round_up_nos);
    const cutExpr = "=2*(@SELF:Z-2*$S$2-@SELF:AB)+(@SELF:D-2*$S$2-@SELF:AB)-(2*@SELF:E)";

    const cfLongId = `${mark}_long`;
    const cfShortId = `${mark}_short`;
    rows.push({
      id: cfLongId,
      sr_no: srNo,
      group_key: mark,
      bar_mark: mark,
      description: `${mark} SHAFT (LONG LOWER)`,
      span_expr: null,
      span_mm: longSpan,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: formatExact(longEff), leg: formatExact(leg) } },
      spacing_mm: sp,
      nos_expr: nosExpr,
      nos: 0,
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: cfCount * 2,
      total_nos: 0,
      cut_length_expr: cutExpr,
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: shortSpan,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: 2,
      param_ae: "Z=Depth; AA=PerpSpan; AB=ManualOff(mm); AC=Qty; AD=Layers(2)",
      remark: "",
      inferred: false,
      source_note: "",
    });
    rows.push({
      id: cfShortId,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: `${mark} SHAFT (SHORT UPPER)`,
      span_expr: null,
      span_mm: shortSpan,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: formatExact(shortEff), leg: formatExact(leg) } },
      spacing_mm: sp,
      nos_expr: nosExpr,
      nos: 0,
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: cfCount * 2,
      total_nos: 0,
      cut_length_expr: cutExpr,
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: longSpan,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: 2,
      param_ae: "Z=Depth; AA=PerpSpan; AB=ManualOff(mm); AC=Qty; AD=Layers(2)",
      remark: "",
      inferred: false,
      source_note: "",
    });
    rows.push({
      id: `${mark}_side`,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: "SIDE BARS",
      span_expr: `=2*(@ID:${cfLongId}:D-2*$S$2)+2*(@ID:${cfShortId}:D-2*$S$2)+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:${cfLongId}:E)+@SELF:AB`,
      span_mm: 0,
      dia_mm: Number(item.side_bars_dia || 10),
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.side_bars_nos || 2),
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: cfCount,
      total_nos: 0,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: null,
      param_aa: null,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: 1,
      param_ae: "Perimeter linked to LONG/SHORT spans + Hook($S$3/$U$3); AC=Qty; AD=Layers",
      remark: "",
      inferred: false,
      source_note: "",
    });

    if (item.shaft_inner_b_mm && item.shaft_inner_l_mm) {
      const ib = Number(item.shaft_inner_b_mm);
      const il = Number(item.shaft_inner_l_mm);
      const htRef = mark === "CF1" ? "$S$4" : "$U$4";
      const htVal = mark === "CF1" ? Number(settings.shear_wall_ht_cf1_mm) : Number(settings.shear_wall_ht_cf2_mm);
      const swCutEst =
        mark === "CF1"
          ? htVal - ccov + depth - cov - dia - dia + Number(settings.sw_dowel_mm)
          : htVal + Number(settings.sw_dowel_mm);
      const swCutExpr =
        mark === "CF1"
          ? `=${htRef}-$U$2+@ID:${cfLongId}:Z-$S$2-2*@ID:${cfLongId}:E+$P$3`
          : `=$P$3+${htRef}`;
      const swCutAe =
        mark === "CF1"
          ? `Z=ShaftB; AA=ShaftL; CutLen=${htRef}-$U$2+Z-$S$2-2*Dia+$P$3`
          : `Z=ShaftB; AA=ShaftL; CutLen=$P$3(Dowel)+${htRef}(SW_Ht)`;
      const swLabel = swItem && swItem.mark ? `${swItem.mark} ${mark}` : `SW ${mark}`;
      const swEfId = `${mark}_sw_ef`;
      const swEcId = `${mark}_sw_ec`;
      const swTieSp = Number((swItem && swItem.ties_spacing) || sp);

      rows.push({
        id: swEfId,
        sr_no: null,
        group_key: mark,
        bar_mark: swLabel,
        description: "SHEAR WALL E/F",
        span_expr: "=2*(@SELF:Z+@SELF:AA)",
        span_mm: 0,
        dia_mm: 10,
        shape: { kind: "l_bar", labels: { ld: formatExact(settings.sw_dowel_mm), height: formatExact(swCutEst - Number(settings.sw_dowel_mm)) } },
        spacing_mm: sp,
        nos_expr: wrapRoundup("@SELF:D/@SELF:J", settings.round_up_nos),
        nos: 0,
        multiple_expr: "=@SELF:AC*@SELF:AD",
        multiple_no: cfCount * 2,
        total_nos: 0,
        cut_length_expr: swCutExpr,
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: ib,
        param_aa: il,
        param_ab: null,
        param_ac: cfCount,
        param_ad: 2,
        param_ae: swCutAe,
        remark: `upto ${formatExact(htVal)} ht.`,
        inferred: false,
        source_note: "",
      });

      const ecNos = swItem && swItem.vert_nos ? Number(swItem.vert_nos) : 4;
      const ecDia = swItem && swItem.vert_dia ? Number(swItem.vert_dia) : 12;
      rows.push({
        id: swEcId,
        sr_no: null,
        group_key: mark,
        bar_mark: swLabel,
        description: "SHEAR WALL E/C",
        span_expr: `=@ID:${swEfId}:D`,
        span_mm: 0,
        dia_mm: ecDia,
        shape: { kind: "l_bar", labels: { ld: formatExact(settings.sw_dowel_mm), height: formatExact(swCutEst - Number(settings.sw_dowel_mm)) } },
        spacing_mm: null,
        nos_expr: null,
        nos: ecNos,
        multiple_expr: "=@SELF:AC*@SELF:AD",
        multiple_no: cfCount * 4,
        total_nos: 0,
        cut_length_expr: `=@ID:${swEfId}:N`,
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: null,
        param_ac: cfCount,
        param_ad: 4,
        param_ae: "Span & CutLen linked to SHEAR WALL E/F; AD=4 corners",
        remark: "",
        inferred: false,
        source_note: "",
      });

      const swTieDia = swItem && swItem.ties_dia ? Number(swItem.ties_dia) : 8;
      rows.push({
        id: `${mark}_tie_outer`,
        sr_no: null,
        group_key: mark,
        bar_mark: swLabel,
        description: "SHEAR WALL TIES Outer",
        span_expr: `=@ID:${swEfId}:D-(4*$U$2)+2*MAX($S$3*@SELF:E,$U$3)-(3*2*@SELF:E)-(3*@SELF:E)`,
        span_mm: 0,
        dia_mm: swTieDia,
        shape: { kind: "stirrup_rect", labels: {} },
        spacing_mm: swTieSp,
        nos_expr: wrapRoundup(`${htRef}/@SELF:J`, settings.round_up_nos),
        nos: 0,
        multiple_expr: "=@SELF:AC",
        multiple_no: cfCount,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: null,
        param_ac: cfCount,
        param_ad: null,
        param_ae: `Perimeter - 4*ColCover($U$2) + Hook($S$3/$U$3); Nos=${htRef}/J`,
        remark: "",
        inferred: true,
        source_note:
          `Not printed in the PDF Schedule Table. Horizontal ties for ${swLabel} ` +
          `are derived from the CAD Plan shaft box (${formatExact(ib)}x${formatExact(il)} mm, perimeter=2*(B+L)) ` +
          `and Shear Wall Height ${formatExact(htVal)} mm (${htRef}); stirrup size ${formatExact(swTieDia)}mm @ ${formatExact(swTieSp)} c/c. ` +
          `Confirm against actual design / site sizes before export.`,
      });
      rows.push({
        id: `${mark}_tie_inner`,
        sr_no: null,
        group_key: mark,
        bar_mark: swLabel,
        description: "SHEAR WALL TIES Inner",
        span_expr: "=@PREV:D-(4*$O$4)",
        span_mm: 0,
        dia_mm: swTieDia,
        shape: { kind: "stirrup_rect", labels: {} },
        spacing_mm: swTieSp,
        nos_expr: `=@ID:${mark}_tie_outer:K`,
        nos: 0,
        multiple_expr: "=@SELF:AC",
        multiple_no: cfCount,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: null,
        param_ac: cfCount,
        param_ad: null,
        param_ae: "OuterTie - 4*SWInnerOff($O$4)",
        remark: "",
        inferred: true,
        source_note:
          `Not printed in the PDF Schedule Table. Inner stirrup ring for ${swLabel} ` +
          `steps inward 4*SWInnerOff (${formatExact(settings.sw_inner_offset_mm)} mm in $O$4) from Outer Ties and matches Outer Nos. ` +
          `Confirm against actual design / site sizes before export.`,
      });
    }
    return rows;
  }

  function buildCf3Cf4Cf5Rows(item, srNo, settings) {
    const rows = [];
    const mark = item.mark;
    const cov = Number(settings.footing_cover_mm);
    const dia = Number(item.long_lower_dia || 12);
    const sp = Number(item.long_lower_spacing || 125);
    const depth = Number(item.depth_mm);
    const leg = Math.max(100, depth - 2 * cov);
    const cfCount = Math.max(1, Number(item.combined_count || 1));
    const cfMult = cfCount * 2;
    const cutLoopExpr = "=2*(@SELF:Z-2*$S$2-@SELF:AB)+(@SELF:D-2*$S$2-@SELF:AB)-(2*@SELF:E)";
    const nosInner = "((@SELF:AA-2*$S$2-@SELF:E)/@SELF:J)+1";

    if (item.l_shape_segments && item.l_shape_segments.length) {
      const segs = item.l_shape_segments;
      segs.forEach((seg, idx) => {
        const spanV = Number(seg.span);
        const distV = Number(seg.dist);
        const cutSpanV = Math.max(100, spanV - 2 * cov);

        rows.push({
          id: `${mark}_seg_${idx + 1}`,
          sr_no: idx === 0 ? srNo : null,
          group_key: mark,
          bar_mark: mark,
          description: String(seg.label),
          span_expr: null,
          span_mm: spanV,
          dia_mm: dia,
          shape: { kind: "combined_loop", labels: { span: formatExact(cutSpanV), leg: formatExact(leg) } },
          spacing_mm: sp,
          nos_expr: wrapRoundup(nosInner, settings.round_up_nos),
          nos: 0,
          multiple_expr: "=@SELF:AD*@SELF:AC",
          multiple_no: cfMult,
          total_nos: 0,
          cut_length_expr: cutLoopExpr,
          cut_length_mm: 0,
          coupler: 0,
          weight_kg: 0,
          param_z: depth,
          param_aa: distV,
          param_ab: 0,
          param_ac: cfCount,
          param_ad: 2,
          param_ae: "Z=Depth; AA=DistWidth; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
          remark: "",
          inferred: true,
          source_note:
            `Irregular polygon band dimensions for ${mark} (${seg.label}) are not tabulated in the PDF Schedule Table; ` +
            `span ${formatExact(spanV)} mm and distribution width ${formatExact(distV)} mm are measured from CAD Plan geometry ` +
            `(depth ${formatExact(depth)} mm, Dia/Spacing from Schedule, ${formatExact(cfCount)} No.). ` +
            `Confirm against actual design / site sizes before export.`,
        });
      });

      const seg1Id = `${mark}_seg_1`;
      const segOrthId = `${mark}_seg_${segs.length >= 3 ? 3 : Math.min(2, segs.length)}`;
      const sbDia = Number(item.side_bars_dia || 10);
      const sbNos = Number(item.side_bars_nos || 3);
      rows.push({
        id: `${mark}_side`,
        sr_no: null,
        group_key: mark,
        bar_mark: mark,
        description: "SIDE BARS",
        span_expr: `=2*(@ID:${seg1Id}:D-2*$S$2)+2*(@ID:${segOrthId}:D-2*$S$2)+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:${seg1Id}:E)+@SELF:AB`,
        span_mm: 0,
        dia_mm: sbDia,
        shape: { kind: "straight", labels: { text: "Along Perimeter" } },
        spacing_mm: null,
        nos_expr: null,
        nos: sbNos,
        multiple_expr: "=@SELF:AC",
        multiple_no: cfCount,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_z: null,
        param_aa: null,
        param_ab: 0,
        param_ac: cfCount,
        param_ad: null,
        param_ae: "Perimeter linked to outer orthogonal spans + Hook($S$3/$U$3); AC=CFQty",
        remark: "",
        inferred: true,
        source_note:
          `Single B x L box perimeter for ${mark} SIDE BARS (${formatExact(sbNos)} bars of ${formatExact(sbDia)}mm) is omitted from the PDF Schedule Table; ` +
          `span is derived dynamically from Plan-measured orthogonal spans (${seg1Id} & ${segOrthId}) less concrete cover ($S$2) plus hooks ($S$3/$U$3). ` +
          `Confirm against actual design / site sizes before export.`,
      });
      return rows;
    }

    if (Number(item.footing_b_mm || 0) <= 0 || Number(item.footing_l_mm || 0) <= 0) {
      return rows;
    }

    const b = Math.min(Number(item.footing_b_mm), Number(item.footing_l_mm));
    const l = Math.max(Number(item.footing_b_mm), Number(item.footing_l_mm));
    const lEff = Math.max(100, l - 2 * cov);
    const bEff = Math.max(100, b - 2 * cov);

    const longId = `${mark}_long`;
    const shortId = `${mark}_short`;
    rows.push({
      id: longId,
      sr_no: srNo,
      group_key: mark,
      bar_mark: mark,
      description: "LONG LOWER",
      span_expr: null,
      span_mm: l,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: formatExact(lEff), leg: formatExact(leg) } },
      spacing_mm: sp,
      nos_expr: wrapRoundup(nosInner, settings.round_up_nos),
      nos: 0,
      multiple_expr: "=@SELF:AD*@SELF:AC",
      multiple_no: cfMult,
      total_nos: 0,
      cut_length_expr: cutLoopExpr,
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: b,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: 2,
      param_ae: "Z=Depth; AA=PerpB; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
      remark: "",
      inferred: false,
      source_note: "",
    });
    rows.push({
      id: shortId,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: "SHORT UPPER",
      span_expr: null,
      span_mm: b,
      dia_mm: dia,
      shape: { kind: "combined_loop", labels: { span: formatExact(bEff), leg: formatExact(leg) } },
      spacing_mm: sp,
      nos_expr: wrapRoundup(nosInner, settings.round_up_nos),
      nos: 0,
      multiple_expr: "=@SELF:AD*@SELF:AC",
      multiple_no: cfMult,
      total_nos: 0,
      cut_length_expr: cutLoopExpr,
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: depth,
      param_aa: l,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: 2,
      param_ae: "Z=Depth; AA=PerpL; AB=ManualOff(mm); AC=CFQty; AD=Layers(2)",
      remark: "",
      inferred: false,
      source_note: "",
    });

    rows.push({
      id: `${mark}_side`,
      sr_no: null,
      group_key: mark,
      bar_mark: mark,
      description: "SIDE BARS",
      span_expr: `=2*(@ID:${longId}:D-2*$S$2)+2*(@ID:${shortId}:D-2*$S$2)+2*MAX($S$3*@SELF:E,$U$3)-(4*@ID:${longId}:E)+@SELF:AB`,
      span_mm: 0,
      dia_mm: Number(item.side_bars_dia || 10),
      shape: { kind: "straight", labels: { text: "Along Perimeter" } },
      spacing_mm: null,
      nos_expr: null,
      nos: Number(item.side_bars_nos || 3),
      multiple_expr: "=@SELF:AC",
      multiple_no: cfCount,
      total_nos: 0,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 0,
      coupler: 0,
      weight_kg: 0,
      param_z: null,
      param_aa: null,
      param_ab: 0,
      param_ac: cfCount,
      param_ad: null,
      param_ae: "Perimeter linked to LONG/SHORT spans + Hook($S$3/$U$3); AC=CFQty",
      remark: "",
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
        if (item.shaft_inner_b_mm && item.shaft_inner_l_mm) {
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
        sr_no: srCounter,
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
        multiple_expr: "=@SELF:AC*@SELF:AD",
        multiple_no: 1,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_ac: 1,
        param_ad: 1,
        param_ae: "Enter Span(D) & Nos(K) to compute via formula",
        remark: "Suite at Site",
        inferred: false,
        source_note: "",
      });
      rows.push({
        id: "spacers_wastage",
        sr_no: srCounter + 1,
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
        multiple_expr: "=@SELF:AC*@SELF:AD",
        multiple_no: 1,
        total_nos: 0,
        cut_length_expr: "=@SELF:D",
        cut_length_mm: 0,
        coupler: 0,
        weight_kg: 0,
        param_ac: 1,
        param_ad: 1,
        param_ae: "Enter Span(D) & Nos(K) to compute via formula",
        remark: "Suite at Site",
        inferred: false,
        source_note: "",
      });
    }
    return rows;
  }

  function recalculateDocument(doc) {
    doc.settings = defaultSettings(doc.settings || {});
    const settings = doc.settings;
    const totalsKg = {};
    for (const d of DIAMETER_COLUMNS) totalsKg[d] = 0;

    const firstTieByGroup = {};
    doc.rows.forEach((row, idx) => {
      const excelR = 8 + idx;
      if (String(row.description || "").includes("COL.TIES") && !(row.group_key in firstTieByGroup)) {
        firstTieByGroup[row.group_key] = excelR;
      }
      const ftRow = firstTieByGroup[row.group_key] ?? null;

      if (row.nos_expr) row.nos_expr = syncRoundupExpr(row.nos_expr, settings.round_up_nos);

      if (row.span_expr) {
        const res = resolveRowFormula(row.span_expr, idx, doc.rows, settings, ftRow);
        if (!res) row.span_expr = null;
        else if (res.value !== null) row.span_mm = res.value;
      }
      if (row.nos_expr) {
        const res = resolveRowFormula(row.nos_expr, idx, doc.rows, settings, ftRow);
        if (!res) row.nos_expr = null;
        else if (res.value !== null) row.nos = res.value;
      }
      if (row.multiple_expr) {
        const res = resolveRowFormula(row.multiple_expr, idx, doc.rows, settings, ftRow);
        if (!res) row.multiple_expr = null;
        else if (res.value !== null) row.multiple_no = res.value;
      }

      row.total_nos = Number(row.nos || 0) * Number(row.multiple_no || 0);

      if (row.cut_length_expr) {
        const res = resolveRowFormula(row.cut_length_expr, idx, doc.rows, settings, ftRow);
        if (!res) row.cut_length_expr = null;
        else if (res.value !== null) row.cut_length_mm = res.value;
      }

      if (row.id && row.id.endsWith("_col_vert")) {
        row.description = `COLUMN(upto ${(Number(settings.column_height_mm) / 1000).toFixed(3)} m)`;
        row.shape = {
          kind: "l_bar",
          labels: { ld: formatExact(settings.ld_vertical_mm), height: formatExact(settings.column_height_mm) },
        };
      }

      row.weight_kg = computeWeightKg(
        row.total_nos,
        Number(row.cut_length_mm || 0),
        Number(row.dia_mm || 0),
        Number(settings.unit_wt_divisor || 162),
        Number(settings.scale_divisor || 1000)
      );
      const dKey = Math.round(Number(row.dia_mm || 0));
      if (Math.abs(Number(row.dia_mm || 0) - dKey) < 1e-9 && Object.prototype.hasOwnProperty.call(totalsKg, dKey)) {
        totalsKg[dKey] += row.weight_kg;
      }
    });

    const scale = Number(settings.scale_divisor || 1000);
    doc.totals_by_dia_mt = {};
    let totalMt = 0;
    for (const d of DIAMETER_COLUMNS) {
      const mt = totalsKg[d] / scale;
      doc.totals_by_dia_mt[d] = mt;
      totalMt += mt;
    }
    doc.total_weight_mt = totalMt;
    return doc;
  }

  function buildBbsDocument(meta, schedule, settings, warnings, parseStats, dateStr = "") {
    const mergedSettings = defaultSettings(settings || {});
    const rows = generateBbsRows(schedule, mergedSettings);
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
      settings: mergedSettings,
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
    GLOBAL_CONST_CELLS,
    defaultSettings,
    formatExact,
    resolveRowFormula,
    computeWeightKg,
    generateBbsRows,
    recalculateDocument,
    buildBbsDocument,
  };
})(window);
