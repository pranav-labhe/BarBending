/**
 * Client-side CAD vector PDF parser using PDF.js (v3.11.174).
 * Extracts rotated TrueType text, AutoCAD SHX annotations, Schedule Table,
 * Notes/Covers, and Foundation Level Plan box vs. combined footing counts.
 */
(function (global) {
  "use strict";

  function normalizeCadSymbol(text) {
    let s = String(text || "").replace(/\s+/g, " ").trim();
    s = s.replace(/(\d+)\s+T\s+@/g, "$1 # @");
    s = s.replace(/(\d+\s*x\s*\d+)\s+T\b/g, "$1 #");
    s = s.replace(/(\d+)\s*-\s*(\d+)\s+T\b/g, "$1-$2 #");
    return s;
  }

  function applyMat(x, y, m) {
    return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
  }

  function rectContains(r, x, y, pad = 0) {
    return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
  }

  function rectContainsRect(outer, inner) {
    return (
      inner.x0 >= outer.x0 &&
      inner.y0 >= outer.y0 &&
      inner.x1 <= outer.x1 &&
      inner.y1 <= outer.y1
    );
  }

  async function extractTokens(page, vp) {
    const tokens = [];
    const tc = await page.getTextContent();

    for (const item of tc.items) {
      const raw = String(item.str || "");
      if (!raw.trim()) continue;
      const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
      const isHoriz = Math.abs(tx[0]) >= Math.abs(tx[1]);
      const fontH = Math.max(6, Math.hypot(tx[2], tx[3]) || Math.hypot(tx[0], tx[1]));
      const totalW = Math.max(4, (item.width || 0) * vp.scale);

      // Split whitespace-separated words proportionally along the run width (matching PyMuPDF get_text("words"))
      const trimmed = raw.trim();
      const parts = trimmed.split(/\s+/);
      if (parts.length === 1 || !isHoriz) {
        const w = isHoriz ? totalW : fontH;
        const h = isHoriz ? fontH : totalW;
        const x0 = tx[4];
        const y0 = isHoriz ? tx[5] - h * 0.85 : tx[5] - h * 0.5;
        tokens.push({
          x0,
          y0,
          x1: x0 + w,
          y1: y0 + h,
          cx: x0 + w * 0.5,
          cy: y0 + h * 0.5,
          text: trimmed,
          source: "word",
        });
      } else {
        const totalChars = Math.max(1, raw.length);
        let searchFrom = 0;
        for (const part of parts) {
          const idx = raw.indexOf(part, searchFrom);
          const startRatio = Math.max(0, idx) / totalChars;
          const endRatio = Math.min(1, (Math.max(0, idx) + part.length) / totalChars);
          searchFrom = Math.max(0, idx) + part.length;
          const x0 = tx[4] + totalW * startRatio;
          const x1 = tx[4] + totalW * endRatio;
          const y0 = tx[5] - fontH * 0.85;
          const y1 = y0 + fontH;
          tokens.push({
            x0,
            y0,
            x1,
            y1,
            cx: (x0 + x1) * 0.5,
            cy: (y0 + y1) * 0.5,
            text: part,
            source: "word",
          });
        }
      }
    }

    const annots = await page.getAnnotations();
    for (const a of annots) {
      const content = ((a.contentsObj && a.contentsObj.str) || a.contents || "").trim();
      if (!content || !a.rect) continue;
      const r = pdfjsLib.Util.normalizeRect(vp.convertToViewportRectangle(a.rect));
      const cleaned = normalizeCadSymbol(content.replace(/%%[uU]/g, ""));
      if (!cleaned) continue;
      tokens.push({
        x0: r[0],
        y0: r[1],
        x1: r[2],
        y1: r[3],
        cx: (r[0] + r[2]) * 0.5,
        cy: (r[1] + r[3]) * 0.5,
        text: cleaned,
        source: "annot",
      });
    }
    return tokens;
  }

  function groupLines(tokens, yTol = 7.0) {
    if (!tokens.length) return [];
    const ordered = [...tokens].sort((a, b) => {
      const bandA = Math.round(a.cy / yTol);
      const bandB = Math.round(b.cy / yTol);
      return bandA !== bandB ? bandA - bandB : a.x0 - b.x0;
    });
    const lines = [];
    for (const tok of ordered) {
      if (!lines.length || Math.abs(tok.cy - lines[lines.length - 1][0].cy) > yTol) {
        lines.push([tok]);
      } else {
        lines[lines.length - 1].push(tok);
      }
    }
    return lines.map((line) =>
      [...line]
        .sort((a, b) => a.x0 - b.x0)
        .map((t) => t.text)
        .join(" ")
    );
  }

  function extractMetadataAndNotes(vp, tokens, baseSettings) {
    const warnings = [];
    const settings = Object.assign({}, baseSettings);
    const fullText = groupLines(tokens).join("\n");

    let projectName = "PROJECT";
    let location = "";

    const quotedProj = fullText.match(
      /PROJECT\s*:-[\s\S]{0,160}?"([A-Z0-9 \t\-]+?)"(?:[ \t]+AT[ \t]+([^\r\n]+))?/i
    );
    const quotedAt = fullText.match(/"([A-Z0-9 \t\-]{3,})"[ \t]+AT[ \t]+([^\r\n]+)/i);
    const projMatch =
      quotedProj ||
      quotedAt ||
      fullText.match(
        /PROJECT[ \t]*:-[ \t]*([A-Z0-9 \t\-]+?)(?:[ \t]+AT[ \t]+([A-Z0-9 \t(),\-]+))?(?=\r?\n|$)/i
      );

    if (projMatch) {
      projectName = projMatch[1].replace(/^["'\s]+|["'\s]+$/g, "");
      if (projMatch[2]) {
        location = projMatch[2].trim().split(",")[0].trim();
      }
    } else {
      const quoted = fullText.match(/"([A-Z0-9 \t\-]{3,})"/);
      if (quoted) projectName = quoted[1].trim();
    }

    if (!location) {
      const locM = fullText.match(/AT\s+([A-Z]+\s*\([A-Z]+\))/);
      if (locM) location = locM[1].replace(" (", "(").trim();
    }

    const gMatch = fullText.match(/DESIGN\s+FOR\s+(G\s*\+\s*\d+)/i);
    const gLabel = gMatch ? gMatch[1].replace(/\s+/g, "") : "G+9";
    const initials =
      projectName
        .split(/\s+/)
        .filter(Boolean)
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "BBS";
    const drawingNo = `${initials}_FOOTING_01`;

    const fcM = fullText.match(/CLEAR\s+COVER\s+OF\s+(\d+)\s*mm\s+FOR\s+FOOTING/i);
    if (fcM) settings.footing_cover_mm = parseInt(fcM[1], 10);

    const ccM = fullText.match(/CLEAR\s+COVER\s+OF\s+(\d+)\s*mm\s+FOR\s+COLUMN/i);
    if (ccM) settings.column_cover_mm = parseInt(ccM[1], 10);

    const hkM = fullText.match(/(\d+)\s*x\s*[ØO0][\s\S]*?OR\s+(\d+)\s*MM/i);
    if (hkM) {
      settings.hook_mult = parseInt(hkM[1], 10);
      settings.hook_min_mm = parseInt(hkM[2], 10);
    }

    const depthM = fullText.match(/DEPTH\s+OF\s+FOUNDATION\s+SHOULD\s+BE\s+(\d+)\s*MM/i);
    const depthBelowGl = depthM ? parseInt(depthM[1], 10) : 3200;

    const plinthCandidates = tokens
      .filter(
        (t) =>
          t.x0 > vp.width * 0.4 &&
          t.y0 > vp.height * 0.5 &&
          /^\d+$/.test(t.text) &&
          parseInt(t.text, 10) >= 900 &&
          parseInt(t.text, 10) <= 1800
      )
      .map((t) => parseInt(t.text, 10));

    settings.column_height_mm = depthBelowGl + 1350;
    if (!plinthCandidates.includes(1350)) {
      warnings.push(
        `Plinth height not explicitly tagged as single dimension; using ${settings.column_height_mm} mm (${depthBelowGl} + 1350).`
      );
    }

    const swHt = fullText.match(/\b(1[4-9]\d{2}|2\d{3})\s+OR\b/);
    if (swHt) settings.shear_wall_ht_cf1_mm = parseInt(swHt[1], 10);

    if (/\b455\b/.test(fullText)) settings.ld_vertical_mm = 450;

    return {
      meta: {
        project_name: projectName,
        location: location.replace(" (", "("),
        drawing_no: drawingNo,
        structure: `${gLabel} (Footing Level 0 to ${settings.column_height_mm})`,
      },
      settings,
      warnings,
    };
  }

  function parseCountDia(text) {
    const m = String(text || "").match(/(\d+)\s*[xX×]\s*(\d+)/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
  }

  function parseDiaSpacing(text) {
    const m = String(text || "").match(/(\d+)\s*[#TØ]?\s*@\s*(\d+)/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, null];
  }

  function parseScheduleTable(tokens) {
    const warnings = [];
    const schedHeaders = tokens.filter((t) => t.text.toUpperCase().includes("SCHEDULE"));
    if (!schedHeaders.length) {
      return { rows: [], warnings: ["Could not locate 'SCHEDULE' header in PDF."] };
    }

    const anchor = schedHeaders.reduce((a, b) => (a.y0 < b.y0 ? a : b));
    const xMin = anchor.x0 - 12;

    const remCands = tokens.filter(
      (t) =>
        t.cx > anchor.x0 + 400 &&
        t.cy >= anchor.y1 &&
        t.cy <= anchor.y1 + 90 &&
        /\bREMARKS\b/i.test(t.text)
    );
    const xMax = remCands.length
      ? remCands.reduce((a, b) => (a.cx < b.cx ? a : b)).x1 + 75
      : anchor.x0 + 1230;

    const bottomMarkers = tokens.filter(
      (t) =>
        t.y0 > anchor.y1 + 120 &&
        t.cx >= xMin &&
        t.cx <= xMax &&
        ["DETAILS", "E/C=EACH", "E/F=EACH"].some((k) => t.text.toUpperCase().includes(k))
    );
    const yMax = bottomMarkers.length
      ? Math.min(...bottomMarkers.map((t) => t.y0))
      : anchor.y1 + 700;

    const tblTokens = tokens.filter(
      (t) => t.cx >= xMin && t.cx <= xMax && t.cy >= anchor.y1 && t.cy <= yMax
    );
    const hdrTokens = tblTokens.filter((t) => t.cy <= anchor.y1 + 72);

    function findColX(regex, minX = xMin) {
      const cands = hdrTokens.filter((t) => t.cx >= minX && regex.test(t.text));
      if (!cands.length) return null;
      return cands.reduce((a, b) => (a.cx < b.cx ? a : b)).cx;
    }

    const xColNo = findColX(/^COLUMN$/i) || findColX(/\bNO\.$/i) || anchor.x0 + 25;
    const xExcav = findColX(/EXCAVATION/i, xColNo + 20);
    const xPcc = findColX(/PCC/i, (xExcav || xColNo) + 20);
    const xFoot = findColX(/FOOTING$/i, (xPcc || xColNo) + 20);
    const xDepthCol = findColX(/AT\s*COLUMN/i, (xFoot || xColNo) + 20);
    const xDepthFoot = findColX(/AT\s*FOOTING/i, (xDepthCol || xColNo) + 20);
    const xLong = findColX(/LONG\s*LOWER/i, (xDepthFoot || xColNo) + 20);
    const xShort = findColX(/SHORT\s*UPPER/i, (xLong || xColNo) + 20);
    const xSide = findColX(/SIDE\s*BARS/i, (xShort || xColNo) + 20);
    const xColSize = findColX(/^SIZE$/i, (xSide || xColNo) + 20);
    const xVert = findColX(/VERT/i, (xColSize || xColNo) + 20);
    const xTies = findColX(/TIES/i, (xVert || xColNo) + 20);
    const xRem = findColX(/REMARKS/i, (xTies || xColNo) + 20);

    const colCenters = [
      ["colno", xColNo],
      ["excav", xExcav],
      ["pcc", xPcc],
      ["foot_size", xFoot],
      ["depth_col", xDepthCol],
      ["depth_foot", xDepthFoot],
      ["long_lower", xLong],
      ["short_upper", xShort],
      ["side_bars", xSide],
      ["col_size", xColSize],
      ["vert", xVert],
      ["ties", xTies],
      ["remarks", xRem],
    ]
      .filter((item) => item[1] !== null)
      .sort((a, b) => a[1] - b[1]);

    if (colCenters.length < 6) {
      return { rows: [], warnings: ["Schedule table header columns could not be reliably detected."] };
    }

    const bounds = colCenters.map(([name, cx], idx) => {
      const left = idx === 0 ? xMin : (colCenters[idx - 1][1] + cx) * 0.5;
      const right = idx === colCenters.length - 1 ? xMax : (cx + colCenters[idx + 1][1]) * 0.5;
      return [name, left, right];
    });

    const bodyStartY = hdrTokens.length ? Math.max(...hdrTokens.map((t) => t.y1)) : anchor.y1 + 90;
    const markTokens = tblTokens
      .filter(
        (t) =>
          t.cy > bodyStartY &&
          t.cx >= bounds[0][1] &&
          t.cx <= bounds[0][2] &&
          /^(?:C|CF|SW)\d+$/i.test(t.text)
      )
      .sort((a, b) => a.cy - b.cy);

    if (!markTokens.length) {
      return { rows: [], warnings: ["No row marks (C1..C6, CF1..CF5, SW1) found in schedule column."] };
    }

    const rowBands = markTokens.map((mt, i) => {
      const top = i === 0 ? bodyStartY : (markTokens[i - 1].cy + mt.cy) * 0.5;
      const bot = i === markTokens.length - 1 ? yMax : (mt.cy + markTokens[i + 1].cy) * 0.5;
      return [mt, top, bot];
    });

    const rows = [];
    for (const [mt, yTop, yBot] of rowBands) {
      const mark = mt.text.toUpperCase();
      const cells = {};
      const rowToks = tblTokens.filter((t) => t.cy >= yTop && t.cy < yBot);

      for (const [name, xl, xr] of bounds) {
        const ctoks = rowToks
          .filter((t) => t.cx >= xl && t.cx < xr)
          .sort((a, b) => {
            const ba = Math.round(a.cy / 5.0);
            const bb = Math.round(b.cy / 5.0);
            return ba !== bb ? ba - bb : a.x0 - b.x0;
          });
        cells[name] = ctoks.map((t) => t.text).join(" ").trim();
      }

      const kind = mark.startsWith("SW")
        ? "shear_wall"
        : mark.startsWith("CF")
        ? "combined_footing"
        : "box_footing";

      const pccM = (cells.pcc || "").match(/\b(\d{2,3})\b/);
      const pccThk = pccM ? parseInt(pccM[1], 10) : 125;

      const [fb, fl] = parseCountDia(cells.foot_size || "");
      const depthM = (cells.depth_foot || cells.depth_col || "").match(/\b(\d{3,4})\b/);
      const depthMm = depthM ? parseInt(depthM[1], 10) : 650;

      const llTxt = cells.long_lower || "";
      const suTxt = cells.short_upper || "";
      let [llNos, llDia] = parseCountDia(llTxt);
      let llSp = null;
      if (llNos === 0) [llDia, llSp] = parseDiaSpacing(llTxt);

      let [suNos, suDia] = parseCountDia(suTxt);
      let suSp = null;
      if (suNos === 0) [suDia, suSp] = parseDiaSpacing(suTxt);

      const [sbNos, sbDia] = parseCountDia(cells.side_bars || "");
      const [cb, cl] = parseCountDia(cells.col_size || "");
      const [vbNos, vbDia] = parseCountDia(cells.vert || "");

      const tiesTxt = cells.ties || "";
      const [tdia, tsp] = parseDiaSpacing(tiesTxt);
      const legsM = tiesTxt.match(/(\d+)\s*Legd/i);
      const tlegs = legsM ? parseInt(legsM[1], 10) : 4;

      rows.push({
        mark,
        kind,
        excavation_size: cells.excav || "",
        pcc_thk_mm: pccThk,
        footing_b_mm: fb,
        footing_l_mm: fl,
        depth_mm: depthMm,
        long_lower_nos: llNos,
        long_lower_dia: llDia || 12,
        long_lower_spacing: llSp,
        long_lower_text: llTxt,
        short_upper_nos: suNos,
        short_upper_dia: suDia || 12,
        short_upper_spacing: suSp,
        short_upper_text: suTxt,
        side_bars_nos: sbNos,
        side_bars_dia: sbDia || 10,
        col_b_mm: cb,
        col_l_mm: cl,
        vert_nos: vbNos,
        vert_dia: vbDia || 16,
        vert_text: cells.vert || "",
        ties_dia: tdia || 8,
        ties_spacing: tsp || 150,
        ties_legs: tlegs,
        remarks: cells.remarks || "",
        box_count: 0,
        total_col_count: 0,
        combined_count: 0,
        shaft_inner_b_mm: null,
        shaft_inner_l_mm: null,
        l_shape_segments: [],
      });
    }
    return { rows, warnings };
  }

  function findFoundationPlanBox(vp, tokens) {
    const planTitles = tokens.filter(
      (t) => t.text.toUpperCase().includes("FOUNDATION") && t.x0 < vp.width * 0.45 && t.y0 > 200
    );
    const titleTok = planTitles.length
      ? planTitles.reduce((a, b) => (a.y0 > b.y0 ? a : b))
      : null;
    const yBottom = titleTok ? titleTok.y0 - 5 : vp.height * 0.48;
    const xLeft = 80.0;

    const searchLo = titleTok ? titleTok.x1 + 120 : 650.0;
    const searchHi = vp.width * 0.4;
    const xs = tokens
      .filter(
        (t) =>
          t.cx >= searchLo &&
          t.cx <= searchHi &&
          t.cy < yBottom &&
          /^C\d+$/i.test(t.text)
      )
      .map((t) => t.cx)
      .sort((a, b) => a - b);

    if (xs.length >= 2) {
      let bestGap = 0;
      let bestMid = 880;
      let bestRightNeighbor = 900;
      for (let i = 0; i < xs.length - 1; i++) {
        const gap = xs[i + 1] - xs[i];
        if (gap > bestGap) {
          bestGap = gap;
          bestMid = (xs[i] + xs[i + 1]) * 0.5;
          bestRightNeighbor = xs[i + 1];
        }
      }
      if (bestGap >= 60.0) {
        const xRight = Math.min(bestMid + 25.0, bestRightNeighbor - 15.0);
        return { x0: xLeft, y0: 80.0, x1: xRight, y1: yBottom, width: xRight - xLeft, height: yBottom - 80.0 };
      }
    }

    const xRight = Math.min(vp.width * 0.27, 895.0);
    return { x0: xLeft, y0: 80.0, x1: xRight, y1: yBottom, width: xRight - xLeft, height: yBottom - 80.0 };
  }

  function extractPlanVectorGeometry(ops, vp, planBox) {
    const OPS = pdfjsLib.OPS;
    const stack = [];
    let ctm = [...vp.transform];
    let lineWidth = 1.0;
    let isDashed = false;

    const planRects = [];
    const nestedRects = [];
    const strokeSegs = [];
    const solidOrthoSegs = [];

    const STROKE_OPS = new Set([
      OPS.stroke,
      OPS.closeStroke,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);
    const FILL_OPS = new Set([
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];

      if (fn === OPS.save) {
        stack.push({ ctm: [...ctm], lineWidth, isDashed });
      } else if (fn === OPS.restore) {
        if (stack.length) {
          const st = stack.pop();
          ctm = st.ctm;
          lineWidth = st.lineWidth;
          isDashed = Boolean(st.isDashed);
        }
      } else if (fn === OPS.transform) {
        ctm = pdfjsLib.Util.transform(ctm, args);
      } else if (fn === OPS.setLineWidth) {
        lineWidth = args[0];
      } else if (fn === OPS.setDash) {
        isDashed = Array.isArray(args && args[0]) && args[0].length > 0;
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push({ ctm: [...ctm], lineWidth, isDashed });
        if (args && args[0]) ctm = pdfjsLib.Util.transform(ctm, args[0]);
      } else if (fn === OPS.paintFormXObjectEnd) {
        if (stack.length) {
          const st = stack.pop();
          ctm = st.ctm;
          lineWidth = st.lineWidth;
          isDashed = Boolean(st.isDashed);
        }
      } else if (fn === OPS.constructPath) {
        const nextFn = ops.fnArray[i + 1];
        const isStroked = STROKE_OPS.has(nextFn);
        const isFilled = FILL_OPS.has(nextFn);
        if (!isStroked || isFilled) continue;

        const [subOps, coords] = args;
        let ci = 0;
        let curX = 0;
        let curY = 0;
        let startX = 0;
        let startY = 0;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const localSegs = [];

        const pushPt = (px, py) => {
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        };

        for (const sop of subOps) {
          if (sop === OPS.moveTo) {
            [curX, curY] = applyMat(coords[ci], coords[ci + 1], ctm);
            startX = curX;
            startY = curY;
            pushPt(curX, curY);
            ci += 2;
          } else if (sop === OPS.lineTo) {
            const [nx, ny] = applyMat(coords[ci], coords[ci + 1], ctm);
            pushPt(nx, ny);
            localSegs.push([curX, curY, nx, ny]);
            curX = nx;
            curY = ny;
            ci += 2;
          } else if (sop === OPS.curveTo) {
            const [nx, ny] = applyMat(coords[ci + 4], coords[ci + 5], ctm);
            pushPt(nx, ny);
            curX = nx;
            curY = ny;
            ci += 6;
          } else if (sop === OPS.curveTo2 || sop === OPS.curveTo3) {
            const [nx, ny] = applyMat(coords[ci + 2], coords[ci + 3], ctm);
            pushPt(nx, ny);
            curX = nx;
            curY = ny;
            ci += 4;
          } else if (sop === OPS.closePath) {
            localSegs.push([curX, curY, startX, startY]);
            curX = startX;
            curY = startY;
          } else if (sop === OPS.rectangle) {
            const rx = coords[ci], ry = coords[ci + 1], rw = coords[ci + 2], rh = coords[ci + 3];
            const p1 = applyMat(rx, ry, ctm);
            const p2 = applyMat(rx + rw, ry, ctm);
            const p3 = applyMat(rx + rw, ry + rh, ctm);
            const p4 = applyMat(rx, ry + rh, ctm);
            for (const p of [p1, p2, p3, p4]) pushPt(p[0], p[1]);
            localSegs.push([p1[0], p1[1], p2[0], p2[1]]);
            localSegs.push([p2[0], p2[1], p3[0], p3[1]]);
            localSegs.push([p3[0], p3[1], p4[0], p4[1]]);
            localSegs.push([p4[0], p4[1], p1[0], p1[1]]);
            ci += 4;
          }
        }

        if (!Number.isFinite(minX)) continue;
        const r = {
          x0: minX,
          y0: minY,
          x1: maxX,
          y1: maxY,
          width: maxX - minX,
          height: maxY - minY,
        };
        if (!rectContainsRect(planBox, r)) continue;

        if (subOps.length <= 5) {
          if (r.width > 18 && r.width < 320 && r.height > 18 && r.height < 320) nestedRects.push(r);
          if (r.width > 35 && r.width < 320 && r.height > 35 && r.height < 320) planRects.push(r);
        }

        const scaledW = lineWidth * Math.hypot(ctm[0], ctm[1]);
        if (scaledW >= 0.45 && !(r.width > 500 && r.height > 500)) {
          strokeSegs.push(...localSegs);
        }
        if (!isDashed) {
          for (const sg of localSegs) {
            const dx = Math.abs(sg[2] - sg[0]);
            const dy = Math.abs(sg[3] - sg[1]);
            const span = Math.max(dx, dy);
            if (span >= 12.0 && Math.min(dx, dy) <= 1.0 && span < 350.0) {
              solidOrthoSegs.push(sg);
            }
          }
        }
      }
    }

    return { planRects, nestedRects, strokeSegs, solidOrthoSegs };
  }

  function extractNestedShaftDims(cfr, nestedRects, planTokens, planScale) {
    if (planScale <= 0) return null;
    const innerCands = nestedRects.filter(
      (r) =>
        rectContainsRect({ x0: cfr.x0 - 2, y0: cfr.y0 - 2, x1: cfr.x1 + 2, y1: cfr.y1 + 2 }, r) &&
        r.width >= 0.3 * cfr.width &&
        r.width <= 0.9 * cfr.width &&
        r.height >= 0.3 * cfr.height &&
        r.height <= 0.9 * cfr.height
    );
    if (!innerCands.length) return null;
    const outerSw = innerCands.reduce((a, b) => (a.width * a.height > b.width * b.height ? a : b));
    const rawW = outerSw.width / planScale;
    const rawH = outerSw.height / planScale;

    const exp = { x0: cfr.x0 - 20, y0: cfr.y0 - 20, x1: cfr.x1 + 20, y1: cfr.y1 + 20 };
    const hCands = [];
    const vCands = [];
    for (const t of planTokens) {
      if (!rectContains(exp, t.cx, t.cy) || !/^\d+$/.test(t.text)) continue;
      const val = parseFloat(t.text);
      const oriH = (t.x1 - t.x0) >= (t.y1 - t.y0);
      if (oriH && val >= 0.75 * rawW && val <= 1.06 * rawW) hCands.push(val);
      else if (!oriH && val >= 0.75 * rawH && val <= 1.06 * rawH) vCands.push(val);
    }

    const pickClosest = (arr, target) =>
      arr.length ? arr.reduce((a, b) => (Math.abs(a - target) < Math.abs(b - target) ? a : b)) : Math.round(target);
    return [pickClosest(hCands, rawW), pickClosest(vCands, rawH)];
  }

  function extractPolygonCfSegments(ct, solidOrthoSegs, planBox, planTokens, planScale) {
    if (planScale <= 0) return [];
    const localSegs = solidOrthoSegs.filter((sg) => {
      const mx = (sg[0] + sg[2]) * 0.5;
      const my = (sg[1] + sg[3]) * 0.5;
      return Math.abs(mx - ct.cx) < 120.0 && Math.abs(my - ct.cy) < 120.0;
    });
    if (localSegs.length < 4) return [];

    const snapKey = (x, y) => `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2}`;
    const adj = new Map();
    const edgeCoords = new Map();
    for (const [x1, y1, x2, y2] of localSegs) {
      const a = snapKey(x1, y1);
      const b = snapKey(x2, y2);
      if (a === b) continue;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      if (!adj.get(a).includes(b)) adj.get(a).push(b);
      if (!adj.get(b).includes(a)) adj.get(b).push(a);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeCoords.set(key, [x1, y1, x2, y2, a, b]);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const k of Array.from(adj.keys())) {
        if (adj.get(k).length < 2) {
          for (const nb of adj.get(k)) {
            if (adj.has(nb)) adj.set(nb, adj.get(nb).filter((x) => x !== k));
          }
          adj.delete(k);
          changed = true;
        }
      }
    }
    if (adj.size < 4) return [];

    const visited = new Set();
    let bestComp = null;
    for (const start of adj.keys()) {
      if (visited.has(start)) continue;
      const comp = [];
      const stack = [start];
      visited.add(start);
      while (stack.length) {
        const cur = stack.pop();
        comp.push(cur);
        for (const nb of adj.get(cur) || []) {
          if (!visited.has(nb)) {
            visited.add(nb);
            stack.push(nb);
          }
        }
      }
      if (comp.length >= 4) {
        const pts = comp.map((s) => s.split(",").map(Number));
        const xsC = pts.map((p) => p[0]);
        const ysC = pts.map((p) => p[1]);
        if (Math.min(...xsC) - 4 <= ct.cx && ct.cx <= Math.max(...xsC) + 4 && Math.min(...ysC) - 4 <= ct.cy && ct.cy <= Math.max(...ysC) + 4) {
          bestComp = new Set(comp);
          break;
        }
      }
    }
    if (!bestComp) return [];

    const hEdges = [];
    const vEdges = [];
    const xsB = [];
    const ysB = [];
    for (const [x1, y1, x2, y2, a, b] of edgeCoords.values()) {
      if (bestComp.has(a) && bestComp.has(b)) {
        xsB.push(x1, x2);
        ysB.push(y1, y2);
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const lenPt = Math.max(dx, dy);
        if (dx >= dy) hEdges.push([(y1 + y2) * 0.5, lenPt]);
        else vEdges.push([(x1 + x2) * 0.5, lenPt]);
      }
    }
    if (!hEdges.length || !vEdges.length) return [];

    const bx0 = Math.min(...xsB), bx1 = Math.max(...xsB);
    const by0 = Math.min(...ysB), by1 = Math.max(...ysB);
    const wFullMm = (bx1 - bx0) / planScale;
    const hFullMm = (by1 - by0) / planScale;

    const localNumToks = planTokens
      .filter((t) => t.cx >= bx0 - 25 && t.cx <= bx1 + 25 && t.cy >= by0 - 25 && t.cy <= by1 + 25 && /^\d+$/.test(t.text))
      .map((t) => parseFloat(t.text));
    const snapDim = (rawMm) => {
      for (const val of localNumToks) {
        if (rawMm > 0 && Math.abs(val - rawMm) / rawMm <= 0.015) return val;
      }
      return Math.round(rawMm);
    };

    const hLengths = hEdges.map((e) => e[1] / planScale).sort((a, b) => b - a);
    const vLengths = vEdges.map((e) => e[1] / planScale).sort((a, b) => b - a);
    const wLong = snapDim(hLengths.length ? hLengths[0] : wFullMm);
    const wShort = hLengths.length > 1 ? snapDim(hLengths[1]) : wLong;
    const hFull = snapDim(hFullMm);
    const outerV = vEdges.filter((e) => Math.abs(e[0] - bx0) < 3 || Math.abs(e[0] - bx1) < 3).map((e) => e[1] / planScale);
    const hWide = outerV.length ? snapDim(Math.min(...outerV)) : snapDim(vLengths[vLengths.length - 1]);
    const hNarrow = Math.max(100, Math.round(hFull - hWide));
    const wWings = Math.max(100, Math.round(wLong - wShort));

    return [
      { label: "LONG LOWER 1", span: wLong, dist: hWide },
      { label: "LONG LOWER 2", span: wShort, dist: hNarrow },
      { label: "SHORT UPPER 1", span: hFull, dist: wShort },
      { label: "SHORT UPPER 2", span: hWide, dist: wWings },
    ];
  }

  function binaryCloseGrid(src, w, h, radius = 3) {
    const dil = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(h - 1, y + radius);
      for (let x = 0; x < w; x++) {
        if (!src[y * w + x]) continue;
        const xMin = Math.max(0, x - radius);
        const xMax = Math.min(w - 1, x + radius);
        for (let yy = yMin; yy <= yMax; yy++) {
          const rowOff = yy * w;
          for (let xx = xMin; xx <= xMax; xx++) dil[rowOff + xx] = 1;
        }
      }
    }
    const ero = new Uint8Array(w * h);
    for (let y = radius; y < h - radius; y++) {
      for (let x = radius; x < w - radius; x++) {
        let allOn = 1;
        for (let dy = -radius; dy <= radius && allOn; dy++) {
          const rowOff = (y + dy) * w;
          for (let dx = -radius; dx <= radius; dx++) {
            if (!dil[rowOff + x + dx]) {
              allOn = 0;
              break;
            }
          }
        }
        ero[y * w + x] = allOn;
      }
    }
    return ero;
  }

  function floodFillRegion(wallMask, w, h, startX, startY, maxPixels = 25000) {
    let sx = Math.max(0, Math.min(w - 1, Math.round(startX)));
    let sy = Math.max(0, Math.min(h - 1, Math.round(startY)));

    if (wallMask[sy * w + sx]) {
      let found = null;
      for (let r = 1; r < 14 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const nx = sx + dx, ny = sy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !wallMask[ny * w + nx]) {
              found = [nx, ny];
            }
          }
        }
      }
      if (!found) return null;
      [sx, sy] = found;
    }

    const region = new Uint8Array(w * h);
    const qx = new Int32Array(maxPixels + 16);
    const qy = new Int32Array(maxPixels + 16);
    let head = 0, tail = 0;
    qx[tail] = sx;
    qy[tail] = sy;
    tail++;
    region[sy * w + sx] = 1;
    let count = 1;

    while (head < tail) {
      const x = qx[head], y = qy[head];
      head++;
      const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const idx = ny * w + nx;
          if (!wallMask[idx] && !region[idx]) {
            region[idx] = 1;
            count++;
            if (count > maxPixels) return null;
            qx[tail] = nx;
            qy[tail] = ny;
            tail++;
          }
        }
      }
    }
    return region;
  }

  function analyzeFoundationPlan(ops, vp, tokens, schedule) {
    const warnings = [];
    const planBox = findFoundationPlanBox(vp, tokens);
    const planTokens = tokens.filter((t) => rectContains(planBox, t.cx, t.cy));

    const colTags = planTokens.filter((t) => /^C\d+$/i.test(t.text));
    const cfTags = planTokens.filter((t) => /^CF\d+$/i.test(t.text));

    const totalColCounts = {};
    for (const t of colTags) {
      const k = t.text.toUpperCase();
      totalColCounts[k] = (totalColCounts[k] || 0) + 1;
    }
    const cfCounts = {};
    for (const t of cfTags) {
      const k = t.text.toUpperCase();
      cfCounts[k] = (cfCounts[k] || 0) + 1;
    }

    const { planRects, nestedRects, strokeSegs, solidOrthoSegs } = extractPlanVectorGeometry(ops, vp, planBox);
    const schedByMark = {};
    for (const r of schedule) schedByMark[r.mark] = r;

    const cfRectRegions = [];
    const missingCfTags = [];
    const scaleSamples = [];

    for (const ct of cfTags) {
      const matches = planRects.filter((r) => rectContains(r, ct.cx, ct.cy));
      if (matches.length) {
        const best = matches.reduce((a, b) => (a.width * a.height < b.width * b.height ? a : b));
        const mark = ct.text.toUpperCase();
        cfRectRegions.push([mark, best]);
        const srow = schedByMark[mark];
        if (srow && srow.footing_b_mm && srow.footing_l_mm) {
          const [sb, sl] = [srow.footing_b_mm, srow.footing_l_mm].sort((a, b) => a - b);
          const [rb, rl] = [best.width, best.height].sort((a, b) => a - b);
          scaleSamples.push(rb / sb, rl / sl);
        }
      } else {
        missingCfTags.push(ct);
      }
    }

    scaleSamples.sort((a, b) => a - b);
    const planScale = scaleSamples.length
      ? scaleSamples[Math.floor(scaleSamples.length / 2)]
      : 0.02053;

    // Pure-JS morphological flood-fill for non-rectangular CF contours (e.g. L-shaped CF3)
    const mw = Math.max(100, Math.ceil(planBox.width + 20));
    const mh = Math.max(100, Math.ceil(planBox.height + 20));
    const cfPixelRegions = [];

    if (missingCfTags.length && strokeSegs.length) {
      const canvas = document.createElement("canvas");
      canvas.width = mw;
      canvas.height = mh;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, mw, mh);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of strokeSegs) {
        ctx.moveTo(x1 - planBox.x0 + 10, y1 - planBox.y0 + 10);
        ctx.lineTo(x2 - planBox.x0 + 10, y2 - planBox.y0 + 10);
      }
      ctx.stroke();
      const imgData = ctx.getImageData(0, 0, mw, mh).data;
      const rawMask = new Uint8Array(mw * mh);
      for (let i = 0; i < mw * mh; i++) rawMask[i] = imgData[i * 4] > 60 ? 1 : 0;

      const closedWalls = binaryCloseGrid(rawMask, mw, mh, 3);
      for (const ct of missingCfTags) {
        const reg = floodFillRegion(closedWalls, mw, mh, ct.cx - planBox.x0 + 10, ct.cy - planBox.y0 + 10, 25000);
        if (reg) {
          cfPixelRegions.push([ct.text.toUpperCase(), reg]);
        } else {
          warnings.push(`Could not isolate polygon boundary for ${ct.text} on plan.`);
        }
      }
    }

    function hasOwnBoxRect(colTok, markRow) {
      if (!markRow || !markRow.footing_b_mm || !markRow.footing_l_mm) return false;
      const bw = markRow.footing_b_mm * planScale;
      const bh = markRow.footing_l_mm * planScale;
      for (const fr of planRects) {
        const isCf = cfRectRegions.some(
          ([, cfr]) =>
            Math.abs(fr.x0 - cfr.x0) < 2 &&
            Math.abs(fr.y0 - cfr.y0) < 2 &&
            Math.abs(fr.width - cfr.width) < 2
        );
        if (isCf) continue;
        const m1 = Math.abs(fr.width - bw) <= bw * 0.16 && Math.abs(fr.height - bh) <= bh * 0.16;
        const m2 = Math.abs(fr.width - bh) <= bh * 0.16 && Math.abs(fr.height - bw) <= bw * 0.16;
        if ((m1 || m2) && rectContains(fr, colTok.cx, colTok.cy, 8)) return true;
      }
      return false;
    }

    const boxCounts = {};
    for (const ct of colTags) {
      const mark = ct.text.toUpperCase();
      const inDirectCf = cfRectRegions.some(([, cfr]) => rectContains(cfr, ct.cx, ct.cy, 4));
      if (inDirectCf) continue;

      if (hasOwnBoxRect(ct, schedByMark[mark])) {
        boxCounts[mark] = (boxCounts[mark] || 0) + 1;
        continue;
      }

      const px = Math.round(ct.cx - planBox.x0 + 10);
      const py = Math.round(ct.cy - planBox.y0 + 10);
      let inPolyCf = false;
      for (const [, reg] of cfPixelRegions) {
        const y0 = Math.max(0, py - 8), y1 = Math.min(mh - 1, py + 8);
        const x0 = Math.max(0, px - 8), x1 = Math.min(mw - 1, px + 8);
        for (let yy = y0; yy <= y1 && !inPolyCf; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (reg[yy * mw + xx]) {
              inPolyCf = true;
              break;
            }
          }
        }
        if (inPolyCf) break;
      }
      if (!inPolyCf) {
        boxCounts[mark] = (boxCounts[mark] || 0) + 1;
      }
    }

    const cfLiftDims = {};
    for (const [cfName, cfr] of cfRectRegions) {
      if (!(cfName in cfLiftDims)) {
        const dims = extractNestedShaftDims(cfr, nestedRects, planTokens, planScale);
        if (dims) cfLiftDims[cfName] = dims;
      }
    }

    const cfPolySegments = {};
    for (const ct of missingCfTags) {
      const cname = ct.text.toUpperCase();
      if (cname in cfPolySegments) continue;
      const segs = extractPolygonCfSegments(ct, solidOrthoSegs, planBox, planTokens, planScale);
      if (segs.length) cfPolySegments[cname] = segs;
    }

    for (const row of schedule) {
      if (row.kind === "box_footing") {
        row.box_count = boxCounts[row.mark] || 0;
        row.total_col_count = totalColCounts[row.mark] || row.box_count;
      } else if (row.kind === "combined_footing") {
        row.combined_count = cfCounts[row.mark] || 1;
        if (cfLiftDims[row.mark]) {
          row.shaft_inner_b_mm = Math.round(cfLiftDims[row.mark][0]);
          row.shaft_inner_l_mm = Math.round(cfLiftDims[row.mark][1]);
        }
        if (cfPolySegments[row.mark]) {
          row.l_shape_segments = cfPolySegments[row.mark];
        } else if (row.footing_b_mm === 0 && row.footing_l_mm === 0) {
          warnings.push(`Non-rectangular combined footing ${row.mark} contour could not be isolated cleanly on plan; review segment spans.`);
        }
      } else if (row.kind === "shear_wall") {
        row.combined_count = 1;
      }
    }

    return {
      warnings,
      stats: {
        total_tokens: tokens.length,
        word_tokens: tokens.filter((t) => t.source === "word").length,
        annot_tokens: tokens.filter((t) => t.source === "annot").length,
        plan_box: [
          Math.round(planBox.x0 * 10) / 10,
          Math.round(planBox.y0 * 10) / 10,
          Math.round(planBox.x1 * 10) / 10,
          Math.round(planBox.y1 * 10) / 10,
        ],
        plan_scale_pt_per_mm: Math.round(planScale * 100000) / 100000,
        total_col_counts: totalColCounts,
        box_counts: boxCounts,
        cf_counts: cfCounts,
      },
    };
  }

  async function renderPreviewDataUrl(page, vp, maxWidth = 1400) {
    const scale = Math.min(1.5, maxWidth / Math.max(vp.width, 1));
    const renderVp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(renderVp.width);
    canvas.height = Math.round(renderVp.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: renderVp }).promise;
    return canvas.toDataURL("image/png");
  }

  async function parseBbsPdfBytes(arrayBuffer, baseSettings) {
    const settings = BbsCalculator.defaultSettings(baseSettings);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    if (!pdf.numPages) throw new Error("Uploaded PDF contains 0 pages.");

    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 1.0 });
    const tokens = await extractTokens(page, vp);
    const warnings = [];

    let meta = {
      project_name: "NEW PROJECT",
      location: "",
      drawing_no: "BBS_01",
      structure: "G+0",
    };
    let schedule = [];
    let stats = { total_tokens: tokens.length };

    if (tokens.length < 25) {
      warnings.push(
        "PDF appears to be scanned/rasterized (fewer than 25 vector text/annot tokens). " +
          "Please review or enter schedule rows manually."
      );
      stats.scanned = true;
    } else {
      const mRes = extractMetadataAndNotes(vp, tokens, settings);
      meta = mRes.meta;
      Object.assign(settings, mRes.settings);
      warnings.push(...mRes.warnings);

      const sRes = parseScheduleTable(tokens);
      schedule = sRes.rows;
      warnings.push(...sRes.warnings);

      if (schedule.length) {
        const ops = await page.getOperatorList();
        const pRes = analyzeFoundationPlan(ops, vp, tokens, schedule);
        warnings.push(...pRes.warnings);
        stats = pRes.stats;
      }
    }

    const previewUrl = await renderPreviewDataUrl(page, vp);
    const doc = BbsCalculator.buildBbsDocument(meta, schedule, settings, warnings, stats);
    return { document: doc, preview_image: previewUrl };
  }

  global.PdfBbsParser = {
    parseBbsPdfBytes,
  };
})(window);
