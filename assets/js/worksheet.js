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
 *   configOptions: [{ key, label, field }]  // Round 41 (2026-09-18):
 *     renders a "Configuration" picker (e.g. Upflow/Horizontal, Single
 *     Stage/Variable Speed). Each row can carry one boolean field per
 *     config (e.g. row.includedUpflow / row.includedHorizontal); picking
 *     a configuration resets every row's Included checkbox to that
 *     config's Yes/No value (rows without that field keep using their
 *     plain `included` default, unaffected). The tech can still toggle
 *     any row by hand afterward — same as switching tonnage doesn't lock
 *     the price field. Falls back to `row.included` when absent.
 *   configSelected: string  // currently-selected config key; defaults to
 *     configOptions[0].key and is kept on `opts` so it survives an
 *     internal re-render (add/remove row) or an external one.
 *   includedFirst: bool (default false) — Round 41: reorders the table's
 *     columns to Included, Item, Category, Unit, Qty, Unit $, Ext. (used
 *     by the standalone Condenser/Coil/Furnace Change worksheets and the
 *     Quotation page's matching detail sections, per Vijayan's reference
 *     spreadsheet). Every other caller (Repair, Drainpan, ...) keeps the
 *     original Category, Item, Unit, Qty, Unit $, Ext., Included order.
 *   onTotals: fn(totals) -> totals = { byGroup: {G:{total}}, total }
 * }
 * returns { el, getTotals(), setLinkedValue(value), getConfigValue(), setConfigValue(value) }
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
  const includedFirst = !!opts.includedFirst;
  const configOptions = opts.configOptions || null;
  if (configOptions && configOptions.length && !opts.configSelected) {
    opts.configSelected = configOptions[0].key;
  }
  const activeConfig = configOptions ? (configOptions.find(c => c.key === opts.configSelected) || configOptions[0]) : null;

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

  let configPicker = "";
  if (configOptions && configOptions.length) {
    const optHtml = configOptions.map((c) =>
      `<option value="${c.key}"${c.key === opts.configSelected ? " selected" : ""}>${c.label}</option>`
    ).join("");
    configPicker = `<div class="field" style="max-width:420px"><label>Configuration</label>
      <select id="${mountEl.id}-config">${optHtml}</select></div>`;
  }

  const rowsHtml = rows.map((r, i) => {
    const group = r.group || "MATERIALS";
    const isLinked = (r.tonnageLinked || r.tierLinked) ? " data-linked-row" : "";
    const included = (activeConfig && r[activeConfig.field] !== undefined) ? (r[activeConfig.field] !== false) : (r.included !== false);
    const catCell = opts.editableText
      ? `<input type="text" class="cat-input" value="${r.category || ""}" style="width:100px">`
      : (showGroups ? `<span class="badge" style="margin-right:6px">${r.category || ""}</span>` : (r.category || ""));
    const itemCell = opts.editableText
      ? `<input type="text" class="item-input" value="${(r.item || "").replace(/"/g, "&quot;")}" style="width:100%;min-width:180px">`
      : `${r.item}${r.spec ? `<div class="spec">${r.spec}</div>` : ""}`;
    const buyCell = opts.showBuyColumn
      ? `<td class="toggle-cell"><label class="switch sm"><input type="checkbox" class="row-buy" name="${mountEl.id}__buy__${i}" aria-label="Needs to be bought/ordered"${r.buy ? " checked" : ""}><span class="slider"></span></label></td>`
      : "";
    const includedCell = `<td class="toggle-cell"><label class="switch sm"><input type="checkbox" class="row-toggle" name="${mountEl.id}__included__${i}" aria-label="Include this line item"${included ? " checked" : ""}><span class="slider"></span></label></td>`;
    const catTd = `<td>${catCell}</td>`;
    const itemTd = `<td class="item-name">${itemCell}</td>`;
    const leadCells = includedFirst ? `${includedCell}${itemTd}${catTd}` : `${catTd}${itemTd}`;
    return `<tr data-row data-group="${group}" data-idx="${i}"${isLinked}${included ? "" : " class=\"row-off\""}>
      ${leadCells}
      <td>${r.unit || ""}</td>
      <td><input type="number" step="any" class="qty" name="${mountEl.id}__qty__${i}" value="${r.qty}" aria-label="Quantity"></td>
      <td class="num"><input type="number" step="any" class="price" name="${mountEl.id}__price__${i}" value="${r.price}" aria-label="Unit cost"></td>
      <td class="num ext">${fmtMoney(included ? r.qty * r.price : 0)}</td>
      ${includedFirst ? "" : includedCell}${buyCell}
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
  const removeRowBtn = opts.allowRemoveRow
    ? `<button type="button" class="btn btn-ghost btn-sm" id="${mountEl.id}-removerow" style="margin-top:10px"${rows.length === 0 ? " disabled" : ""}>&minus; Remove line item</button>`
    : "";
  const rowButtonsHtml = (addRowBtn || removeRowBtn)
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${addRowBtn}${removeRowBtn}</div>`
    : "";

  const headCells = includedFirst
    ? `<th>Included</th><th>Item</th><th>Category</th>`
    : `<th>Category</th><th>Item</th>`;
  const tfootColspan = includedFirst ? 6 : 5;
  // includedFirst puts the Included toggle in column 1 (inside the
  // colspan), so there's no trailing empty cell to align under it the way
  // the legacy layout needs one after the Ext./data-total cell.
  const tfootTrailingCell = includedFirst ? "" : "<td></td>";

  mountEl.innerHTML = `
    ${linkedPicker}
    ${configPicker}
    <div class="worksheet-wrap">
      <table class="worksheet">
        <thead><tr>
          ${headCells}<th>Unit</th><th>Qty</th>
          <th class="num">Unit $</th><th class="num">Ext.</th>${includedFirst ? "" : "<th>Included</th>"}${opts.showBuyColumn ? "<th>Buy</th>" : ""}
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="${tfootColspan}">Subtotal</td>
          <td class="num" data-total="total">$0.00</td>
          ${tfootTrailingCell}${opts.showBuyColumn ? "<td></td>" : ""}
        </tr></tfoot>
      </table>
    </div>
    ${groupSubtotalsHtml}
    ${rowButtonsHtml}
  `;

  if (opts.allowAddRow) {
    mountEl.querySelector(`#${mountEl.id}-addrow`).addEventListener("click", () => {
      rows.push({ group: "MATERIALS", category: "", item: "New item — edit me", unit: "EA", qty: 1, price: 0, included: true, buy: false });
      renderLineItemTable(mountEl, rows, opts);
    });
  }
  if (opts.allowRemoveRow) {
    const removeBtn = mountEl.querySelector(`#${mountEl.id}-removerow`);
    removeBtn.addEventListener("click", () => {
      if (rows.length > 0) {
        rows.pop();
        renderLineItemTable(mountEl, rows, opts);
      }
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

  // Round 41 (2026-09-18): switching Configuration resets every row's
  // Included checkbox to that configuration's Yes/No default (rows
  // without a value for the newly-selected config field are left alone).
  // Deliberately does NOT rebuild the table's HTML — only flips the
  // checkboxes that need to change (dispatching a real "change" event so
  // the default-qty-to-1 behavior above still applies) — so any qty/price
  // edits the tech has already made on screen survive a configuration
  // switch. This mirrors how the tonnage/tier picker above only ever
  // touches the one linked row's price, never the rest of the table.
  const configSelect = mountEl.querySelector(`#${mountEl.id}-config`);
  if (configSelect && configOptions) {
    configSelect.addEventListener("change", () => {
      opts.configSelected = configSelect.value;
      const cfg = configOptions.find(c => c.key === configSelect.value);
      if (!cfg) return;
      mountEl.querySelectorAll("tbody tr[data-row]").forEach((tr) => {
        const idx = parseInt(tr.dataset.idx, 10);
        const row = rows[idx];
        if (!row || row[cfg.field] === undefined) return;
        const toggle = tr.querySelector(".row-toggle");
        const want = row[cfg.field] !== false;
        if (toggle.checked !== want) {
          toggle.checked = want;
          toggle.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
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
    getConfigValue: () => (configSelect ? configSelect.value : null),
    setConfigValue: (val) => {
      if (!configSelect) return;
      configSelect.value = String(val);
      configSelect.dispatchEvent(new Event("change", { bubbles: true }));
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
        <thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th class="num">Unit Cost</th><th class="num">Ext. Cost</th></tr></thead>
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
   Bill of Material auto-derivation (round 12 redesign, 2026-09-13)
   "Itemized Bill of material should be printed from change worksheets
   that are included for that job or quotation" -- rather than a
   freeform manually-typed list, the BOM page (bom-db.js/bom.html)
   reconstructs the qty+unit list straight from a saved quote's own
   form_state, using the exact same row keys (`${mountId}__qty__${i}`,
   `${mountId}__included__${i}`) that saaSerializeFormState captured
   when the quote was last saved -- so the BOM always matches whatever
   is currently toggled on in that quote's worksheets, with no separate
   snapshot to fall out of sync. Needs pricing-data.js loaded for the
   *_MATERIALS/*_ITEMS/DRAINPAN_ROWS source arrays (item name + unit
   aren't themselves stored in form_state, only which row index is
   included and at what qty).
   No cost is included anywhere in this — per "no need to populate
   cost, just populate qty and unit in order form". */
// Round 37 (2026-09-17), per Vijayan's annotated Bill of Material
// screenshot (job J-2026-0005-Sreedhar): "(per System tonnage above)"
// crossed out and "3.5 ton" hand-written in front of it, with "Should
// show tonnage selected in front." -- the Round 36 fix made this wording
// generic (right, since it no longer lies about a hardcoded 3-ton unit),
// but a bare pointer phrase still isn't the actual answer, and the shop
// pulling parts off this printed list has no picker to go look at. Strips
// a trailing "(per ... above)" pointer phrase so the real tonnage/tier can
// be substituted in its place, whatever the exact wording ends up being.
function _saaBomLinkedBaseName(item) {
  return String(item || "").replace(/\s*\(per [^)]*\)\s*$/i, "").trim();
}

/** Resolves a tonnageLinked/tierLinked row's description using the
 *  linked picker's actual saved value (formState[`${mountId}-linked`])
 *  -- "3.5 ton Condenser unit" / "Evaporator coil ... 3.5 ton" style
 *  prefix for tonnage (matching the "3.5 ton" wording the tonnage picker
 *  itself already uses, see tonnageLabel() on quotation.html), an
 *  " — <tier label>" suffix for furnace tier since FURNACE_TIERS labels
 *  are full descriptive phrases, not a short magnitude like tonnage. */
function _saaBomLinkedDescription(mountId, formState, src) {
  const base = _saaBomLinkedBaseName(src.item);
  const linked = formState[`${mountId}-linked`];
  const val = linked && linked.v;
  if (!val) return src.item;
  if (src.tonnageLinked) return `${val} ton ${base}`;
  const tiers = typeof FURNACE_TIERS !== "undefined" ? FURNACE_TIERS : [];
  const tier = tiers.find((t) => String(t.id) === String(val));
  return tier ? `${base} — ${tier.label}` : src.item;
}

function saaDeriveBomItemsFromFormState(formState, quoteType) {
  formState = formState || {};
  function rowsFromSpec(mountId, rows, opts) {
    opts = opts || {};
    if (opts.enabledIf) {
      const gate = formState[opts.enabledIf];
      if (!gate || !gate.c) return [];
    }
    const out = [];
    (rows || []).forEach((src, idx) => {
      const incState = formState[`${mountId}__included__${idx}`];
      const included = incState ? !!incState.c : (src.included !== false);
      if (!included) return;
      if (opts.excludeCategories && opts.excludeCategories.includes(src.category)) return;
      const qtyState = formState[`${mountId}__qty__${idx}`];
      const qty = qtyState ? (parseFloat(qtyState.v) || 0) : (src.qty || 0);
      if (!src.item || qty <= 0) return;
      const description = (src.tonnageLinked || src.tierLinked)
        ? _saaBomLinkedDescription(mountId, formState, src)
        : src.item;
      out.push({ description, unit: src.unit || "", qty, section: opts.section || "Other" });
    });
    return out;
  }
  function flatToggle(toggleId, description, unit, section) {
    const st = formState[toggleId];
    return (st && st.c) ? [{ description, unit: unit || "EA", qty: 1, section: section || "Other" }] : [];
  }
  // Plenum Change (Round 35: "Include materials require for plenum in bill
  // of materials") doesn't use the row-array table shape every other
  // worksheet does -- it's the standalone plenumWidget (plenum-widget.js),
  // whose fields are named `${mountId}__type__${eq}`/`__cab__${eq}`/
  // `__qty__${eq}` for the two cabinet rows (CCoil, Furnace) plus a
  // `${mountId}-collars__qty__${i}` row per DUCT_COLLARS entry -- read
  // directly here rather than through rowsFromSpec, which assumes the
  // included/qty-by-index shape those other worksheets use.
  function plenumItems(mountId) {
    const gate = formState["tgl-plenum"];
    if (!gate || !gate.c) return [];
    const types = typeof PLENUM_TYPES !== "undefined" ? PLENUM_TYPES : [];
    const out = [];
    [["CCoil", "Coil Cabinet Plenum"], ["Furnace", "Furnace Cabinet Plenum"]].forEach(([eq, label]) => {
      const qtyState = formState[`${mountId}__qty__${eq}`];
      const qty = qtyState ? (parseFloat(qtyState.v) || 0) : 0;
      if (qty <= 0) return;
      const type = (formState[`${mountId}__type__${eq}`] || {}).v || "";
      const cab = (formState[`${mountId}__cab__${eq}`] || {}).v || "";
      const match = types.find((p) => p.equipment === eq && p.type === type && p.cabinet === cab);
      const desc = `${label} — ${type || "?"}, Cabinet ${cab || "?"}${match ? ` (${match.size})` : ""}`;
      out.push({ description: desc, unit: "EA", qty, section: "Plenum" });
    });
    const collars = typeof DUCT_COLLARS !== "undefined" ? DUCT_COLLARS : [];
    collars.forEach((c, idx) => {
      const qtyState = formState[`${mountId}-collars__qty__${idx}`];
      const qty = qtyState ? (parseFloat(qtyState.v) || 0) : 0;
      if (qty <= 0) return;
      out.push({ description: `Duct collar ${c.size}`, unit: "EA", qty, section: "Plenum" });
    });
    return out;
  }
  // NOTE: pricing-data.js declares these with top-level `const`, which
  // creates a global lexical binding but NOT a `window.X` property -- so
  // this reads the bare identifiers directly (safe: emp_page() always
  // loads pricing-data.js before worksheet.js, and by the time this
  // function actually runs, later, both scripts have long since finished
  // executing) rather than checking `typeof window[name]`, which would
  // always read as undefined and silently return an empty item list.
  // Each row is tagged with a "section" (Round 13: "categorize bill of
  // material by condenser, coil and furnace") matching whichever
  // worksheet it came from -- the repair page's "fan coil" worksheet
  // maps to the same "Coil" section as the install/replacement page's
  // indoor coil, since it's the same piece of equipment. Drain pan
  // materials and the flat Thermostat toggle don't belong to any one
  // piece of equipment, so they fall into "Other".
  let items = [];
  if (quoteType === "repair") {
    items = items.concat(
      rowsFromSpec("detail-rep-condenser", typeof REPAIR_CONDENSER_ITEMS !== "undefined" ? REPAIR_CONDENSER_ITEMS : [], { enabledIf: "tgl-rep-condenser", section: "Condenser" }),
      rowsFromSpec("detail-rep-fancoil", typeof REPAIR_FANCOIL_ITEMS !== "undefined" ? REPAIR_FANCOIL_ITEMS : [], { enabledIf: "tgl-rep-fancoil", section: "Coil" }),
      rowsFromSpec("detail-rep-furnace", typeof REPAIR_FURNACE_ITEMS !== "undefined" ? REPAIR_FURNACE_ITEMS : [], { enabledIf: "tgl-rep-furnace", section: "Furnace" })
    );
  } else {
    items = items.concat(
      rowsFromSpec("detail-condenser", typeof CONDENSER_MATERIALS !== "undefined" ? CONDENSER_MATERIALS : [], { enabledIf: "tgl-condenser", section: "Condenser" }),
      rowsFromSpec("detail-coil", typeof COIL_MATERIALS !== "undefined" ? COIL_MATERIALS : [], { enabledIf: "tgl-coil", section: "Coil" }),
      rowsFromSpec("detail-furnace", typeof FURNACE_MATERIALS !== "undefined" ? FURNACE_MATERIALS : [], { enabledIf: "tgl-furnace", section: "Furnace" }),
      rowsFromSpec("detail-drainpan", typeof DRAINPAN_ROWS !== "undefined" ? DRAINPAN_ROWS : [], { enabledIf: "tgl-drainpan", excludeCategories: ["Labor"], section: "Other" }),
      plenumItems("detail-plenum")
    );
  }
  items = items.concat(flatToggle("tgl-thermostat", "Thermostat", "EA", "Other"));
  return items;
}

/** Shows a small read-only note under the intake card listing any items
 *  that were added on the Bill of Material page for this quote (see
 *  saaBomAddItem in bom-db.js, which mirrors a manually-added item into
 *  the quote's own form_state as "_bomExtras") — "update worksheets if
 *  needed after bill of material update" (round 12 redesign, 2026-09-13).
 *  No-op quietly if the page has no #bom-extras-note element. */
function saaRenderBomExtrasNote(formState) {
  const note = document.getElementById("bom-extras-note");
  if (!note) return;
  const extras = formState && Array.isArray(formState._bomExtras) ? formState._bomExtras : [];
  if (!extras.length) { note.hidden = true; return; }
  note.hidden = false;
  note.innerHTML = "Added from Bill of Material page: " + extras.map((e) =>
    `${e.qty || 1} ${e.unit || "ea"} &times; ${String(e.description || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`
  ).join(", ");
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

/* ============================================================
   Generic Yes/Cancel confirmation modal — used before saving a
   likely-duplicate quote/job, before deleting one, and anywhere else
   a page needs the office to confirm an action rather than a jarring
   native confirm() popup. Reuses the same .modal-overlay/.modal-card
   styling as every other modal in the app (Retrieve Quote, Photos,
   Inspection, the calendar's schedule-conflict modal).
   Returns a Promise<boolean> — true if the office clicked Continue.
   ============================================================ */
function saaConfirm(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card">
        <h3>${opts.title || "Please confirm"}</h3>
        <p class="muted" style="margin-bottom:16px;white-space:pre-line">${message}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="btn btn-ghost btn-sm" data-act="cancel">${opts.cancelLabel || "Cancel"}</button>
          <button type="button" class="btn btn-navy btn-sm" data-act="ok">${opts.okLabel || "Continue"}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    function done(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => done(false));
    overlay.querySelector('[data-act="ok"]').addEventListener("click", () => done(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(false);
    });
  });
}
