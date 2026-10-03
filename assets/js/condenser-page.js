/* ============================================================
   SAA Comfort Air LLC — Condenser page (Round 93, 2026-10-03)
   Two tabs: Worksheet (rendered by the page's own script) and the
   editable Condenser Price List below. The price list is the Supabase
   table condenser_prices (condenser-db.js); the worksheet's Brand /
   Tonnage / Stage dropdowns and its "Condenser unit" Unit $ read it, and
   so does the Create Quote page -- so a price edited here is the price
   the next quote uses.
   ============================================================ */

(function () {
  let rows = []; // full list incl. N/A rows, ordered

  const $ = (id) => document.getElementById(id);
  const money = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toFixed(2));
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  function status(msg, bad) {
    const el = $("cp-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = bad ? "var(--danger,#b3261e)" : "";
  }

  /* ---------- tabs ---------- */
  function showTab(tab) {
    document.querySelectorAll("#cond-tabs .cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("cond-panel-worksheet").hidden = tab !== "worksheet";
    $("cond-panel-prices").hidden = tab !== "prices";
    // The price list may have been edited -- re-read it into the worksheet.
    if (tab === "worksheet" && window.saaCondenserWorksheetRefresh) window.saaCondenserWorksheetRefresh();
  }
  document.querySelectorAll("#cond-tabs .cal-view-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  /* ---------- price list table ---------- */
  function brandsInOrder() {
    return rows.map((r) => r.brand).filter((v, i, a) => a.indexOf(v) === i);
  }

  function renderBrandControls() {
    const brands = brandsInOrder();
    const adj = $("cp-adj-brand");
    const keep = adj.value;
    adj.innerHTML = `<option value="">All brands</option>` + brands.map((b) => `<option>${esc(b)}</option>`).join("");
    if (brands.includes(keep)) adj.value = keep;
    $("cp-brand-list").innerHTML = brands.map((b) => `<option value="${esc(b)}"></option>`).join("");
  }

  function renderTable() {
    const body = $("cp-body");
    let lastBrand = null;
    body.innerHTML = rows.map((r) => {
      const brandCell = r.brand !== lastBrand ? `<strong>${esc(r.brand)}</strong>` : `<span class="muted">${esc(r.brand)}</span>`;
      lastBrand = r.brand;
      return `<tr data-id="${esc(r.id)}"${r.price === null ? ' class="row-off"' : ""}>
        <td>${brandCell}</td>
        <td>${r.tonnage} ton</td>
        <td>${esc(r.stage)}</td>
        <td class="num"><input type="number" step="0.01" min="0" class="cp-price" value="${money(r.price)}" placeholder="N/A" aria-label="Price for ${esc(r.brand)} ${r.tonnage} ton ${esc(r.stage)}" style="width:120px;text-align:right"></td>
        <td><button type="button" class="btn btn-ghost btn-sm cp-del" title="Delete this row" aria-label="Delete row">&times;</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" class="muted">No prices yet — add one below.</td></tr>`;
    renderBrandControls();
  }

  function syncShared() { saaCondenserSetLocalList(rows); }

  async function savePrice(tr, input) {
    const id = tr.dataset.id;
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const raw = input.value.trim();
    const val = raw === "" ? null : Number(raw);
    if (val !== null && (!isFinite(val) || val < 0)) { status("Enter a valid price.", true); input.value = money(row.price); return; }
    if ((row.price === null && val === null) || (row.price !== null && val !== null && Number(row.price) === val)) return;
    status("Saving…");
    const res = await saaCondenserUpdatePrice(id, val);
    if (!res.ok) { status("Could not save: " + res.error, true); input.value = money(row.price); return; }
    row.price = val;
    tr.classList.toggle("row-off", val === null);
    syncShared();
    status(`Saved ✓ ${row.brand} ${row.tonnage} ton ${row.stage}: ${val === null ? "N/A" : "$" + val.toFixed(2)}`);
  }

  $("cp-body").addEventListener("change", (e) => {
    const input = e.target.closest(".cp-price");
    if (input) savePrice(input.closest("tr"), input);
  });

  $("cp-body").addEventListener("click", async (e) => {
    const btn = e.target.closest(".cp-del");
    if (!btn) return;
    const tr = btn.closest("tr");
    const row = rows.find((r) => r.id === tr.dataset.id);
    if (!row) return;
    const ok = await saaConfirm(`Remove ${row.brand} ${row.tonnage} ton ${row.stage} from the Condenser Price List? It will no longer be offered in the worksheet dropdowns.`, { title: "Delete price", okLabel: "Delete" });
    if (!ok) return;
    const res = await saaCondenserDelete(row.id);
    if (!res.ok) { status("Could not delete: " + res.error, true); return; }
    rows = rows.filter((r) => r.id !== row.id);
    syncShared();
    renderTable();
    status("Deleted.");
  });

  /* ---------- adjust by % ---------- */
  $("cp-adj-btn").addEventListener("click", async () => {
    const pct = parseFloat($("cp-adj-pct").value);
    if (!isFinite(pct) || pct === 0) { status("Enter a percentage to adjust by (e.g. 3 or -2).", true); return; }
    const brand = $("cp-adj-brand").value;
    const targets = rows.filter((r) => r.price !== null && (!brand || r.brand === brand));
    if (!targets.length) { status("Nothing to adjust.", true); return; }
    const ok = await saaConfirm(`Change ${targets.length} price${targets.length === 1 ? "" : "s"} for ${brand || "all brands"} by ${pct > 0 ? "+" : ""}${pct}%?`, { title: "Adjust prices", okLabel: "Apply" });
    if (!ok) return;
    status("Saving…");
    let failed = 0;
    for (const r of targets) {
      const next = Math.round(r.price * (1 + pct / 100) * 100) / 100;
      const res = await saaCondenserUpdatePrice(r.id, next);
      if (res.ok) r.price = next; else failed++;
    }
    syncShared();
    renderTable();
    status(failed ? `Adjusted, but ${failed} row(s) could not be saved.` : `Saved ✓ ${targets.length} prices adjusted ${pct > 0 ? "+" : ""}${pct}%.`, !!failed);
    $("cp-adj-pct").value = "";
  });

  /* ---------- add row ---------- */
  $("cp-add-btn").addEventListener("click", async () => {
    const brand = $("cp-new-brand").value.trim();
    const ton = parseFloat($("cp-new-ton").value);
    const stage = $("cp-new-stage").value;
    const priceRaw = $("cp-new-price").value.trim();
    if (!brand || !isFinite(ton) || ton <= 0) { status("Enter a brand and tonnage.", true); return; }
    if (rows.some((r) => r.brand.toLowerCase() === brand.toLowerCase() && r.tonnage === ton && r.stage === stage)) {
      status("That brand / tonnage / stage is already on the list — edit its price instead.", true); return;
    }
    // Use the existing spelling/case of a brand that is already listed.
    const existing = brandsInOrder().find((b) => b.toLowerCase() === brand.toLowerCase());
    const res = await saaCondenserInsert({ brand: existing || brand, tonnage: ton, stage, price: priceRaw === "" ? null : priceRaw });
    if (!res.ok) { status("Could not add: " + res.error, true); return; }
    rows.push(res.row);
    syncShared();
    renderTable();
    $("cp-new-ton").value = ""; $("cp-new-price").value = "";
    status(`Added ${res.row.brand} ${res.row.tonnage} ton ${res.row.stage}.`);
  });

  /* ---------- Excel download ---------- */
  $("cp-download-btn").addEventListener("click", () => {
    const data = rows.map((r) => [r.brand, r.tonnage + "T", r.stage, r.price === null ? "" : r.price]);
    const flags = rows.map((r) => (r.price === null ? "mute" : null));
    saaXlsxDownload("SAA-condenser-price-list-" + saaXlsxStamp(), [{
      name: "Condenser Prices", tabColor: "C55A11",
      title: "SAA Comfort Air LLC — Condenser Price List",
      subtitle: "Generated " + saaXlsxTodayLabel() + "   |   " + rows.length + " combinations   |   Grey = N/A (not offered)",
      columns: [
        { header: "Brand", width: 16 }, { header: "Tonnage", width: 11, type: "center" },
        { header: "Stage", width: 16 }, { header: "Price", width: 14, type: "money" },
      ],
      rows: data, flags,
    }]);
  });

  /* ---------- load ---------- */
  async function init() {
    let fromDb = await saaCondenserFetchRows();
    if (fromDb && !fromDb.length) {
      // Empty table (first run): seed it with the factory default list.
      const seed = CONDENSER_PRICES_DEFAULT.map((r, i) => ({ brand: r.brand, tonnage: r.tonnage, stage: r.stage, price: r.price, sort_order: i + 1 }));
      const { error } = await _saaClient.from("condenser_prices").insert(seed);
      if (!error) fromDb = await saaCondenserFetchRows();
    }
    if (fromDb && fromDb.length) {
      rows = fromDb;
      saaCondenserSetLocalList(rows);
    } else {
      rows = CONDENSER_PRICES.map((r, i) => Object.assign({}, r, { id: "local-" + i }));
      status("Could not load the saved price list — showing the default prices (edits cannot be saved right now).", true);
    }
    renderTable();
  }
  init();
})();
