/**
 * Pure-JS OpenXML .xlsx generator with global constant cells ($R$2:$Y$4, $P$3, $O$4, $Q$4),
 * row reference constants (Z..AE), live unrounded column formulas, cached values,
 * and native DrawingML vector rebar shapes in columns F:I via JSZip.
 */
(function (global) {
  "use strict";

  const DIAMETER_COLUMNS = [8, 10, 12, 16, 20, 25, 32, 36, 40];
  const COL_WIDTHS = {
    1: 13.2, 2: 16.5, 3: 35.7, 4: 13.5, 5: 9.5,
    6: 7.8, 7: 7.8, 8: 9.0, 9: 9.3, 10: 15.2,
    11: 14.5, 12: 33.0, 13: 15.0, 14: 15.0, 15: 15.7,
    16: 21.3, 17: 15.5, 18: 16.5, 19: 15.5, 20: 17.0,
    21: 14.0, 22: 14.5, 23: 14.0, 24: 14.5, 25: 26.3,
    26: 15.5, 27: 16.5, 28: 15.5, 29: 14.5, 30: 15.5, 31: 42.0,
  };

  function xmlEsc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function colLetter(n) {
    let s = "";
    let v = n;
    while (v > 0) {
      const rem = (v - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      v = Math.floor((v - 1) / 26);
    }
    return s;
  }

  function buildStylesXml() {
    // Style indices (cellXfs) using numFmtId=0 (General) so Excel displays exact unrounded decimals:
    //  0: default
    //  1: Banner Title (24pt bold, center, #D9E1F2 fill, header border)
    //  2: Meta Label (18pt bold, left, cell border)
    //  3: Meta Value (16pt bold, left, cell border)
    //  4: Header (18pt bold, center, wrap, #EDF2F8 fill, header border)
    //  5: Sub-banner Row 7 (16pt bold, left, cell border)
    //  6: Body Center (14pt General)
    //  7: Body Left (14pt)
    //  8: Body Bold Left (14pt bold)
    //  9: Body Center Bordered (General)
    // 10: Inferred Highlight (General, #FFF9DB)
    // 11: Sum Row Label (14pt bold, center, header border)
    // 12: Sum Row Number (14pt bold, General, header border)
    // 13: Grand Label (18pt bold, right, header border)
    // 14: Grand Value (18pt bold, General, #92D050, header border)
    // 15: Footer Note (11pt bold red, left, wrap)
    // 16: Date formula yyyy-mm-dd
    // 17: Constant Label (11pt bold navy, #EEF2FF fill, wrap)
    // 18: Constant Value (13pt bold dark, #E0F2FE fill, center, General)
    // 19: Param Header Z..AE (11pt bold slate, #F1F5F9 fill, wrap, header border)
    // 20: Param Value Z..AD (11pt slate, center, General, thin border)
    // 21: Param Basis AE (11pt slate, left, thin border)
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/>
  </numFmts>
  <fonts count="10">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><sz val="24"/><name val="Calibri Light"/></font>
    <font><b/><sz val="18"/><name val="Calibri Light"/></font>
    <font><b/><sz val="16"/><name val="Calibri Light"/></font>
    <font><sz val="14"/><name val="Calibri Light"/></font>
    <font><b/><sz val="14"/><name val="Calibri Light"/></font>
    <font><b/><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><sz val="11"/><color rgb="FF334155"/><name val="Calibri"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F8"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF9DB"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFBFBFBF"/></left>
      <right style="thin"><color rgb="FFBFBFBF"/></right>
      <top style="thin"><color rgb="FFBFBFBF"/></top>
      <bottom style="thin"><color rgb="FFBFBFBF"/></bottom>
    </border>
    <border>
      <left style="thin"><color rgb="FFBFBFBF"/></left>
      <right style="thin"><color rgb="FFBFBFBF"/></right>
      <top style="medium"><color rgb="FF404040"/></top>
      <bottom style="medium"><color rgb="FF404040"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="22">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="5" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="166" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="8" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="7" fillId="8" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="9" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function cellStr(ref, val, styleIdx) {
    if (val === null || val === undefined || val === "") {
      return `<c r="${ref}" s="${styleIdx}"/>`;
    }
    return `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
  }

  function cellNum(ref, val, styleIdx) {
    return `<c r="${ref}" s="${styleIdx}"><v>${Number(val)}</v></c>`;
  }

  function cellFormula(ref, formula, cachedVal, styleIdx) {
    const clean = String(formula).startsWith("=") ? String(formula).slice(1) : String(formula);
    const vTag = cachedVal !== null && cachedVal !== undefined ? `<v>${Number(cachedVal)}</v>` : "";
    return `<c r="${ref}" s="${styleIdx}"><f>${xmlEsc(clean)}</f>${vTag}</c>`;
  }

  function cellStrFormula(ref, formula, cachedStr, styleIdx) {
    const clean = String(formula).startsWith("=") ? String(formula).slice(1) : String(formula);
    return `<c r="${ref}" s="${styleIdx}" t="str"><f>${xmlEsc(clean)}</f><v>${xmlEsc(cachedStr)}</v></c>`;
  }

  function buildDrawingXml(rowShapes) {
    const idGen = { n: 1, next() { return this.n++; } };
    const LINE_RGB = "1F4E79";

    function lineCxn(name, x, y, cx, cy, widthEmu = 25400) {
      const id = idGen.next();
      return `<xdr:cxnSp macro="">
        <xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="${xmlEsc(name)}"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>
        <xdr:spPr>
          <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.max(0, cx)}" cy="${Math.max(0, cy)}"/></a:xfrm>
          <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
          <a:ln w="${widthEmu}"><a:solidFill><a:srgbClr val="${LINE_RGB}"/></a:solidFill></a:ln>
        </xdr:spPr>
      </xdr:cxnSp>`;
    }

    function prstShape(name, prst, x, y, cx, cy, widthEmu = 25400) {
      const id = idGen.next();
      return `<xdr:sp macro="" textlink="">
        <xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xmlEsc(name)}"/><xdr:cNvSpPr/></xdr:nvSpPr>
        <xdr:spPr>
          <a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.max(1, cx)}" cy="${Math.max(1, cy)}"/></a:xfrm>
          <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
          <a:noFill/>
          <a:ln w="${widthEmu}"><a:solidFill><a:srgbClr val="${LINE_RGB}"/></a:solidFill></a:ln>
        </xdr:spPr>
      </xdr:sp>`;
    }

    function textboxAnchor(row0, cFrom, cFromOff, rFromOff, cTo, cToOff, rToOff, text, fontSz = 950) {
      const id = idGen.next();
      return `<xdr:twoCellAnchor>
        <xdr:from><xdr:col>${cFrom}</xdr:col><xdr:colOff>${cFromOff}</xdr:colOff><xdr:row>${row0}</xdr:row><xdr:rowOff>${rFromOff}</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>${cTo}</xdr:col><xdr:colOff>${cToOff}</xdr:colOff><xdr:row>${row0}</xdr:row><xdr:rowOff>${rToOff}</xdr:rowOff></xdr:to>
        <xdr:sp macro="" textlink="">
          <xdr:nvSpPr><xdr:cNvPr id="${id}" name="Label_${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>
          <xdr:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="450000" cy="180000"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            <a:noFill/><a:ln w="9525"><a:noFill/></a:ln>
          </xdr:spPr>
          <xdr:txBody>
            <a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="none" rtlCol="0" anchor="ctr"/>
            <a:lstStyle/>
            <a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-IN" sz="${fontSz}" b="1"><a:solidFill><a:srgbClr val="111827"/></a:solidFill></a:rPr><a:t>${xmlEsc(text)}</a:t></a:r></a:p>
          </xdr:txBody>
        </xdr:sp>
        <xdr:clientData/>
      </xdr:twoCellAnchor>`;
    }

    function groupAnchor(row0, cFrom, cFromOff, rFromOff, cTo, cToOff, rToOff, chW, chH, childrenXml) {
      const id = idGen.next();
      return `<xdr:twoCellAnchor>
        <xdr:from><xdr:col>${cFrom}</xdr:col><xdr:colOff>${cFromOff}</xdr:colOff><xdr:row>${row0}</xdr:row><xdr:rowOff>${rFromOff}</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>${cTo}</xdr:col><xdr:colOff>${cToOff}</xdr:colOff><xdr:row>${row0}</xdr:row><xdr:rowOff>${rToOff}</xdr:rowOff></xdr:to>
        <xdr:grpSp>
          <xdr:nvGrpSpPr><xdr:cNvPr id="${id}" name="ShapeGroup_${id}"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr>
          <xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${chW}" cy="${chH}"/><a:chOff x="0" y="0"/><a:chExt cx="${chW}" cy="${chH}"/></a:xfrm></xdr:grpSpPr>
          ${childrenXml}
        </xdr:grpSp>
        <xdr:clientData/>
      </xdr:twoCellAnchor>`;
    }

    const anchors = [];
    for (const [excelRow, spec] of rowShapes) {
      const row0 = excelRow - 1;
      const kind = spec.kind;
      const lbl = spec.labels || {};

      if (kind === "u_bar") {
        const w = 1500000, h = 320000;
        const lines = lineCxn("U_Left", 0, 0, 0, h) + lineCxn("U_Bot", 0, h, w, 0) + lineCxn("U_Right", w, 0, 0, h);
        anchors.push(groupAnchor(row0, 5, 160000, 120000, 8, 260000, 440000, w, h, lines));
        if (lbl.span) anchors.push(textboxAnchor(row0, 6, 120000, 180000, 7, 360000, 420000, lbl.span));
        if (lbl.leg) anchors.push(textboxAnchor(row0, 8, 120000, 80000, 8, 560000, 320000, lbl.leg));
      } else if (kind === "straight") {
        const w = 1550000, h = 20000;
        anchors.push(groupAnchor(row0, 5, 160000, 260000, 8, 280000, 280000, w, h, lineCxn("Straight_Bar", 0, 10000, w, 0)));
        if (lbl.text) anchors.push(textboxAnchor(row0, 5, 360000, 50000, 8, 160000, 250000, lbl.text, 900));
      } else if (kind === "l_bar") {
        const w = 280000, h = 340000;
        const lines = lineCxn("L_Vert", w, 0, 0, h) + lineCxn("L_Hook", 0, h, w, 0);
        anchors.push(groupAnchor(row0, 6, 260000, 60000, 7, 40000, 400000, w, h, lines));
        if (lbl.height) anchors.push(textboxAnchor(row0, 7, 50000, 80000, 8, 150000, 300000, lbl.height));
        if (lbl.ld) anchors.push(textboxAnchor(row0, 6, 40000, 340000, 7, 40000, 540000, lbl.ld));
      } else if (kind === "stirrup_rect") {
        const w = 880000, h = 450000;
        const shapes =
          prstShape("Tie_Body", "roundRect", 60000, 60000, w - 120000, h - 120000) +
          lineCxn("Tie_Hook1", 60000, 60000, 120000, 110000) +
          lineCxn("Tie_Hook2", 95000, 40000, 120000, 110000);
        anchors.push(groupAnchor(row0, 5, 340000, 140000, 7, 360000, 620000, w, h, shapes));
        if (lbl.a) anchors.push(textboxAnchor(row0, 6, 80000, 560000, 7, 200000, 780000, lbl.a));
        if (lbl.b) anchors.push(textboxAnchor(row0, 7, 350000, 260000, 8, 180000, 480000, lbl.b));
        if (lbl.hook) anchors.push(textboxAnchor(row0, 5, 160000, 40000, 6, 120000, 240000, lbl.hook, 850));
      } else if (kind === "center_link") {
        const w = 240000, h = 500000;
        const shapes =
          lineCxn("Center_Stem", 120000, 40000, 0, h - 80000) +
          prstShape("Center_ArcTop", "arc", 40000, 0, 80000, 80000) +
          prstShape("Center_ArcBot", "arc", 120000, h - 80000, 80000, 80000);
        anchors.push(groupAnchor(row0, 6, 220000, 150000, 6, 460000, 680000, w, h, shapes));
        if (lbl.a) anchors.push(textboxAnchor(row0, 6, 460000, 280000, 7, 280000, 500000, lbl.a));
        if (lbl.hook) anchors.push(textboxAnchor(row0, 5, 360000, 80000, 6, 220000, 260000, lbl.hook, 850));
      } else if (kind === "combined_loop") {
        const w = 1560000, h = 380000, hookW = 240000;
        const lines =
          lineCxn("CF_Bot", 0, h, w, 0) +
          lineCxn("CF_Left", 0, 0, 0, h) +
          lineCxn("CF_Right", w, 0, 0, h) +
          lineCxn("CF_TopL", 0, 0, hookW, 0) +
          lineCxn("CF_TopR", w - hookW, 0, hookW, 0) +
          lineCxn("CF_Mid", 0, 40000, w, 0);
        anchors.push(groupAnchor(row0, 5, 160000, 160000, 8, 280000, 560000, w, h, lines));
        if (lbl.span) anchors.push(textboxAnchor(row0, 6, 100000, 260000, 7, 360000, 500000, lbl.span));
        if (lbl.leg) anchors.push(textboxAnchor(row0, 8, 160000, 160000, 8, 560000, 420000, lbl.leg));
      } else if (kind === "chair") {
        const w = 1400000, h = 340000;
        const lines =
          lineCxn("Chair_FootL", 0, h, 300000, 0) +
          lineCxn("Chair_LegL", 300000, 0, 0, h) +
          lineCxn("Chair_Top", 300000, 0, 800000, 0) +
          lineCxn("Chair_LegR", 1100000, 0, 0, h) +
          lineCxn("Chair_FootR", 1100000, h, 300000, 0);
        anchors.push(groupAnchor(row0, 5, 220000, 220000, 8, 180000, 580000, w, h, lines));
      }
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  ${anchors.join("\n")}
</xdr:wsDr>`;
  }

  async function exportBbsXlsxBlob(rawDoc) {
    const doc = BbsCalculator.recalculateDocument(JSON.parse(JSON.stringify(rawDoc)));
    const st = doc.settings;
    const rowsXml = [];
    const merges = [
      "A1:Y1",
      "A2:B2", "C2:I2", "J2:K2", "L2:Q2",
      "A3:B3", "C3:I3", "J3:K3", "L3:N3", "P3:Q3",
      "A4:B4", "C4:I4", "J4:K4", "L4:M4",
      "F5:I6", "P5:X5", "Z5:AE5",
      "A5:A6", "B5:B6", "C5:C6", "D5:D6", "E5:E6",
      "J5:J6", "K5:K6", "L5:L6", "M5:M6", "N5:N6", "O5:O6", "Y5:Y6",
      "A7:Y7",
    ];

    const dataStartRow = 8;
    const lastDataRow = dataStartRow + Math.max(0, doc.rows.length - 1);
    const spacerRow = lastDataRow + 1;
    const sumRow = spacerRow + 1;
    const lblRow = sumRow + 1;
    const grandRow = lblRow + 1;
    const noteRow = grandRow + 1;

    function makeRow(rIdx, ht, cellsXml) {
      return `<row r="${rIdx}" ht="${ht}" customHeight="1">${cellsXml.join("")}</row>`;
    }

    // Row 1: Title
    {
      const cs = [cellStr("A1", "BAR BENDING SCHEDULE ", 1)];
      for (let c = 2; c <= 25; c++) cs.push(cellStr(`${colLetter(c)}1`, "", 1));
      rowsXml.push(makeRow(1, 49.9, cs));
    }

    const r2Const = { 18: ["Foot Cover", st.footing_cover_mm], 20: ["Col Cover", st.column_cover_mm], 22: ["Col Height", st.column_height_mm], 24: ["Vert. Ld", st.ld_vertical_mm] };
    const r3Const = { 15: ["SW Dowel", st.sw_dowel_mm], 18: ["Hook Mult", st.hook_mult], 20: ["Min Hook", st.hook_min_mm], 22: ["Unit Wt Div", st.unit_wt_divisor], 24: ["Kg/MT Scale", st.scale_divisor] };
    const r4Const = { 14: ["SW Inner Off", st.sw_inner_offset_mm], 18: ["CF1 SW Ht", st.shear_wall_ht_cf1_mm], 20: ["CF2 SW Ht", st.shear_wall_ht_cf2_mm], 22: ["Tie Div (>=16)", st.tie_step_div_ge16], 24: ["Tie Div (<16)", st.tie_step_div_lt16] };

    function pushConstCells(rIdx, cs, map) {
      for (let c = 1; c <= 25; c++) {
        if (map[c]) {
          cs.push(cellStr(`${colLetter(c)}${rIdx}`, map[c][0], 17));
        } else if (map[c - 1]) {
          cs.push(cellNum(`${colLetter(c)}${rIdx}`, map[c - 1][1], 18));
        }
      }
    }

    // Row 2: Project, Drawing No & Global Constants
    {
      const cs = [];
      for (let c = 1; c <= 25; c++) {
        const ref = `${colLetter(c)}2`;
        if (c === 1) cs.push(cellStr(ref, "Project:- ", 2));
        else if (c === 3) cs.push(cellStr(ref, doc.project_name, 3));
        else if (c === 10) cs.push(cellStr(ref, "Drawing No:- ", 2));
        else if (c === 12) cs.push(cellStr(ref, doc.drawing_no, 3));
        else if (c < 18) cs.push(cellStr(ref, "", c === 10 || c === 11 ? 2 : 3));
      }
      pushConstCells(2, cs, r2Const);
      rowsXml.push(makeRow(2, 38.45, cs));
    }

    // Row 3: Location, Date & Global Constants
    {
      const cs = [];
      for (let c = 1; c <= 25; c++) {
        const ref = `${colLetter(c)}3`;
        if (c === 1) cs.push(cellStr(ref, "Location: ", 2));
        else if (c === 3) cs.push(cellStr(ref, doc.location, 3));
        else if (c === 10) cs.push(cellStr(ref, "Date  ", 2));
        else if (c === 12) {
          if (doc.date_str) cs.push(cellStr(ref, doc.date_str, 3));
          else cs.push(`<c r="${ref}" s="16"><f>+TODAY()</f></c>`);
        } else if (c === 15) cs.push(cellStr(ref, "SW Dowel", 17));
        else if (c === 16) cs.push(cellNum(ref, st.sw_dowel_mm, 18));
        else if (c === 17) cs.push(cellStr(ref, "", 18));
        else if (c < 18) cs.push(cellStr(ref, "", c === 10 || c === 11 ? 2 : 3));
      }
      for (let c = 18; c <= 25; c++) {
        if (r3Const[c]) cs.push(cellStr(`${colLetter(c)}3`, r3Const[c][0], 17));
        else if (r3Const[c - 1]) cs.push(cellNum(`${colLetter(c)}3`, r3Const[c - 1][1], 18));
      }
      rowsXml.push(makeRow(3, 38.45, cs));
    }

    // Row 4: Structure, Mode & Global Constants
    {
      const cs = [];
      const modeStr = `${st.mode}${st.round_up_nos ? " (ROUNDUP)" : " (EXACT)"}`;
      for (let c = 1; c <= 25; c++) {
        const ref = `${colLetter(c)}4`;
        if (c === 1) cs.push(cellStr(ref, "Structure :", 2));
        else if (c === 3) cs.push(cellStr(ref, doc.structure, 3));
        else if (c === 10) cs.push(cellStr(ref, "Rule Mode", 2));
        else if (c === 12) cs.push(cellStr(ref, modeStr, 3));
        else if (c === 13) cs.push(cellStr(ref, "", 3));
        else if (r4Const[c]) cs.push(cellStr(ref, r4Const[c][0], 17));
        else if (r4Const[c - 1]) cs.push(cellNum(ref, r4Const[c - 1][1], 18));
        else cs.push(cellStr(ref, "", c === 10 || c === 11 ? 2 : 3));
      }
      rowsXml.push(makeRow(4, 38.45, cs));
    }

    // Rows 5 & 6: Main Headers + Parameter Headers Z..AE
    {
      const totalKgExact = BbsCalculator.formatExact(doc.total_weight_mt * Number(st.scale_divisor || 1000));
      const h5 = {
        1: "Sr.No", 2: "Bar Mark", 3: "Description", 4: "Span", 5: "Dia.", 6: "Shape",
        10: "Spacing", 11: "Nos.", 12: "MULTIPLE NO.", 13: "Total nos", 14: "Cut Length",
        15: "Coupler", 25: "Remark",
        26: "ROW REFERENCE CONSTANTS (EXCEL FORMULA INPUTS — EXCLUDED FROM A3 PRINT)",
      };
      const paramSub = {
        26: "Param Z\n(Depth / B)",
        27: "Param AA\n(Width / Dist)",
        28: "Param AB\n(Offset / Adj)",
        29: "Param AC\n(Qty / Units)",
        30: "Param AD\n(Layers / Const)",
        31: "Param AE\n(Formula Basis)",
      };
      const cs5 = [], cs6 = [];
      for (let c = 1; c <= 31; c++) {
        const ref5 = `${colLetter(c)}5`;
        const ref6 = `${colLetter(c)}6`;
        if (c === 16) {
          cs5.push(cellStrFormula(ref5, `"Total WT. IN KG. ("&(P${grandRow}*$Y$3)&")"`, `Total WT. IN KG. (${totalKgExact})`, 4));
        } else if (c <= 25) {
          cs5.push(cellStr(ref5, h5[c] || "", 4));
        } else {
          cs5.push(cellStr(ref5, h5[c] || "", 19));
        }

        if (c >= 16 && c <= 24) cs6.push(cellNum(ref6, DIAMETER_COLUMNS[c - 16], 4));
        else if (c <= 25) cs6.push(cellStr(ref6, "", 4));
        else cs6.push(cellStr(ref6, paramSub[c] || "", 19));
      }
      rowsXml.push(makeRow(5, 38.25, cs5));
      rowsXml.push(makeRow(6, 38.45, cs6));
    }

    // Row 7
    {
      const cs = [cellStr("A7", "Structure Name", 5)];
      for (let c = 2; c <= 25; c++) cs.push(cellStr(`${colLetter(c)}7`, "", 5));
      rowsXml.push(makeRow(7, 31.5, cs));
    }

    // Data rows starting at 8
    let curRow = dataStartRow;
    const firstTieRowByGroup = {};
    let curSrStart = null;
    const shapeRows = [];

    doc.rows.forEach((row, idx) => {
      const isTall = ["stirrup_rect", "center_link", "combined_loop", "chair"].includes(
        (row.shape && row.shape.kind) || ""
      );
      const ht = isTall ? 65.25 : 46.5;

      if (row.sr_no !== null && row.sr_no !== undefined) {
        if (curSrStart !== null && curRow - 1 > curSrStart) {
          merges.push(`A${curSrStart}:A${curRow - 1}`);
        }
        curSrStart = curRow;
      }

      if (String(row.description || "").includes("COL.TIES") && !(row.group_key in firstTieRowByGroup)) {
        firstTieRowByGroup[row.group_key] = curRow;
      }
      const firstTieR = firstTieRowByGroup[row.group_key] ?? null;

      const cs = [];
      if (row.sr_no !== null && row.sr_no !== undefined) cs.push(cellNum(`A${curRow}`, row.sr_no, 6));
      else cs.push(cellStr(`A${curRow}`, "", 6));

      cs.push(cellStr(`B${curRow}`, row.bar_mark, 7));
      cs.push(cellStr(`C${curRow}`, row.description, 8));

      const infStyle = row.inferred ? 10 : 6;
      const spanRes = BbsCalculator.resolveRowFormula(row.span_expr, idx, doc.rows, st, firstTieR);
      if (spanRes) cs.push(cellFormula(`D${curRow}`, spanRes.excelFormula, row.span_mm, infStyle));
      else cs.push(cellNum(`D${curRow}`, row.span_mm || 0, infStyle));

      cs.push(cellNum(`E${curRow}`, row.dia_mm, 6));
      for (let c = 6; c <= 9; c++) cs.push(cellStr(`${colLetter(c)}${curRow}`, "", 6));

      if (row.spacing_mm !== null && row.spacing_mm !== undefined && row.spacing_mm > 0) {
        cs.push(cellNum(`J${curRow}`, row.spacing_mm, 6));
      } else {
        cs.push(cellStr(`J${curRow}`, "", 6));
      }

      const nosRes = BbsCalculator.resolveRowFormula(row.nos_expr, idx, doc.rows, st, firstTieR);
      if (nosRes) cs.push(cellFormula(`K${curRow}`, nosRes.excelFormula, row.nos, infStyle));
      else cs.push(cellNum(`K${curRow}`, row.nos || 0, infStyle));

      const multRes = BbsCalculator.resolveRowFormula(row.multiple_expr, idx, doc.rows, st, firstTieR);
      if (multRes) cs.push(cellFormula(`L${curRow}`, multRes.excelFormula, row.multiple_no, infStyle));
      else cs.push(cellNum(`L${curRow}`, row.multiple_no || 0, infStyle));

      cs.push(cellFormula(`M${curRow}`, `+L${curRow}*K${curRow}`, row.total_nos, 9));

      const cutStyle = row.inferred ? 10 : 9;
      const cutRes = BbsCalculator.resolveRowFormula(row.cut_length_expr, idx, doc.rows, st, firstTieR);
      if (cutRes) cs.push(cellFormula(`N${curRow}`, cutRes.excelFormula, row.cut_length_mm, cutStyle));
      else cs.push(cellNum(`N${curRow}`, row.cut_length_mm || 0, cutStyle));

      cs.push(cellNum(`O${curRow}`, row.coupler || 0, 6));

      for (let dIdx = 0; dIdx < DIAMETER_COLUMNS.length; dIdx++) {
        const colC = 16 + dIdx;
        const letCol = colLetter(colC);
        const ref = `${letCol}${curRow}`;
        const cached = Math.abs(DIAMETER_COLUMNS[dIdx] - Number(row.dia_mm)) < 1e-9 ? row.weight_kg : 0;
        const f = `IF($E${curRow}=${letCol}$6,$M${curRow},0)*($N${curRow}*$E${curRow}*$E${curRow}/($W$3*$Y$3))`;
        cs.push(cellFormula(ref, f, cached, 9));
      }

      cs.push(cellStr(`Y${curRow}`, row.remark || "", 7));

      // Row Reference Constants (Z..AE)
      const params = [row.param_z, row.param_aa, row.param_ab, row.param_ac, row.param_ad];
      params.forEach((pv, pIdx) => {
        const pRef = `${colLetter(26 + pIdx)}${curRow}`;
        if (pv !== null && pv !== undefined) cs.push(cellNum(pRef, pv, 20));
        else cs.push(cellStr(pRef, "", 20));
      });
      cs.push(cellStr(`AE${curRow}`, row.param_ae || "", 21));

      rowsXml.push(makeRow(curRow, ht, cs));
      if (row.shape && row.shape.kind) shapeRows.push([curRow, row.shape]);
      curRow++;
    });

    if (curSrStart !== null && curRow - 1 > curSrStart) {
      merges.push(`A${curSrStart}:A${curRow - 1}`);
    }

    rowsXml.push(makeRow(spacerRow, 24.0, []));
    merges.push(`A${sumRow}:C${sumRow}`);
    merges.push(`A${grandRow}:O${grandRow}`);
    merges.push(`P${grandRow}:X${grandRow}`);
    merges.push(`A${noteRow}:Y${noteRow}`);

    // Sum row
    {
      const cs = [];
      for (let c = 1; c <= 25; c++) {
        const letCol = colLetter(c);
        const ref = `${letCol}${sumRow}`;
        if (c === 1) cs.push(cellStr(ref, "Total Weight (MT)", 11));
        else if (c >= 16 && c <= 24) {
          const dia = DIAMETER_COLUMNS[c - 16];
          const mtVal = (doc.totals_by_dia_mt && doc.totals_by_dia_mt[dia]) || 0;
          cs.push(cellFormula(ref, `SUM(${letCol}${dataStartRow}:${letCol}${lastDataRow})/$Y$3`, mtVal, 12));
        } else cs.push(cellStr(ref, "", 11));
      }
      rowsXml.push(makeRow(sumRow, 48.0, cs));
    }

    // Dia label row
    {
      const cs = [];
      for (let c = 1; c <= 25; c++) {
        const ref = `${colLetter(c)}${lblRow}`;
        if (c >= 16 && c <= 24) {
          const dia = DIAMETER_COLUMNS[c - 16];
          cs.push(cellStr(ref, dia === 8 ? "8 mm" : `${dia}mm`, 6));
        } else cs.push(cellStr(ref, "", 6));
      }
      rowsXml.push(makeRow(lblRow, 36.0, cs));
    }

    // Grand total row
    {
      const cs = [];
      for (let c = 1; c <= 25; c++) {
        const ref = `${colLetter(c)}${grandRow}`;
        if (c === 1) cs.push(cellStr(ref, "Total Weight (MT)", 13));
        else if (c === 16) cs.push(cellFormula(ref, `SUM(P${sumRow}:X${sumRow})`, doc.total_weight_mt, 14));
        else cs.push(cellStr(ref, "", c >= 16 && c <= 24 ? 14 : 13));
      }
      rowsXml.push(makeRow(grandRow, 39.0, cs));
    }

    // Note row
    {
      const cs = [cellStr(`A${noteRow}`, doc.note_footer, 15)];
      rowsXml.push(makeRow(noteRow, 28.0, cs));
    }

    const colsXml = Object.entries(COL_WIDTHS)
      .map(([idx, w]) => `<col min="${idx}" max="${idx}" width="${w}" customWidth="1"/>`)
      .join("");
    const mergesXml = merges.map((m) => `<mergeCell ref="${m}"/>`).join("");

    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView showGridLines="1" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml.join("")}</sheetData>
  <mergeCells count="${merges.length}">${mergesXml}</mergeCells>
  <pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0.5" footer="0.5"/>
  <pageSetup orientation="landscape" paperSize="8" fitToHeight="0" fitToWidth="1"/>
  <drawing r:id="rIdDrawing1"/>
</worksheet>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <workbookPr/>
  <sheets><sheet name="FORMAT" sheetId="1" r:id="rId1"/></sheets>
  <definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">FORMAT!$A$1:$Y$${noteRow}</definedName></definedNames>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

    const wbRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const sheetRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;

    const zip = new global.JSZip();
    zip.file("[Content_Types].xml", contentTypesXml);
    zip.file("_rels/.rels", rootRelsXml);
    zip.file("xl/workbook.xml", workbookXml);
    zip.file("xl/_rels/workbook.xml.rels", wbRelsXml);
    zip.file("xl/styles.xml", buildStylesXml());
    zip.file("xl/worksheets/sheet1.xml", sheetXml);
    zip.file("xl/worksheets/_rels/sheet1.xml.rels", sheetRelsXml);
    zip.file("xl/drawings/drawing1.xml", buildDrawingXml(shapeRows));

    return zip.generateAsync({
      type: "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
    });
  }

  global.XlsxExporter = {
    exportBbsXlsxBlob,
  };
})(window);
