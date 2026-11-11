(function () {
  "use strict";

  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  }

  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  let currentDoc = null;
  let previewVisible = true;
  let filterMode = "all"; // "all" | "verify"
  let searchQuery = "";
  let exportBusy = false;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function showToast(message, tone = "info", timeoutMs = 4500) {
    const region = $("toastRegion");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = `toast ${tone}`;
    const span = document.createElement("span");
    span.textContent = message;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Dismiss notification");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => toast.remove());
    toast.appendChild(span);
    toast.appendChild(closeBtn);
    region.appendChild(toast);
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (toast.isConnected) toast.remove();
      }, timeoutMs);
    }
  }

  function initOriginCheck() {
    if (window.location.protocol === "file:") {
      $("fileOriginWarn").classList.remove("hidden");
    }
  }

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("bbs_theme", next);
    } catch (_) {}
    const icon = $("themeIcon");
    const label = $("themeLabel");
    if (!icon || !label) return;
    if (next === "dark") {
      label.textContent = "Light Mode";
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
    } else {
      label.textContent = "CAD Dark";
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
    }
  }

  function renderShapeSvg(shape) {
    const k = (shape && shape.kind) || "straight";
    const lbl = (shape && shape.labels) || {};
    if (k === "u_bar") {
      return `<svg width="122" height="30" viewBox="0 0 124 30">
        <polyline points="10,5 10,24 84,24 84,5" fill="none" stroke="#1e40af" stroke-width="2"/>
        <text x="47" y="20" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.span || "")}</text>
        <text x="89" y="16" font-size="9" fill="#0f172a">${escapeHtml(lbl.leg || "")}</text>
      </svg>`;
    }
    if (k === "combined_loop") {
      return `<svg width="122" height="32" viewBox="0 0 124 32">
        <polyline points="22,6 10,6 10,25 84,25 84,6 72,6" fill="none" stroke="#1e40af" stroke-width="2"/>
        <line x1="10" y1="9" x2="84" y2="9" stroke="#1e40af" stroke-width="1.3"/>
        <text x="47" y="21" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.span || "")}</text>
        <text x="89" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.leg || "")}</text>
      </svg>`;
    }
    if (k === "l_bar") {
      return `<svg width="122" height="30" viewBox="0 0 124 30">
        <polyline points="46,25 62,25 62,4" fill="none" stroke="#1e40af" stroke-width="2"/>
        <text x="68" y="15" font-size="9" fill="#0f172a">${escapeHtml(lbl.height || "")}</text>
        <text x="40" y="27" text-anchor="end" font-size="9" fill="#0f172a">${escapeHtml(lbl.ld || "")}</text>
      </svg>`;
    }
    if (k === "stirrup_rect") {
      return `<svg width="122" height="30" viewBox="0 0 124 30">
        <rect x="24" y="5" width="46" height="20" rx="4" fill="none" stroke="#1e40af" stroke-width="2"/>
        <line x1="24" y1="6" x2="32" y2="13" stroke="#1e40af" stroke-width="1.8"/>
        <line x1="27" y1="4" x2="35" y2="11" stroke="#1e40af" stroke-width="1.8"/>
        <text x="74" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.b || "")}</text>
        <text x="47" y="22" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.a || "")}</text>
      </svg>`;
    }
    if (k === "center_link") {
      return `<svg width="122" height="30" viewBox="0 0 124 30">
        <line x1="54" y1="5" x2="54" y2="25" stroke="#1e40af" stroke-width="2"/>
        <path d="M48,8 A4,4 0 0 1 54,5 M54,25 A4,4 0 0 0 60,22" fill="none" stroke="#1e40af" stroke-width="1.8"/>
        <text x="63" y="18" font-size="9" fill="#0f172a">${escapeHtml(lbl.a || "")}</text>
      </svg>`;
    }
    if (k === "chair") {
      return `<svg width="122" height="28" viewBox="0 0 124 28">
        <polyline points="20,22 36,22 36,7 86,7 86,22 102,22" fill="none" stroke="#1e40af" stroke-width="2"/>
      </svg>`;
    }
    return `<svg width="122" height="26" viewBox="0 0 124 26">
      <line x1="12" y1="18" x2="112" y2="18" stroke="#1e40af" stroke-width="2"/>
      <text x="62" y="13" text-anchor="middle" font-size="9" fill="#0f172a">${escapeHtml(lbl.text || "")}</text>
    </svg>`;
  }

  function renderAuditRow(label, countsObj) {
    if (!countsObj || Object.keys(countsObj).length === 0) return "";
    const chips = Object.entries(countsObj)
      .map(([k, v]) => `<span class="audit-chip">${escapeHtml(k)} ×${escapeHtml(v)}</span>`)
      .join("");
    return `<div class="audit-row"><span class="audit-lbl">${escapeHtml(label)}</span>${chips}</div>`;
  }

  function renderKpis(doc) {
    const dias = [8, 10, 12, 16, 20, 25, 32];
    const totalMt = Number(doc.total_weight_mt || 0);
    const totalKg = Math.round(totalMt * 1000).toLocaleString();
    const inferredCount = (doc.rows || []).filter((r) => r.inferred).length;

    let html = `
      <div class="kpi highlight">
        <div class="lbl">
          <span>Grand Total Steel</span>
          <span>${doc.rows.length} rows</span>
        </div>
        <div class="val">${totalMt.toFixed(3)} MT</div>
        <div class="sub">${totalKg} kg • ${inferredCount} verify</div>
      </div>
    `;
    for (const d of dias) {
      const val = Number((doc.totals_by_dia_mt && doc.totals_by_dia_mt[d]) || 0);
      if (val > 0 || d <= 20) {
        const pct = totalMt > 0 ? Math.min(100, (val / totalMt) * 100) : 0;
        html += `
          <div class="kpi">
            <div class="lbl"><span>Ø ${d} mm</span><span>${pct.toFixed(0)}%</span></div>
            <div class="val">${val.toFixed(3)} MT</div>
            <div class="kpi-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
          </div>
        `;
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

  function updateExportButtonsState() {
    const hasRows = Boolean(currentDoc && currentDoc.rows && currentDoc.rows.length > 0);
    $("exportBtn").disabled = !hasRows || exportBusy;
    $("shareBtn").disabled = !hasRows || exportBusy;
  }

  function applyGridFilter() {
    if (!currentDoc) return;
    const rows = Array.from($("bbsTbody").querySelectorAll("tr"));
    const q = searchQuery.trim().toLowerCase();
    let visible = 0;

    rows.forEach((tr) => {
      const idx = Number(tr.dataset.idx);
      const item = currentDoc.rows[idx];
      if (!item) return;
      const matchesVerify = filterMode !== "verify" || Boolean(item.inferred);
      const hay = `${item.bar_mark || ""} ${item.description || ""} ${item.remark || ""} ${item.dia_mm || ""}`.toLowerCase();
      const matchesQuery = !q || hay.includes(q);
      const show = matchesVerify && matchesQuery;
      tr.classList.toggle("hidden", !show);
      if (show) visible++;
    });

    const total = currentDoc.rows.length;
    const badge = $("visibleCountBadge");
    if (visible !== total) {
      badge.textContent = `${visible} of ${total} shown`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
    $("emptyFilterMsg").classList.toggle("hidden", !(total > 0 && visible === 0));
  }

  function renderDocument(doc, previewUrl) {
    currentDoc = doc;
    $("workspace").classList.remove("hidden");
    $("addRowBtn").disabled = false;
    $("togglePreviewBtn").disabled = false;
    updateExportButtonsState();

    $("metaProject").value = doc.project_name || "";
    $("metaDrawing").value = doc.drawing_no || "";
    $("metaLocation").value = doc.location || "";
    $("metaStructure").value = doc.structure || "";
    $("setFootCov").value = doc.settings.footing_cover_mm;
    $("setColCov").value = doc.settings.column_cover_mm;
    $("setColHt").value = doc.settings.column_height_mm;
    $("setMode").value = doc.settings.mode;
    $("setRoundUp").value = String(doc.settings.round_up_nos);

    if (typeof previewUrl === "string") {
      if (previewUrl.length > 0) {
        $("previewImg").src = previewUrl;
        $("previewImg").classList.remove("hidden");
        $("previewEmptyState").classList.add("hidden");
      } else {
        $("previewImg").removeAttribute("src");
        $("previewImg").classList.add("hidden");
        $("previewImg").classList.remove("zoomed");
        $("previewEmptyState").classList.remove("hidden");
      }
    }

    const st = doc.parse_stats || {};
    $("planStatsLabel").textContent = st.total_tokens ? `${st.total_tokens} CAD tokens` : "Manual Mode";
    $("planStatsLabel").classList.toggle("hidden", !st.total_tokens && (doc.schedule || []).length > 0);
    $("planAudit").innerHTML =
      renderAuditRow("Box Footings", st.box_counts) +
      renderAuditRow("Total Columns", st.total_col_counts) +
      renderAuditRow("Combined Footings", st.cf_counts);

    if (doc.warnings && doc.warnings.length > 0) {
      $("warnBox").classList.remove("hidden");
      $("warnBox").innerHTML =
        "<strong>Review Notes:</strong> " + doc.warnings.map((w) => `<div>• ${escapeHtml(w)}</div>`).join("");
    } else {
      $("warnBox").classList.add("hidden");
    }

    renderKpis(doc);
    $("rowCountLabel").textContent = doc.rows.length;
    $("verifyCountLabel").textContent = doc.rows.filter((r) => r.inferred).length;

    const tbody = $("bbsTbody");
    tbody.innerHTML = "";
    doc.rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.idx = String(idx);
      if (row.inferred) tr.classList.add("inferred");
      tr.innerHTML = `
        <td class="mono" style="text-align:center;font-weight:700;">${row.sr_no ?? ""}</td>
        <td><input type="text" data-idx="${idx}" data-field="bar_mark" value="${escapeHtml(row.bar_mark)}" style="min-width:115px"/></td>
        <td><input type="text" data-idx="${idx}" data-field="description" value="${escapeHtml(row.description)}" style="min-width:165px;font-weight:600"/>${row.inferred ? '<span class="badge-inf">verify</span>' : ""}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="span_mm" value="${Math.round(row.span_mm)}" style="width:74px"/></td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="dia_mm" value="${row.dia_mm}" style="width:54px"/></td>
        <td class="shape-cell">${renderShapeSvg(row.shape)}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="spacing_mm" value="${row.spacing_mm ?? ""}" style="width:62px"/></td>
        <td class="num"><input type="number" step="0.01" data-idx="${idx}" data-field="nos" value="${Number(row.nos.toFixed(3))}" style="width:70px"/></td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="multiple_no" value="${Number(row.multiple_no.toFixed(2))}" style="width:60px"/></td>
        <td class="calc-cell">${Number(row.total_nos.toFixed(2))}</td>
        <td class="num"><input type="number" step="1" data-idx="${idx}" data-field="cut_length_mm" value="${Math.round(row.cut_length_mm)}" style="width:76px"/></td>
        <td class="calc-cell">${row.weight_kg.toFixed(3)}</td>
        <td><input type="text" data-idx="${idx}" data-field="remark" value="${escapeHtml(row.remark)}" style="min-width:105px"/></td>
        <td><button type="button" class="del-btn" data-del="${idx}" title="Remove row" aria-label="Remove row">×</button></td>
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

    applyGridFilter();
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

  function updateSelectedFileBadge(file) {
    const badge = $("selectedFileBadge");
    if (!file) {
      badge.classList.add("hidden");
      badge.textContent = "";
      return;
    }
    const mb = file.size >= 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    badge.textContent = `Selected: ${file.name} (${mb})`;
    badge.classList.remove("hidden");
  }

  async function parseFile(file) {
    if (window.location.protocol === "file:") {
      showToast("PDF parsing requires HTTP/HTTPS (GitHub Pages or local HTTP server), not file://.", "error", 7000);
      return;
    }
    const btn = $("parseBtn");
    btn.disabled = true;
    btn.textContent = "Parsing PDF...";
    updateSelectedFileBadge(file);
    try {
      const buf = await file.arrayBuffer();
      const baseSettings = {
        mode: $("uploadMode").value,
        round_up_nos: $("uploadRoundUp").checked,
      };
      const result = await PdfBbsParser.parseBbsPdfBytes(buf, baseSettings);
      filterMode = "all";
      searchQuery = "";
      $("gridSearch").value = "";
      $("filterAllBtn").classList.add("active");
      $("filterVerifyBtn").classList.remove("active");
      renderDocument(result.document, result.preview_image);
      showToast(`Parsed ${result.document.rows.length} BBS rows (${result.document.total_weight_mt.toFixed(3)} MT).`, "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to parse PDF: " + (err.message || err), "error", 6500);
    } finally {
      btn.disabled = false;
      btn.textContent = "Parse PDF";
    }
  }

  function createBlankDocument() {
    const settings = BbsCalculator.defaultSettings({
      mode: $("uploadMode").value,
      round_up_nos: $("uploadRoundUp").checked,
    });
    const doc = {
      project_name: "NEW PROJECT",
      drawing_no: "BBS_01",
      location: "SITE",
      date_str: "",
      structure: "Footing & Column Schedule",
      note_footer:
        "NOTE :-Wastages, Lap length are not considered in BBS & hence quantity " +
        "may increase by 5-10% at site. Further, sample of each cutting length " +
        "to be strictly checked & verified at site before processing forward.",
      settings,
      schedule: [],
      rows: [
        {
          id: "manual_starter_1",
          sr_no: 1,
          group_key: "C1",
          bar_mark: "C1 Footing",
          description: "LONG LOWER",
          span_expr: null,
          span_mm: 2400,
          dia_mm: 12,
          shape: { kind: "u_bar", labels: { span: "2300", leg: "550" } },
          spacing_mm: 150,
          nos_expr: null,
          nos: 12,
          multiple_no: 1,
          total_nos: 12,
          cut_length_expr: null,
          cut_length_mm: 3376,
          coupler: 0,
          weight_kg: 0,
          remark: "Manual starter row",
          inferred: false,
          source_note: "Manual starter",
        },
      ],
      warnings: [],
      parse_stats: {},
      totals_by_dia_mt: {},
      total_weight_mt: 0,
    };
    return BbsCalculator.recalculateDocument(doc);
  }

  function safeFilename() {
    const base = (currentDoc.drawing_no || "BBS").replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "BBS";
    return `${base}_BBS.xlsx`;
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function runExport(preferShare) {
    if (!currentDoc || currentDoc.rows.length === 0 || exportBusy) return;
    syncMetaFields();
    exportBusy = true;
    updateExportButtonsState();
    const exportLbl = $("exportBtn").querySelector("span");
    const shareLbl = $("shareBtn").querySelector("span");
    const prevExportText = exportLbl.textContent;
    const prevShareText = shareLbl.textContent;
    if (preferShare) shareLbl.textContent = "Preparing...";
    else exportLbl.textContent = "Generating...";

    try {
      const blob = await XlsxExporter.exportBbsXlsxBlob(currentDoc);
      const filename = safeFilename();
      if (preferShare) {
        const file = new File([blob], filename, {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            showToast(`Shared ${filename}.`, "success");
            return;
          } catch (err) {
            if (err && err.name === "AbortError") return;
          }
        }
      }
      triggerBlobDownload(blob, filename);
      showToast(`Downloaded ${filename}.`, "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to generate .xlsx: " + (err.message || err), "error", 6500);
    } finally {
      exportBusy = false;
      exportLbl.textContent = prevExportText;
      shareLbl.textContent = prevShareText;
      updateExportButtonsState();
    }
  }

  $("themeToggleBtn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  $("parseBtn").addEventListener("click", () => {
    const file = $("pdfInput").files[0];
    if (!file) {
      showToast("Please choose a structural PDF file first.", "warn");
      return;
    }
    parseFile(file);
  });

  $("pdfInput").addEventListener("change", () => {
    const file = $("pdfInput").files[0];
    if (file) parseFile(file);
  });

  $("blankBtn").addEventListener("click", () => {
    filterMode = "all";
    searchQuery = "";
    $("gridSearch").value = "";
    $("filterAllBtn").classList.add("active");
    $("filterVerifyBtn").classList.remove("active");
    renderDocument(createBlankDocument(), "");
    showToast("Started blank editable schedule. Add rows or edit any cell, then download .xlsx.", "info");
  });

  $("rebuildBtn").addEventListener("click", () => {
    if (!currentDoc) return;
    syncMetaFields();
    if (!currentDoc.schedule || currentDoc.schedule.length === 0) {
      renderDocument(BbsCalculator.recalculateDocument(currentDoc), null);
      showToast("Recalculated manual rows (no extracted PDF schedule to rebuild from).", "info");
      return;
    }
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
    showToast("Rebuilt BBS rows using updated rule settings.", "success");
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

  $("filterAllBtn").addEventListener("click", () => {
    filterMode = "all";
    $("filterAllBtn").classList.add("active");
    $("filterVerifyBtn").classList.remove("active");
    applyGridFilter();
  });

  $("filterVerifyBtn").addEventListener("click", () => {
    filterMode = "verify";
    $("filterVerifyBtn").classList.add("active");
    $("filterAllBtn").classList.remove("active");
    applyGridFilter();
  });

  $("gridSearch").addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    applyGridFilter();
  });

  $("clearFilterBtn").addEventListener("click", () => {
    filterMode = "all";
    searchQuery = "";
    $("gridSearch").value = "";
    $("filterAllBtn").classList.add("active");
    $("filterVerifyBtn").classList.remove("active");
    applyGridFilter();
  });

  $("exportBtn").addEventListener("click", () => runExport(false));
  $("shareBtn").addEventListener("click", () => runExport(true));

  $("togglePreviewBtn").addEventListener("click", () => {
    previewVisible = !previewVisible;
    $("previewPane").classList.toggle("hidden", !previewVisible);
    $("splitPane").classList.toggle("preview-hidden", !previewVisible);
    $("togglePreviewBtn").textContent = previewVisible ? "Hide Preview" : "Show Preview";
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

  applyTheme(document.documentElement.dataset.theme || "light");
  initOriginCheck();
})();
