/* ============================================================
   SAA Comfort Air LLC — shared worksheet engine
   Renders editable line-item tables (mirroring the Excel sheets)
   and keeps their totals live. No build step, no dependencies.
   ============================================================ */

function fmtMoney(n) {
  n = Number(n) || 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Renders a range-priced line-item table (Qty x Low/High unit cost).
 * rows: [{ group, category, item, unit, qty, low, high, spec, notes, optional, tonnageLinked/tierLinked }]
 * opts: {
 *   linkedOptions: [{ tonnage|id, desc/label, low, high }]  // populates a picker for tonnageLinked/tierLinked rows
 *   linkedKind: 'tonnage' | 'tier'
 *   showGroupSubtotals: bool (default true if >1 distinct group)
 *   onTotals: fn(totals) -> totals = { byGroup: {G:{low,high}}, low, high }
 * }
 * returns { el, getTotals(), setLinkedValue(value) }
 */
function renderLineItemTable(mountEl, rows, opts) {
  opts = opts || {};
  const groups = [...new Set(rows.map(r => r.group || "MATERIALS"))];
  const showGroups = opts.showGroupSubtotals !== false && groups.length > 1;
  const linkedIdx = rows.findIndex(r => r.tonnageLinked || r.tierLinked);

  let linkedPicker = "";
  if (linkedIdx > -1 && opts.linkedOptions) {
    const optHtml = opts.linkedOptions.map((o, i) => {
      const val = opts.linkedKind === "tier" ? o.id : o.tonnage;
      const label = opts.linkedKind === "tier" ? o.label : `${o.tonnage} ton — ${o.desc} ($${o.low}–$${o.high})`;
      return `<option value="${val}"${i === 0 ? " selected" : ""}>${label}</option>`;
    }).join("");
    const pickLabel = opts.linkedKind === "tier" ? "Furnace tier" : "System tonnage";
    linkedPicker = `<div class="field" style="max-width:420px"><label>${pickLabel}</label>
      <select id="${mountEl.id}-linked">${optHtml}</select></div>`;
  }

  const rowsHtml = rows.map((r, i) => {
    const group = r.group || "MATERIALS";
    const optionalPill = r.optional ? `<span class="pill-optional">${r.optional}</span>` : "";
    const isLinked = (r.tonnageLinked || r.tierLinked) ? " data-linked-row" : "";
    const catCell = opts.editableText
      ? `<input type="text" class="cat-input" value="${r.category || ""}" style="width:100px">`
      : (showGroups ? `<span class="badge" style="margin-right:6px">${r.category || ""}</span>` : (r.category || ""));
    const itemCell = opts.editableText
      ? `<input type="text" class="item-input" value="${(r.item || "").replace(/"/g, "&quot;")}" style="width:100%;min-width:180px">`
      : `${r.item}${r.spec ? `<div class="spec">${r.spec}</div>` : ""}`;
    return `<tr data-row data-group="${group}" data-idx="${i}"${isLinked}>
      <td>${catCell}</td>
      <td class="item-name">${itemCell}</td>
      <td>${r.unit || ""}</td>
      <td><input type="number" step="any" class="qty" value="${r.qty}" aria-label="Quantity"></td>
      <td class="num"><input type="number" step="any" class="low" value="${r.low}" aria-label="Low unit cost"></td>
      <td class="num"><input type="number" step="any" class="high" value="${r.high}" aria-label="High unit cost"></td>
      <td class="num ext-low">${fmtMoney(r.qty * r.low)}</td>
      <td class="num ext-high">${fmtMoney(r.qty * r.high)}</td>
      <td>${optionalPill}</td>
    </tr>`;
  }).join("");

  const groupSubtotalsHtml = showGroups ? `<div class="totals-strip">` + groups.map(g => `
      <div class="total-box">
        <div class="label">${g} subtotal</div>
        <div class="value" style="font-size:1.1rem" data-subtotal-group="${g}" data-which="low">$0.00</div>
        <div class="muted" style="font-size:.82rem">to <span data-subtotal-group="${g}" data-which="high">$0.00</span> high</div>
      </div>`).join("") + `</div>` : "";

  const addRowBtn = opts.allowAddRow
    ? `<button type="button" class="btn btn-ghost btn-sm" id="${mountEl.id}-addrow" style="margin-top:10px">+ Add line item</button>`
    : "";

  mountEl.innerHTML = `
    ${linkedPicker}
    <div class="worksheet-wrap">
      <table class="worksheet">
        <thead><tr>
          <th>Category</th><th>Item</th><th>Unit</th><th>Qty</th>
          <th>Low Unit $</th><th>High Unit $</th><th>Low Ext.</th><th>High Ext.</th><th></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="6">Subtotal</td>
          <td class="num" data-total="low">$0.00</td>
          <td class="num" data-total="high">$0.00</td>
          <td></td>
        </tr></tfoot>
      </table>
    </div>
    ${groupSubtotalsHtml}
    ${addRowBtn}
  `;

  if (opts.allowAddRow) {
    mountEl.querySelector(`#${mountEl.id}-addrow`).addEventListener("click", () => {
      rows.push({ group: "MATERIALS", category: "", item: "New item — edit me", unit: "EA", qty: 1, low: 0, high: 0 });
      renderLineItemTable(mountEl, rows, opts);
    });
  }

  function recalc() {
    const totals = { byGroup: {}, low: 0, high: 0 };
    mountEl.querySelectorAll("tbody tr[data-row]").forEach(tr => {
      const qty = parseFloat(tr.querySelector(".qty").value) || 0;
      const low = parseFloat(tr.querySelector(".low").value) || 0;
      const high = parseFloat(tr.querySelector(".high").value) || 0;
      const extLow = qty * low, extHigh = qty * high;
      tr.querySelector(".ext-low").textContent = fmtMoney(extLow);
      tr.querySelector(".ext-high").textContent = fmtMoney(extHigh);
      if (opts.editableText) {
        const idx = parseInt(tr.dataset.idx, 10);
        const itemInput = tr.querySelector(".item-input");
        const catInput = tr.querySelector(".cat-input");
        if (rows[idx] && itemInput) rows[idx].item = itemInput.value;
        if (rows[idx] && catInput) rows[idx].category = catInput.value;
        if (rows[idx]) { rows[idx].qty = qty; rows[idx].low = low; rows[idx].high = high; }
      }
      const g = tr.dataset.group;
      totals.byGroup[g] = totals.byGroup[g] || { low: 0, high: 0 };
      totals.byGroup[g].low += extLow;
      totals.byGroup[g].high += extHigh;
      totals.low += extLow;
      totals.high += extHigh;
    });
    mountEl.querySelectorAll("[data-total]").forEach(el => {
      el.textContent = fmtMoney(el.dataset.total === "high" ? totals.high : totals.low);
    });
    mountEl.querySelectorAll("[data-subtotal-group]").forEach(el => {
      const t = totals.byGroup[el.dataset.subtotalGroup] || { low: 0, high: 0 };
      el.textContent = fmtMoney(el.dataset.which === "high" ? t.high : t.low);
    });
    if (opts.onTotals) opts.onTotals(totals);
    return totals;
  }

  mountEl.addEventListener("input", recalc);

  const linkedSelect = mountEl.querySelector(`#${mountEl.id}-linked`);
  if (linkedSelect && linkedIdx > -1) {
    linkedSelect.addEventListener("change", () => {
      const val = linkedSelect.value;
      const opt = opts.linkedOptions.find(o => String(opts.linkedKind === "tier" ? o.id : o.tonnage) === val);
      if (!opt) return;
      const tr = mountEl.querySelector("tr[data-linked-row]");
      tr.querySelector(".low").value = opt.low;
      tr.querySelector(".high").value = opt.high;
      recalc();
    });
  }

  recalc();
  return {
    el: mountEl,
    getTotals: recalc,
    getLinkedValue: () => (linkedSelect ? linkedSelect.value : null),
  };
}

/**
 * Renders a flat-priced line-item table (Qty x single price) — used for the
 * Drainline "routine maintenance" tool/material list.
 * rows: [{ item, unit, qty, price }]
 */
function renderFlatPriceTable(mountEl, rows) {
  const rowsHtml = rows.map((r, i) => `
    <tr data-row data-idx="${i}">
      <td class="item-name">${r.item}</td>
      <td>${r.unit || ""}</td>
      <td><input type="number" step="any" class="qty" value="${r.qty}"></td>
      <td class="num"><input type="number" step="any" class="price" value="${r.price}"></td>
      <td class="num ext">${fmtMoney(r.qty * r.price)}</td>
    </tr>`).join("");

  mountEl.innerHTML = `
    <div class="worksheet-wrap">
      <table class="worksheet">
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Unit Cost</th><th>Ext. Cost</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="4">Total</td><td class="num" data-total="flat">$0.00</td></tr></tfoot>
      </table>
    </div>`;

  function recalc() {
    let total = 0;
    mountEl.querySelectorAll("tbody tr[data-row]").forEach(tr => {
      const qty = parseFloat(tr.querySelector(".qty").value) || 0;
      const price = parseFloat(tr.querySelector(".price").value) || 0;
      const ext = qty * price;
      tr.querySelector(".ext").textContent = fmtMoney(ext);
      total += ext;
    });
    mountEl.querySelector("[data-total]").textContent = fmtMoney(total);
    return { total };
  }
  mountEl.addEventListener("input", recalc);
  recalc();
  return { el: mountEl, getTotals: recalc };
}
