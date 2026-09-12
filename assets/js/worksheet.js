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
 * Renders a single-priced line-item table (Qty x Unit price), with a
 * toggle switch in the last column controlling whether the row counts
 * toward the total (off = excluded, kept at $0 in the Ext. column).
 * rows: [{ group, category, item, unit, qty, price, spec, notes, included, tonnageLinked/tierLinked }]
 *   included defaults to true unless explicitly set to false.
 * opts: {
 *   linkedOptions: [{ tonnage|id, desc/label, price }]  // populates a picker for tonnageLinked/tierLinked rows
 *   linkedKind: 'tonnage' | 'tier'
 *   showGroupSubtotals: bool (default true if >1 distinct group)
 *   showBuyColumn: bool (default false) — adds a second toggle column
 *     ("Buy") after Included, for marking a part as needing to be
 *     purchased/ordered vs. already on the truck. Purely informational —
 *     doesn't affect Ext./totals, just captured in the row's form state.
 *   onTotals: fn(totals) -> totals = { byGroup: {G:{total}}, total }
 * }
 * returns { el, getTotals(), setLinkedValue(value) }
 *
 * Turning a row's Included toggle ON (from off) defaults its Qty to 1 if
 * the field is currently blank/0 — so a template row with no quantity
 * pre-filled (e.g. a Repair worksheet item) prices correctly the moment
 * it's switched on, instead of silently totaling to $0 until someone
 * remembers to also type a quantity.
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
      const label = opts.linkedKind === "tier" ? o.label : `${o.tonnage} ton — ${o.desc} ($${o.price})`;
      return `<option value="${val}"${i === 0 ? " selected" : ""}>${label}</option>`;
    }).join("");
    const pickLabel = opts.linkedKind === "tier" ? "Furnace tier" : "System tonnage";
    linkedPicker = `<div class="field" style="max-width:420px"><label>${pickLabel}</label>
      <select id="${mountEl.id}-linked">${optHtml}</select></div>`;
  }

  const rowsHtml = rows.map((r, i) => {
    const group = r.group || "MATERIALS";
    const isLinked = (r.tonnageLinked || r.tierLinked) ? " data-linked-row" : "";
    const included = r.included !== false;
    const catCell = opts.editableText
      ? `<input type="text" class="cat-input" value="${r.category || ""}" style="width:100px">`
      : (showGroups ? `<span class="badge" style="margin-right:6px">${r.category || ""}</span>` : (r.category || ""));
    const itemCell = opts.editableText
      ? `<input type="text" class="item-input" value="${(r.item || "").replace(/"/g, "&quot;")}" style="width:100%;min-width:180px">`
      : `${r.item}${r.spec ? `<div class="spec">${r.spec}</div>` : ""}`;
    const buyCell = opts.showBuyColumn
      ? `<td class="toggle-cell"><label class="switch sm"><input type="checkbox" class="row-buy" name="${mountEl.id}__buy__${i}" aria-label="Needs to be bought/ordered"${r.buy ? " checked" : ""}><span class="slider"></span></label></td>`
      : "";
    return `<tr data-row data-group="${group}" data-idx="${i}"${isLinked}${included ? "" : " class=\"row-off\""}>
      <td>${catCell}</td>
      <td class="item-name">${itemCell}</td>
      <td>${r.unit || ""}</td>
      <td><input type="number" step="any" class="qty" name="${mountEl.id}__qty__${i}" value="${r.qty}" aria-label="Quantity"></td>
      <td class="num"><input type="number" step="any" class="price" name="${mountEl.id}__price__${i}" value="${r.price}" aria-label="Unit cost"></td>
      <td class="num ext">${fmtMoney(included ? r.qty * r.price : 0)}</td>
      <td class="toggle-cell"><label class="switch sm"><input type="checkbox" class="row-toggle" name="${mountEl.id}__included__${i}" aria-label="Include this line item"${included ? " checked" : ""}><span class="slider"></span></label></td>${buyCell}
    </tr>`;
  }).join("");

  const groupSubtotalsHtml = showGroups ? `<div class="totals-strip">` + groups.map(g => `
      <div class="total-box">
        <div class="label">${g} subtotal</div>
        <div class="value" style="font-size:1.1rem" data-subtotal-group="${g}">$0.00</div>
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
          <th>Unit $</th><th>Ext.</th><th>Included</th>${opts.showBuyColumn ? "<th>Buy</th>" : ""}
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="5">Subtotal</td>
          <td class="num" data-total="total">$0.00</td>
          <td></td>${opts.showBuyColumn ? "<td></td>" : ""}
        </tr></tfoot>
      </table>
    </div>
    ${groupSubtotalsHtml}
    ${addRowBtn}
  `;

  if (opts.allowAddRow) {
    mountEl.querySelector(`#${mountEl.id}-addrow`).addEventListener("click", () => {
      rows.push({ group: "MATERIALS", category: "", item: "New item — edit me", unit: "EA", qty: 1, price: 0, included: true, buy: false });
      renderLineItemTable(mountEl, rows, opts);
    });
  }

  // Flipping a row's Included toggle ON defaults Qty to 1 if it's
  // currently blank/0 (see the showBuyColumn doc comment above). Bound
  // directly to each checkbox so it runs before the delegated "change"
  // listener (added below) recalculates totals off the updated value.
  mountEl.querySelectorAll(".row-toggle").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (!cb.checked) return;
      const tr = cb.closest("tr");
      const qtyInput = tr && tr.querySelector(".qty");
      if (qtyInput && (!qtyInput.value || parseFloat(qtyInput.value) === 0)) {
        qtyInput.value = 1;
      }
    });
  });

  function recalc() {
    const totals = { byGroup: {}, total: 0 };
    mountEl.querySelectorAll("tbody tr[data-row]").forEach(tr => {
      const qty = parseFloat(tr.querySelector(".qty").value) || 0;
      const price = parseFloat(tr.querySelector(".price").value) || 0;
      const on = tr.querySelector(".row-toggle").checked;
      tr.classList.toggle("row-off", !on);
      const ext = on ? qty * price : 0;
      tr.querySelector(".ext").textContent = fmtMoney(ext);
      if (opts.editableText) {
        const idx = parseInt(tr.dataset.idx, 10);
        const itemInput = tr.querySelector(".item-input");
        const catInput = tr.querySelector(".cat-input");
        if (rows[idx] && itemInput) rows[idx].item = itemInput.value;
        if (rows[idx] && catInput) rows[idx].category = catInput.value;
        if (rows[idx]) { rows[idx].qty = qty; rows[idx].price = price; rows[idx].included = on; }
      }
      const g = tr.dataset.group;
      totals.byGroup[g] = totals.byGroup[g] || { total: 0 };
      totals.byGroup[g].total += ext;
      totals.total += ext;
    });
    mountEl.querySelectorAll("[data-total]").forEach(el => {
      el.textContent = fmtMoney(totals.total);
    });
    mountEl.querySelectorAll("[data-subtotal-group]").forEach(el => {
      const t = totals.byGroup[el.dataset.subtotalGroup] || { total: 0 };
      el.textContent = fmtMoney(t.total);
    });
    if (opts.onTotals) opts.onTotals(totals);
    return totals;
  }

  mountEl.addEventListener("input", recalc);
  mountEl.addEventListener("change", recalc);

  const linkedSelect = mountEl.querySelector(`#${mountEl.id}-linked`);
  if (linkedSelect && linkedIdx > -1) {
    linkedSelect.addEventListener("change", () => {
      const val = linkedSelect.value;
      const opt = opts.linkedOptions.find(o => String(opts.linkedKind === "tier" ? o.id : o.tonnage) === val);
      if (!opt) return;
      const tr = mountEl.querySelector("tr[data-linked-row]");
      tr.querySelector(".price").value = opt.price;
      recalc();
    });
  }

  recalc();
  return {
    el: mountEl,
    getTotals: recalc,
    getLinkedValue: () => (linkedSelect ? linkedSelect.value : null),
    setLinkedValue: (val) => {
      if (!linkedSelect) return;
      linkedSelect.value = String(val);
      linkedSelect.dispatchEvent(new Event("change", { bubbles: true }));
    },
  };
}

/**
 * Renders a flat-priced line-item table (Qty x single price) — used for the
 * Drainline "routine maintenance" tool/material list and Plenum duct collars.
 * rows: [{ item, unit, qty, price }]
 */
function renderFlatPriceTable(mountEl, rows) {
  const rowsHtml = rows.map((r, i) => `
    <tr data-row data-idx="${i}">
      <td class="item-name">${r.item}</td>
      <td>${r.unit || ""}</td>
      <td><input type="number" step="any" class="qty" name="${mountEl.id}__qty__${i}" value="${r.qty}"></td>
      <td class="num"><input type="number" step="any" class="price" name="${mountEl.id}__price__${i}" value="${r.price}"></td>
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

/* ============================================================
   Generic whole-page form-state capture/restore, used by the
   Save Quote / Retrieve Quote feature on the New Installation and
   Replacement pages. Every input/select on the page that has an
   "id" (the page-level fields, toggles, and linked pickers) or a
   generated "name" (per-row cells inside a worksheet table, added
   above) is captured by that stable key — so saving/restoring
   doesn't depend on DOM order and tolerates the page gaining new
   fields later (an old saved quote just leaves those unset).
   ============================================================ */
function saaSerializeFormState(rootSelector) {
  const root = document.querySelector(rootSelector || "main");
  const state = {};
  root.querySelectorAll("input, select, textarea").forEach((el) => {
    const key = el.id || el.name;
    if (!key) return;
    if (el.type === "checkbox" || el.type === "radio") state[key] = { c: el.checked };
    else state[key] = { v: el.value };
  });
  return state;
}

function saaApplyFormState(state, rootSelector) {
  if (!state) return;
  const root = document.querySelector(rootSelector || "main");
  root.querySelectorAll("input, select, textarea").forEach((el) => {
    const key = el.id || el.name;
    if (!key || !(key in state)) return;
    const s = state[key];
    if ("c" in s) el.checked = s.c;
    else el.value = s.v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/* ============================================================
   Phone number formatting — normalizes any phone number (typed
   live, loaded from a saved quote, or pulled from a customer
   record) to XXX-XXX-XXXX for display/printing consistency.
   ============================================================ */
function saaFormatPhone(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

// Live-format a phone <input> as the user types (or as a saved value is
// restored into it), so every phone number entered anywhere in the app
// ends up stored and displayed the same way: XXX-XXX-XXXX.
function saaAttachPhoneMask(el) {
  if (!el) return;
  el.addEventListener("input", () => {
    const formatted = saaFormatPhone(el.value);
    if (formatted !== el.value) el.value = formatted;
  });
}
