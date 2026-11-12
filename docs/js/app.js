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
  let showParams = false;
  let filterMode = "all";
  let searchQuery = "";
  let exportBusy = false;
  let popoverTimer = null;
  let popoverPinned = false;
  let firstTieRowMap = {};

  const $ = (id) => document.getElementById(id);
  const fmt = (v) => BbsCalculator.formatExact(v);

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
    const scale = Number((doc.settings && doc.settings.scale_divisor) || 1000);
    const totalKg = totalMt * scale;
    const inferredCount = (doc.rows || []).filter((r) => r.inferred).length;

    let html = `
      <div class="kpi highlight">
        <div class="lbl">
          <span>Grand Total Steel</span>
          <span style="display:inline-flex;align-items:center;gap:6px;">
            ${doc.rows.length} rows
            <button type="button" class="fx-btn" tabindex="-1" data-fx-kpi="grand" title="Inspect formula & exact sum">fx</button>
          </span>
        </div>
        <div class="val">${fmt(totalMt)} MT</div>
        <div class="sub mono">${fmt(totalKg)} kg • ${inferredCount} verify</div>
      </div>
    `;
    for (const d of dias) {
      const val = Number((doc.totals_by_dia_mt && doc.totals_by_dia_mt[d]) || 0);
      if (val > 0 || d <= 20) {
        const pct = totalMt > 0 ? Math.min(100, (val / totalMt) * 100) : 0;
        html += `
          <div class="kpi">
            <div class="lbl"><span>Ø ${d} mm</span><span>${fmt(pct)}%</span></div>
            <div class="val">${fmt(val)} MT</div>
            <div class="kpi-bar"><span style="width:${pct}%"></span></div>
          </div>
        `;
      }
    }
    $("kpiGrid").innerHTML = html;
  }

  function numInputOrDefault(id, fallback) {
    const raw = $(id).value;
    if (raw === "" || raw === null || raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function syncMetaFields() {
    if (!currentDoc) return;
    currentDoc.project_name = $("metaProject").value;
    currentDoc.drawing_no = $("metaDrawing").value;
    currentDoc.location = $("metaLocation").value;
    currentDoc.structure = $("metaStructure").value;
    const s = currentDoc.settings;
    s.footing_cover_mm = numInputOrDefault("setFootCov", 50);
    s.column_cover_mm = numInputOrDefault("setColCov", 40);
    s.column_height_mm = numInputOrDefault("setColHt", 4550);
    s.ld_vertical_mm = numInputOrDefault("setLdVert", 450);
    s.hook_mult = numInputOrDefault("setHookMult", 8);
    s.hook_min_mm = numInputOrDefault("setMinHook", 75);
    s.unit_wt_divisor = numInputOrDefault("setUnitWt", 162);
    s.scale_divisor = numInputOrDefault("setScaleDiv", 1000);
    s.sw_dowel_mm = numInputOrDefault("setSwDowel", 300);
    s.sw_inner_offset_mm = numInputOrDefault("setSwOff", 80);
    s.shear_wall_ht_cf1_mm = numInputOrDefault("setCf1Ht", 1650);
    s.shear_wall_ht_cf2_mm = numInputOrDefault("setCf2Ht", 3000);
    s.tie_step_div_ge16 = numInputOrDefault("setTieDiv16", 6);
    s.tie_step_div_lt16 = numInputOrDefault("setTieDivLt16", 5);
    s.mode = "strict_geometry";
    s.round_up_nos = $("setRoundUp").value === "true";
  }

  function buildFormulaDetails(idx, field) {
    if (!currentDoc || !currentDoc.rows[idx]) return null;
    const row = currentDoc.rows[idx];
    const st = currentDoc.settings;
    const excelR = 8 + idx;
    const ftR = firstTieRowMap[row.group_key] ?? null;
    const baseHeader = `${row.bar_mark || row.group_key || "Row"} — ${row.description}`;

    const paramParts = [];
    if (row.param_z !== null && row.param_z !== undefined) paramParts.push(`Z${excelR}=${fmt(row.param_z)}`);
    if (row.param_aa !== null && row.param_aa !== undefined) paramParts.push(`AA${excelR}=${fmt(row.param_aa)}`);
    if (row.param_ab !== null && row.param_ab !== undefined) paramParts.push(`AB${excelR}=${fmt(row.param_ab)}`);
    if (row.param_ac !== null && row.param_ac !== undefined) paramParts.push(`AC${excelR}=${fmt(row.param_ac)}`);
    if (row.param_ad !== null && row.param_ad !== undefined) paramParts.push(`AD${excelR}=${fmt(row.param_ad)}`);
    const basisNote = [paramParts.join(" • "), row.param_ae].filter(Boolean).join(" | ");

    const resolve = (expr) =>
      BbsCalculator.resolveRowFormula(expr, idx, currentDoc.rows, st, ftR);

    if (field === "span_mm") {
      const res = resolve(row.span_expr);
      if (res) {
        return {
          title: `Span • ${baseHeader}`,
          cellTag: `Col D${excelR}`,
          excelFormula: res.excelFormula,
          calculation: `${res.displayExpr} = ${fmt(row.span_mm)} mm`,
          basis: basisNote || "Live Excel cell formula",
        };
      }
      return {
        title: `Span • ${baseHeader}`,
        cellTag: `Col D${excelR}`,
        excelFormula: `Static input (${fmt(row.span_mm)})`,
        calculation: `Direct CAD / edited input = ${fmt(row.span_mm)} mm`,
        basis: basisNote || "Direct input value",
      };
    }

    if (field === "nos") {
      const res = resolve(row.nos_expr);
      if (res) {
        return {
          title: `Nos. per Member • ${baseHeader}`,
          cellTag: `Col K${excelR}`,
          excelFormula: res.excelFormula,
          calculation: `${res.displayExpr} = ${fmt(row.nos)}`,
          basis: basisNote || "Live spacing / length distribution",
        };
      }
      return {
        title: `Nos. per Member • ${baseHeader}`,
        cellTag: `Col K${excelR}`,
        excelFormula: `Static input (${fmt(row.nos)})`,
        calculation: `From schedule / manual entry = ${fmt(row.nos)}`,
        basis: basisNote || "Direct bar count input",
      };
    }

    if (field === "multiple_no") {
      const res = resolve(row.multiple_expr);
      if (res) {
        return {
          title: `Multiple No. • ${baseHeader}`,
          cellTag: `Col L${excelR}`,
          excelFormula: res.excelFormula,
          calculation: `${res.displayExpr} = ${fmt(row.multiple_no)}`,
          basis: basisNote || "Product of Qty × Layers",
        };
      }
      return {
        title: `Multiple No. • ${baseHeader}`,
        cellTag: `Col L${excelR}`,
        excelFormula: `Static input (${fmt(row.multiple_no)})`,
        calculation: `Direct multiplier = ${fmt(row.multiple_no)}`,
        basis: basisNote || "Direct multiplier entry",
      };
    }

    if (field === "total_nos") {
      return {
        title: `Total Nos • ${baseHeader}`,
        cellTag: `Col M${excelR}`,
        excelFormula: `=+L${excelR}*K${excelR}`,
        calculation: `${fmt(row.multiple_no)} × ${fmt(row.nos)} = ${fmt(row.total_nos)}`,
        basis: `L${excelR} (Mult) × K${excelR} (Nos)`,
      };
    }

    if (field === "cut_length_mm") {
      const res = resolve(row.cut_length_expr);
      if (res) {
        return {
          title: `Cut Length • ${baseHeader}`,
          cellTag: `Col N${excelR}`,
          excelFormula: res.excelFormula,
          calculation: `${res.displayExpr} = ${fmt(row.cut_length_mm)} mm`,
          basis: basisNote || "Live cut-length cell formula",
        };
      }
      return {
        title: `Cut Length • ${baseHeader}`,
        cellTag: `Col N${excelR}`,
        excelFormula: `Static input (${fmt(row.cut_length_mm)})`,
        calculation: `Direct manual value = ${fmt(row.cut_length_mm)} mm`,
        basis: basisNote || "Manual cut length input",
      };
    }

    if (field === "weight_kg") {
      const dIdx = BbsCalculator.DIAMETER_COLUMNS.indexOf(Math.round(Number(row.dia_mm)));
      const diaCol = dIdx >= 0 ? String.fromCharCode(80 + dIdx) : "P";
      const unitDiv = Number(st.unit_wt_divisor || 162);
      const scaleDiv = Number(st.scale_divisor || 1000);
      const lenM = Number(row.cut_length_mm || 0) / scaleDiv;
      const unitWt = (Number(row.dia_mm || 0) * Number(row.dia_mm || 0)) / unitDiv;
      return {
        title: `Steel Weight (kg) • ${baseHeader}`,
        cellTag: `Cols ${diaCol}${excelR}`,
        excelFormula: `=IF($E${excelR}=${diaCol}$6,$M${excelR},0)*($N${excelR}*$E${excelR}*$E${excelR}/($W$3*$Y$3))`,
        calculation: `${fmt(row.total_nos)} × (${fmt(row.cut_length_mm)} / ${fmt(scaleDiv)}) × (${fmt(row.dia_mm)}² / ${fmt(unitDiv)}) = ${fmt(row.total_nos)} × ${fmt(lenM)} m × ${fmt(unitWt)} kg/m = ${fmt(row.weight_kg)} kg`,
        basis: `$W$3=${fmt(unitDiv)} (D²/k) • $Y$3=${fmt(scaleDiv)} (mm/m & kg/MT)`,
      };
    }
    return null;
  }

  function buildKpiGrandDetails() {
    if (!currentDoc) return null;
    const sumRow = 8 + Math.max(0, currentDoc.rows.length - 1) + 2;
    const scale = Number((currentDoc.settings && currentDoc.settings.scale_divisor) || 1000);
    const terms = BbsCalculator.DIAMETER_COLUMNS
      .map((d) => ({ d, mt: Number((currentDoc.totals_by_dia_mt && currentDoc.totals_by_dia_mt[d]) || 0) }))
      .filter((x) => x.mt > 0);
    const expr = terms.length ? terms.map((x) => `${fmt(x.mt)}`).join(" + ") : "0";
    return {
      title: "Grand Total Steel Tonnage",
      cellTag: `Col P${sumRow + 2}`,
      excelFormula: `=SUM(P${sumRow}:X${sumRow})  [each col = SUM(col8:col${sumRow - 2})/$Y$3]`,
      calculation: `${expr} = ${fmt(currentDoc.total_weight_mt)} MT (${fmt(currentDoc.total_weight_mt * scale)} kg)`,
      basis: "Unrounded sum across all Ø columns in MT (1 MT = $Y$3 kg)",
    };
  }

  function positionPopover(anchorEl) {
    const pop = $("formulaPopover");
    const rect = anchorEl.getBoundingClientRect();
    const pad = 12;
    pop.classList.remove("hidden");
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = rect.right - pw;
    if (left < pad) left = rect.left;
    if (left + pw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pw - pad);
    let top = rect.bottom + 8;
    if (top + ph > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - ph - 8);
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  function showFormulaPopover(anchorEl, details, pin = false) {
    if (!details) return;
    if (popoverTimer) { clearTimeout(popoverTimer); popoverTimer = null; }
    popoverPinned = pin;
    const pop = $("formulaPopover");
    pop.innerHTML = `
      <div class="fp-head">
        <div class="fp-title">${escapeHtml(details.title)}</div>
        <span class="fp-cell-tag">${escapeHtml(details.cellTag)}</span>
      </div>
      <div class="fp-row">
        <span class="fp-lbl">Excel Formula</span>
        <code class="fp-code">${escapeHtml(details.excelFormula)}</code>
      </div>
      <div class="fp-row">
        <span class="fp-lbl">Exact Calculation (Unrounded)</span>
        <code class="fp-code fp-result">${escapeHtml(details.calculation)}</code>
      </div>
      <div class="fp-row">
        <span class="fp-meta">${escapeHtml(details.basis || "")}</span>
      </div>
    `;
    positionPopover(anchorEl);
  }

  function hideFormulaPopover(force = false) {
    if (!force && popoverPinned) return;
    if (popoverTimer) { clearTimeout(popoverTimer); popoverTimer = null; }
    popoverPinned = false;
    $("formulaPopover").classList.add("hidden");
  }

  function fxButtonHtml(idx, field, isDynamic = true) {
    return `<button type="button" class="fx-btn${isDynamic ? "" : " manual"}" tabindex="-1" data-fx-idx="${idx}" data-fx-field="${field}" aria-label="Show formula and exact calculation">fx</button>`;
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
    hideFormulaPopover(true);
    $("workspace").classList.remove("hidden");
    $("addRowBtn").disabled = false;
    $("togglePreviewBtn").disabled = false;
    updateExportButtonsState();

    const s = doc.settings;
    $("metaProject").value = doc.project_name || "";
    $("metaDrawing").value = doc.drawing_no || "";
    $("metaLocation").value = doc.location || "";
    $("metaStructure").value = doc.structure || "";
    $("setFootCov").value = fmt(s.footing_cover_mm);
    $("setColCov").value = fmt(s.column_cover_mm);
    $("setColHt").value = fmt(s.column_height_mm);
    $("setLdVert").value = fmt(s.ld_vertical_mm);
    $("setHookMult").value = fmt(s.hook_mult);
    $("setMinHook").value = fmt(s.hook_min_mm);
    $("setUnitWt").value = fmt(s.unit_wt_divisor ?? 162);
    $("setScaleDiv").value = fmt(s.scale_divisor ?? 1000);
    $("setSwDowel").value = fmt(s.sw_dowel_mm ?? 300);
    $("setSwOff").value = fmt(s.sw_inner_offset_mm ?? 80);
    $("setCf1Ht").value = fmt(s.shear_wall_ht_cf1_mm);
    $("setCf2Ht").value = fmt(s.shear_wall_ht_cf2_mm);
    $("setTieDiv16").value = fmt(s.tie_step_div_ge16 ?? 6);
    $("setTieDivLt16").value = fmt(s.tie_step_div_lt16 ?? 5);
    $("setMode").value = s.mode;
    $("setRoundUp").value = String(s.round_up_nos);

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

    firstTieRowMap = {};
    doc.rows.forEach((row, idx) => {
      if (String(row.description || "").includes("COL.TIES") && !(row.group_key in firstTieRowMap)) {
        firstTieRowMap[row.group_key] = 8 + idx;
      }
    });

    renderKpis(doc);
    $("rowCountLabel").textContent = doc.rows.length;
    $("verifyCountLabel").textContent = doc.rows.filter((r) => r.inferred).length;

    const tbody = $("bbsTbody");
    tbody.innerHTML = "";
    doc.rows.forEach((row, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.idx = String(idx);
      if (row.inferred) tr.classList.add("inferred");
      const pInput = (field, val) =>
        `<td class="num col-param"><input type="number" step="any" data-idx="${idx}" data-field="${field}" value="${val !== null && val !== undefined ? fmt(val) : ""}" style="width:76px"/></td>`;

      tr.innerHTML = `
        <td class="mono" style="text-align:center;font-weight:700;">${row.sr_no ?? ""}</td>
        <td><input type="text" data-idx="${idx}" data-field="bar_mark" value="${escapeHtml(row.bar_mark)}" style="min-width:115px"/></td>
        <td><input type="text" data-idx="${idx}" data-field="description" value="${escapeHtml(row.description)}" style="min-width:160px;font-weight:600"/>${row.inferred ? '<span class="badge-inf">verify</span>' : ""}</td>
        <td class="num"><div class="cell-fx"><input type="number" step="any" data-idx="${idx}" data-field="span_mm" value="${fmt(row.span_mm)}" style="width:94px"/>${fxButtonHtml(idx, "span_mm", Boolean(row.span_expr))}</div></td>
        <td class="num"><input type="number" step="any" data-idx="${idx}" data-field="dia_mm" value="${fmt(row.dia_mm)}" style="width:54px"/></td>
        <td class="shape-cell">${renderShapeSvg(row.shape)}</td>
        <td class="num"><input type="number" step="any" data-idx="${idx}" data-field="spacing_mm" value="${row.spacing_mm !== null && row.spacing_mm !== undefined ? fmt(row.spacing_mm) : ""}" style="width:62px"/></td>
        <td class="num"><div class="cell-fx"><input type="number" step="any" data-idx="${idx}" data-field="nos" value="${fmt(row.nos)}" style="width:94px"/>${fxButtonHtml(idx, "nos", Boolean(row.nos_expr))}</div></td>
        <td class="num"><div class="cell-fx"><input type="number" step="any" data-idx="${idx}" data-field="multiple_no" value="${fmt(row.multiple_no)}" style="width:66px"/>${fxButtonHtml(idx, "multiple_no", Boolean(row.multiple_expr))}</div></td>
        <td class="calc-cell"><div class="cell-fx"><span>${fmt(row.total_nos)}</span>${fxButtonHtml(idx, "total_nos", true)}</div></td>
        <td class="num"><div class="cell-fx"><input type="number" step="any" data-idx="${idx}" data-field="cut_length_mm" value="${fmt(row.cut_length_mm)}" style="width:94px"/>${fxButtonHtml(idx, "cut_length_mm", Boolean(row.cut_length_expr))}</div></td>
        <td class="calc-cell"><div class="cell-fx"><span>${fmt(row.weight_kg)}</span>${fxButtonHtml(idx, "weight_kg", true)}</div></td>
        <td><input type="text" data-idx="${idx}" data-field="remark" value="${escapeHtml(row.remark)}" style="min-width:100px"/></td>
        ${pInput("param_z", row.param_z)}
        ${pInput("param_aa", row.param_aa)}
        ${pInput("param_ab", row.param_ab)}
        ${pInput("param_ac", row.param_ac)}
        ${pInput("param_ad", row.param_ad)}
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
    } else if (field.startsWith("param_")) {
      row[field] = e.target.value === "" ? null : Number(e.target.value);
    } else {
      const val = e.target.value === "" ? null : Number(e.target.value);
      row[field] = val ?? 0;
      if (field === "span_mm") row.span_expr = null;
      if (field === "nos") row.nos_expr = null;
      if (field === "multiple_no") row.multiple_expr = null;
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
      showToast(`Parsed ${result.document.rows.length} BBS rows (${fmt(result.document.total_weight_mt)} MT).`, "success");
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
          multiple_expr: "=@SELF:AC*@SELF:AD",
          multiple_no: 1,
          total_nos: 12,
          cut_length_expr: "=(@SELF:Z-2*$S$2)+(@SELF:D-2*$S$2)+(@SELF:Z-2*$S$2)-(2*@SELF:E)",
          cut_length_mm: 3376,
          coupler: 0,
          weight_kg: 0,
          param_z: 650,
          param_aa: null,
          param_ab: null,
          param_ac: 1,
          param_ad: 1,
          param_ae: "Z=Depth(mm); AC=BoxQty; AD=Layers",
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

  // Event delegation for desktop hover & mobile tap on Formula Inspector fx badges
  document.addEventListener("pointerover", (e) => {
    const btn = e.target.closest("[data-fx-idx], [data-fx-kpi]");
    if (!btn || popoverPinned) return;
    const details = btn.dataset.fxKpi === "grand"
      ? buildKpiGrandDetails()
      : buildFormulaDetails(Number(btn.dataset.fxIdx), btn.dataset.fxField);
    showFormulaPopover(btn, details, false);
  });

  document.addEventListener("pointerout", (e) => {
    const btn = e.target.closest("[data-fx-idx], [data-fx-kpi]");
    if (!btn || popoverPinned) return;
    popoverTimer = setTimeout(() => hideFormulaPopover(false), 90);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fx-idx], [data-fx-kpi]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const details = btn.dataset.fxKpi === "grand"
        ? buildKpiGrandDetails()
        : buildFormulaDetails(Number(btn.dataset.fxIdx), btn.dataset.fxField);
      showFormulaPopover(btn, details, true);
      return;
    }
    if (!e.target.closest("#formulaPopover")) {
      hideFormulaPopover(true);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideFormulaPopover(true);
  });

  $("workspace").querySelectorAll(".const-input").forEach((inp) => {
    inp.addEventListener("change", () => {
      if (!currentDoc) return;
      const isModeChange = inp.id === "setMode";
      syncMetaFields();
      if (isModeChange && currentDoc.schedule && currentDoc.schedule.length > 0) {
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
        showToast(`Switched mode to ${currentDoc.settings.mode}.`, "info");
      } else {
        renderDocument(BbsCalculator.recalculateDocument(currentDoc), null);
        showToast("Sheet constant updated — UI & .xlsx formulas synced.", "info");
      }
    });
  });

  $("themeToggleBtn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  $("toggleParamsBtn").addEventListener("click", () => {
    showParams = !showParams;
    $("bbsTable").classList.toggle("show-params", showParams);
    $("toggleParamsBtn").textContent = showParams ? "Hide Z:AD Constants" : "Show Z:AD Constants";
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
    showToast("Started blank editable schedule. Add rows or edit constants/cells, then download .xlsx.", "info");
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
      multiple_expr: "=@SELF:AC*@SELF:AD",
      multiple_no: 1,
      total_nos: 1,
      cut_length_expr: "=@SELF:D",
      cut_length_mm: 1000,
      coupler: 0,
      weight_kg: 0,
      param_z: null,
      param_aa: null,
      param_ab: null,
      param_ac: 1,
      param_ad: 1,
      param_ae: "CutLen=@SELF:D; AC=Qty; AD=Layers",
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
