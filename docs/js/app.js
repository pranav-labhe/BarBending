(function () {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  let currentDoc = null;
  let previewVisible = true;
  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderShapeSvg(shape) {
    const k = (shape && shape.kind) || "straight";
    const lbl = (shape && shape.labels) || {};
    if (k === "u_bar") {
      return `<svg width="110" height="30" viewBox="0 0 110 30">
        <polyline points="12,5 12,24 94,24 94,5" fill="none" stroke="#1e40af" stroke-width="2"/>
        <text x="53" y="20" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.span || "")}</text>
        <text x="98" y="16" font-size="9" fill="#0f172a">${escapeHtml(lbl.leg || "")}</text>
      </svg>`;
    }
    if (k === "combined_loop") {
      return `<svg width="110" height="32" viewBox="0 0 110 32">
        <polyline points="24,6 10,6 10,25 96,25 96,6 82,6" fill="none" stroke="#1e40af" stroke-width="2"/>
        <line x1="10" y1="9" x2="96" y2="9" stroke="#1e40af" stroke-width="1.3"/>
        <text x="53" y="21" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.span || "")}</text>
        <text x="99" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.leg || "")}</text>
      </svg>`;
    }
    if (k === "l_bar") {
      return `<svg width="110" height="30" viewBox="0 0 110 30">
        <polyline points="42,25 58,25 58,4" fill="none" stroke="#1e40af" stroke-width="2"/>
        <text x="64" y="15" font-size="9" fill="#0f172a">${escapeHtml(lbl.height || "")}</text>
        <text x="36" y="27" text-anchor="end" font-size="9" fill="#0f172a">${escapeHtml(lbl.ld || "")}</text>
      </svg>`;
    }
    if (k === "stirrup_rect") {
      return `<svg width="110" height="30" viewBox="0 0 110 30">
        <rect x="24" y="5" width="46" height="20" rx="4" fill="none" stroke="#1e40af" stroke-width="2"/>
        <line x1="24" y1="6" x2="32" y2="13" stroke="#1e40af" stroke-width="1.8"/>
        <line x1="27" y1="4" x2="35" y2="11" stroke="#1e40af" stroke-width="1.8"/>
        <text x="74" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.b || "")}</text>
        <text x="47" y="22" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.a || "")}</text>
      </svg>`;
    }
    if (k === "center_link") {
      return `<svg width="110" height="30" viewBox="0 0 110 30">
        <line x1="50" y1="5" x2="50" y2="25" stroke="#1e40af" stroke-width="2"/>
        <path d="M44,8 A4,4 0 0 1 50,5 M50,25 A4,4 0 0 0 56,22" fill="none" stroke="#1e40af" stroke-width="1.8"/>
        <text x="58" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.a || "")}</text>
      </svg>`;
    }
    if (k === "chair") {
      return `<svg width="110" height="28" viewBox="0 0 110 28">
        <polyline points="14,22 30,22 30,7 78,7 78,22 94,22" fill="none" stroke="#1e40af" stroke-width="2"/>
      </svg>`;
    }
    return `<svg width="110" height="26" viewBox="0 0 110 26">
      <line x1="10" y1="18" x2="100" y2="18" stroke="#1e40af" stroke-width="2"/>
      <text x="55" y="13" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.text || "")}</text>
    </svg>`;
  }

  function renderKpis(doc) {
    const dias = [8, 10, 12, 16, 20, 25, 32];
    let html = `
      <div class="kpi highlight">
        <div class="lbl">Grand Total Weight</div>
        <div class="val">${doc.total_weight_mt.toFixed(3)} MT (${Math.round(doc.total_weight_mt * 1000).toLocaleString()} kg)</div>
      </div>
    `;
    for (const d of dias) {
      const val = (doc.totals_by_dia_mt && doc.totals_by_dia_mt[d]) || 0;
      if (val > 0 || d <= 20) {
        html += `<div class="kpi"><div class="lbl">${d} mm</div><div class="val">${val.toFixed(3)} MT</div></div>`;
      }
    }
    $("kpiGrid").innerHTML = html;
  }

  function syncMetaFields() {
    if (!currentDoc) return;
    currentDoc.project_name = $("metaProject").value;
    currentDoc.drawing_no = $("metaDrawing").value;
    currentDoc.location = $("metaLocation").value;
    currentDoc.structure = $("metaStructure").value;
    currentDoc.settings.footing_cover_mm = Number($("setFootCov").value) || 50;
    currentDoc.settings.column_cover_mm = Number($("setColCov").value) || 40;
    currentDoc.settings.column_height_mm = Number($("setColHt").value) || 4550;
    currentDoc.settings.mode = $("setMode").value;
    currentDoc.settings.round_up_nos = $("setRoundUp").value === "true";
  }

  function renderDocument(doc, previewUrl) {
    currentDoc = doc;
    $("workspace").classList.remove("hidden");
    $("exportBtn").disabled = false;
    $("shareBtn").disabled = false;
    $("addRowBtn").disabled = false;
    $("togglePreviewBtn").disabled = false;

    $("metaProject").value = doc.project_name || "";
    $("metaDrawing").value = doc.drawing_no || "";
    $("metaLocation").value = doc.location || "";
    $("metaStructure").value = doc.structure || "";
    $("setFootCov").value = doc.settings.footing_cover_mm;
    $("setColCov").value = doc.settings.column_cover_mm;
    $("setColHt").value = doc.settings.column_height_mm;
    $("setMode").value = doc.settings.mode;
    $("setRoundUp").value = String(doc.settings.round_up_nos);

    if (previewUrl) $("previewImg").src = previewUrl;

    const st = doc.parse_stats || {};
    $("planStatsLabel").textContent = st.total_tokens ? `${st.total_tokens} CAD tokens` : "";
    if (st.box_counts || st.cf_counts) {
      $("planAudit").innerHTML =
        `<div><strong>Box Footings:</strong> ${escapeHtml(JSON.stringify(st.box_counts || {}))}</div>` +
        `<div><strong>Total Columns:</strong> ${escapeHtml(JSON.stringify(st.total_col_counts || {}))}</div>` +
        `<div><strong>Combined Footings:</strong> ${escapeHtml(JSON.stringify(st.cf_counts || {}))}</div>`;
    }

    if (doc.warnings && doc.warnings.length > 0) {
      $("warnBox").classList.remove("hidden");
      $("warnBox").innerHTML =
        "<strong>Review Notes:</strong> " + doc.warnings.map((w) => `<div>• ${escapeHtml(w)}</div>`).join("");
    } else {
      $("warnBox").classList.add("hidden");
    }

    renderKpis(doc);
    $("rowCountLabel").textContent = doc.rows.length;

    const tbody = $("bbsTbody");
    tbody.innerHTML = "";
    doc.rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      if (row.inferred) tr.classList.add("inferred");
      tr.innerHTML = `
        <td style="text-align:center;font-weight:600;">${row.sr_no ?? ""}</td>
        <td><input type="text" data-idx="${idx}" data-field="bar_mark" value="${escapeHtml(row.bar_mark)}" style="min-width:115px"/></td>
        <td><input type="text" data-idx="${idx}" data-field="description" value="${escapeHtml(row.description)}" style="min-width:165px;font-weight:600"/>${row.inferred ? '<span class="badge-inf">verify</span>' : ""}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="span_mm" value="${Math.round(row.span_mm)}" style="width:74px"/></td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="dia_mm" value="${row.dia_mm}" style="width:54px"/></td>
        <td class="shape-cell">${renderShapeSvg(row.shape)}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="spacing_mm" value="${row.spacing_mm ?? ""}" style="width:62px"/></td>
        <td class="num"><input type="number" step="0.01" data-idx="${idx}" data-field="nos" value="${Number(row.nos.toFixed(3))}" style="width:70px"/></td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="multiple_no" value="${Number(row.multiple_no.toFixed(2))}" style="width:60px"/></td>
        <td style="text-align:right;font-weight:600;padding-right:8px;">${Number(row.total_nos.toFixed(2))}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="cut_length_mm" value="${Math.round(row.cut_length_mm)}" style="width:76px"/></td>
        <td style="text-align:right;font-weight:600;padding-right:8px;">${row.weight_kg.toFixed(3)}</td>
        <td><input type="text" data-idx="${idx}" data-field="remark" value="${escapeHtml(row.remark)}" style="min-width:105px"/></td>
        <td><button type="button" class="del-btn" data-del="${idx}" title="Remove row" style="padding:3px 8px;color:#b91c1c;">×</button></td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", onCellEdit));
    tbody.querySelectorAll(".del-btn").forEach((btn) =>
      btn.addEventListener("click", () => {
        currentDoc.rows.splice(Number(btn.dataset.del), 1);
        renderDocument(BbsCalculator.recalculateDocument(currentDoc), null);
      })
    );
  }

  function onCellEdit(e) {
    const idx = Number(e.target.dataset.idx);
    const field = e.target.dataset.field;
    const row = currentDoc.rows[idx];
    if (!row) return;

    if (field === "bar_mark" || field === "description" || field === "remark") {
      row[field] = e.target.value;
    } else {
      const val = e.target.value === "" ? null : Number(e.target.value);
      row[field] = val ?? 0;
      if (field === "span_mm") row.span_expr = null;
      if (field === "nos") row.nos_expr = null;
      if (field === "cut_length_mm") row.cut_length_expr = null;
    }
    syncMetaFields();
    renderDocument(BbsCalculator.recalculateDocument(currentDoc), null);
  }

  async function parseFile(file) {
    const btn = $("parseBtn");
    btn.disabled = true;
    btn.textContent = "Parsing PDF...";
    try {
      const buf = await file.arrayBuffer();
      const baseSettings = {
        mode: $("uploadMode").value,
        round_up_nos: $("uploadRoundUp").checked,
      };
      const result = await PdfBbsParser.parseBbsPdfBytes(buf, baseSettings);
      renderDocument(result.document, result.preview_image);
    } catch (err) {
      alert("Failed to parse PDF: " + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = "Parse PDF";
    }
  }

  $("parseBtn").addEventListener("click", () => {
    const file = $("pdfInput").files[0];
    if (!file) {
      alert("Please choose a PDF file first.");
      return;
    }
    parseFile(file);
  });

  $("pdfInput").addEventListener("change", () => {
    const file = $("pdfInput").files[0];
    if (file) parseFile(file);
  });

  $("rebuildBtn").addEventListener("click", () => {
    if (!currentDoc) return;
    syncMetaFields();
    const rebuilt = BbsCalculator.buildBbsDocument(
      {
        project_name: currentDoc.project_name,
        drawing_no: currentDoc.drawing_no,
        location: currentDoc.location,
        structure: currentDoc.structure,
      },
      currentDoc.schedule,
      currentDoc.settings,
      currentDoc.warnings,
      currentDoc.parse_stats,
      currentDoc.date_str
    );
    renderDocument(rebuilt, null);
  });

  $("addRowBtn").addEventListener("click", () => {
    if (!currentDoc) return;
    currentDoc.rows.push({
      id: "custom_" + Date.now(),
      sr_no: null,
      group_key: "CUSTOM",
      bar_mark: "Custom",
      description: "EXTRA BAR",
      span_expr: null,
      span_mm: 1000,
      dia_mm: 12,
      shape: { kind: "straight", labels: { text: "Custom" } },
      spacing_mm: null,
      nos_expr: null,
      nos: 1,
      multiple_no: 1,
      total_nos: 1,
      cut_length_expr: null,
      cut_length_mm: 1000,
      coupler: 0,
      weight_kg: 0,
      remark: "",
      inferred: false,
      source_note: "Manual row",
    });
    renderDocument(BbsCalculator.recalculateDocument(currentDoc), null);
  });

  function safeFilename() {
    const base = (currentDoc.drawing_no || "BBS").replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "BBS";
    return `${base}_BBS.xlsx`;
  }

  $("exportBtn").addEventListener("click", async () => {
    if (!currentDoc) return;
    syncMetaFields();
    const blob = await XlsxExporter.exportBbsXlsxBlob(currentDoc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  $("shareBtn").addEventListener("click", async () => {
    if (!currentDoc) return;
    syncMetaFields();
    const blob = await XlsxExporter.exportBbsXlsxBlob(currentDoc);
    const filename = safeFilename();
    const file = new File([blob], filename, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    // Fallback to standard download if Web Share file sharing isn't supported
    $("exportBtn").click();
  });

  $("togglePreviewBtn").addEventListener("click", () => {
    previewVisible = !previewVisible;
    $("previewPane").classList.toggle("hidden", !previewVisible);
    $("splitPane").classList.toggle("preview-hidden", !previewVisible);
    $("togglePreviewBtn").textContent = previewVisible ? "Hide Drawing Preview" : "Show Drawing Preview";
  });

  $("previewImg").addEventListener("click", () => {
    $("previewImg").classList.toggle("zoomed");
  });

  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  });
})();
