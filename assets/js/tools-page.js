/* ============================================================
   SAA Comfort Air LLC — Tool List page logic (employee/tool-list.html)
   Renders the Stock Counts and Purchase Ledger tables from tools-db.js,
   wires up the shared type/search filter, inline stock-qty editing,
   and the two "Add" forms. Round 35 (2026-09-16).
   ============================================================ */

function _tlEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function _tlMoney(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _tlTypeLabel(t) {
  return t === "tools" ? "Tools" : t === "supplies" ? "Supplies" : (t || "");
}

function _tlFilters() {
  return {
    type: document.getElementById("tl-type-filter").value || undefined,
    search: document.getElementById("tl-search").value || undefined,
  };
}

function _tlPriorityLabel(p) {
  return p === "low" ? "Low" : p === "medium" ? "Medium" : p === "high" ? "High" : "";
}

/* ---- Tabs (Stock Counts / Purchase Ledger / Tools to Buy) ---- */

let _tlActiveTab = "stock";

function _tlSwitchTab(tab) {
  _tlActiveTab = tab;
  document.querySelectorAll("#tl-tabs .cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".rc-tab-panel").forEach((p) => { p.hidden = true; });
  const panel = document.getElementById(`tl-panel-${tab}`);
  if (panel) panel.hidden = false;
}

/* ---- Stock Counts ---- */

// Round 37 (2026-09-17), per Vijayan's annotated screenshot ("Add 'print
// tool list' button to print in pdf and also add a download button to
// download in excel format"): both buttons act on whatever's currently
// on screen, so this is refreshed at the end of every renderInventory()
// (i.e. it already reflects the Type/search filters above the table).
let _tlLastInventoryRows = [];

async function renderInventory() {
  const rows = await saaToolInventoryFetchAll(_tlFilters());
  _tlLastInventoryRows = rows;
  const tbody = document.getElementById("tl-inv-tbody");
  document.getElementById("tl-inv-empty").hidden = rows.length > 0;
  document.getElementById("tl-inv-count").textContent = rows.length
    ? `${rows.length} item${rows.length === 1 ? "" : "s"}`
    : "";

  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${_tlEsc(r.item_name)}</td>
      <td>${_tlEsc(r.category)}</td>
      <td>${_tlTypeLabel(r.type)}</td>
      <td><input type="number" step="any" class="tl-qty-input" data-id="${r.id}" value="${r.quantity_on_hand}" style="width:80px"></td>
      <td>${_tlEsc(r.last_purchase_date)}</td>
      <td class="muted" style="font-size:.82rem">${_tlEsc(r.notes)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm tl-inv-del" data-id="${r.id}">Delete</button></td>
    </tr>`).join("");

  tbody.querySelectorAll(".tl-qty-input").forEach((input) => {
    let original = input.value;
    input.addEventListener("focus", () => { original = input.value; });
    input.addEventListener("change", async () => {
      if (input.value === original || input.value === "") { input.value = original; return; }
      const res = await saaToolInventoryUpdateQty(input.dataset.id, input.value);
      if (!res.ok) {
        alert("Couldn't save that count: " + res.error);
        input.value = original;
        return;
      }
      original = input.value;
      input.style.background = "#eaf6ec";
      setTimeout(() => { input.style.background = ""; }, 900);
    });
  });

  tbody.querySelectorAll(".tl-inv-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this item from the stock list? This does not touch the purchase ledger.")) return;
      const res = await saaToolInventoryDelete(btn.dataset.id);
      if (!res.ok) { alert("Couldn't delete: " + res.error); return; }
      renderInventory();
    });
  });
}

document.getElementById("tl-inv-add-btn").addEventListener("click", async () => {
  const status = document.getElementById("tl-inv-add-status");
  const itemName = document.getElementById("tl-inv-add-name").value.trim();
  if (!itemName) { status.textContent = "Item name is required."; return; }
  const res = await saaToolInventoryAdd({
    item_name: itemName,
    category: document.getElementById("tl-inv-add-category").value.trim(),
    type: document.getElementById("tl-inv-add-type").value,
    quantity_on_hand: document.getElementById("tl-inv-add-qty").value,
    unit_of_measure: document.getElementById("tl-inv-add-unit").value.trim(),
    notes: document.getElementById("tl-inv-add-notes").value.trim(),
  });
  if (!res.ok) { status.textContent = "Error: " + res.error; return; }
  document.getElementById("tl-inv-add-name").value = "";
  document.getElementById("tl-inv-add-category").value = "";
  document.getElementById("tl-inv-add-qty").value = "";
  document.getElementById("tl-inv-add-unit").value = "";
  document.getElementById("tl-inv-add-notes").value = "";
  status.textContent = "Added.";
  renderInventory();
});

function _tlFilterNote() {
  const parts = [];
  const type = document.getElementById("tl-type-filter").value;
  const search = document.getElementById("tl-search").value.trim();
  if (type) parts.push(_tlTypeLabel(type));
  if (search) parts.push(`matching "${search}"`);
  return parts.length ? "filtered: " + parts.join(", ") : "";
}

function _tlPrintList() {
  printToolList({
    generatedOn: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    filterNote: _tlFilterNote(),
    rows: _tlLastInventoryRows,
  });
}

// Round 77: real formatted .xlsx (see xlsx-export.js), same rows as on screen.
function _tlDownloadCsv() {
  const rows = _tlLastInventoryRows.map((r) => [
    r.item_name, r.category, _tlTypeLabel(r.type), r.quantity_on_hand, r.unit_of_measure, r.last_purchase_date, r.notes,
  ]);
  saaXlsxDownload("SAA-tool-list-" + saaXlsxStamp(), [{
    name: "Tool List", tabColor: "C55A11",
    title: "SAA Comfort Air LLC \u2014 Tool List",
    subtitle: "Generated " + saaXlsxTodayLabel() + "   |   " + rows.length + " item" + (rows.length === 1 ? "" : "s") + " (as filtered on screen)",
    freezeCols: 1, emptyText: "No tools match the current filters.",
    columns: [
      { header: "Item", width: 38, type: "wrap" }, { header: "Category", width: 22 }, { header: "Type", width: 14, type: "center" },
      { header: "Qty on Hand", width: 12, type: "int" }, { header: "Unit", width: 10, type: "center" },
      { header: "Last Purchased", width: 15, type: "date" }, { header: "Notes", width: 44, type: "wrap" },
    ],
    rows,
  }]);
}

document.getElementById("tl-print-btn").addEventListener("click", _tlPrintList);
document.getElementById("tl-download-btn").addEventListener("click", _tlDownloadCsv);

/* ---- Purchase Ledger ---- */

async function renderPurchases() {
  const filters = _tlFilters();
  filters.dateFrom = document.getElementById("tl-date-from").value || undefined;
  filters.dateTo = document.getElementById("tl-date-to").value || undefined;
  const rows = await saaToolPurchasesFetchAll(filters);
  const tbody = document.getElementById("tl-purch-tbody");
  document.getElementById("tl-purch-empty").hidden = rows.length > 0;

  const totalSpend = rows.reduce((sum, r) => sum + (Number(r.item_total) || 0), 0);
  document.getElementById("tl-purch-totals").textContent = rows.length
    ? `${rows.length} line item${rows.length === 1 ? "" : "s"} &middot; net ${_tlMoney(totalSpend)}`.replace("&middot;", "·")
    : "";

  tbody.innerHTML = rows.map((r) => `
    <tr data-id="${r.id}">
      <td>${_tlEsc(r.purchase_date)}</td>
      <td>${_tlEsc(r.vendor)}</td>
      <td>${_tlEsc(r.item_name)}</td>
      <td>${_tlEsc(r.category)}</td>
      <td>${_tlTypeLabel(r.type)}</td>
      <td>${r.qty}</td>
      <td>${_tlMoney(r.unit_price)}</td>
      <td>${_tlMoney(r.item_total)}</td>
      <td>${_tlMoney(r.sales_tax)}</td>
      <td>${_tlEsc(r.receipt_order_number)}</td>
      <td class="muted" style="font-size:.82rem">${_tlEsc(r.notes)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm tl-purch-del" data-id="${r.id}">Delete</button></td>
    </tr>`).join("");

  tbody.querySelectorAll(".tl-purch-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this purchase-ledger line item? This does not touch the stock count.")) return;
      const res = await saaToolPurchaseDelete(btn.dataset.id);
      if (!res.ok) { alert("Couldn't delete: " + res.error); return; }
      renderPurchases();
    });
  });
}

document.getElementById("tl-purch-add-btn").addEventListener("click", async () => {
  const status = document.getElementById("tl-purch-add-status");
  const date = document.getElementById("tl-purch-add-date").value;
  const itemName = document.getElementById("tl-purch-add-name").value.trim();
  if (!date) { status.textContent = "Purchase date is required."; return; }
  if (!itemName) { status.textContent = "Item name is required."; return; }
  const res = await saaToolPurchaseAdd({
    purchase_date: date,
    vendor: document.getElementById("tl-purch-add-vendor").value.trim(),
    item_name: itemName,
    category: document.getElementById("tl-purch-add-category").value.trim(),
    type: document.getElementById("tl-purch-add-type").value,
    qty: document.getElementById("tl-purch-add-qty").value,
    unit_price: document.getElementById("tl-purch-add-price").value,
    sales_tax: document.getElementById("tl-purch-add-tax").value,
    receipt_order_number: document.getElementById("tl-purch-add-receipt").value.trim(),
    notes: document.getElementById("tl-purch-add-notes").value.trim(),
  });
  if (!res.ok) { status.textContent = "Error: " + res.error; return; }
  ["date", "vendor", "name", "category", "qty", "price", "tax", "receipt", "notes"].forEach((f) => {
    const el = document.getElementById(`tl-purch-add-${f}`);
    if (el) el.value = f === "qty" ? "1" : "";
  });
  status.textContent = "Purchase added.";
  renderPurchases();
});

/* ---- Tools to Buy (shopping list) ----
   Round 67 (2026-09-28), per Vijayan: "Add edit/ delete button in tools to
   buy list. should be able to delete the item in tools to buy once that
   tool is bought." Actions sit in the first column (they were off-screen to
   the right on a phone): Bought, Edit, Delete. Bought asks whether to remove
   the item from the list or keep it as purchased history. */

let _tlShopRows = [];      // last rendered rows, for Edit / Bought lookups
let _tlShopEditingId = null;

/** Three-way choice for a bought item. Resolves "delete" | "keep" | null. */
function _tlShopBoughtChoice(itemName) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-card" style="max-width:420px">
        <h3>Bought: ${_tlEsc(itemName)}</h3>
        <p class="muted" style="margin-bottom:16px">Remove it from the Tools to Buy list, or keep it here marked as purchased (hidden unless "Show purchased" is ticked)?</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button type="button" class="btn btn-ghost btn-sm" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="keep">Keep as purchased</button>
          <button type="button" class="btn btn-navy btn-sm" data-act="delete">Remove from list</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('[data-act="cancel"]').addEventListener("click", () => done(null));
    overlay.querySelector('[data-act="keep"]').addEventListener("click", () => done("keep"));
    overlay.querySelector('[data-act="delete"]').addEventListener("click", () => done("delete"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
  });
}

async function renderShoppingList() {
  const filters = _tlFilters();
  filters.includePurchased = document.getElementById("tl-shop-show-purchased").checked;
  const rows = await saaToolShoppingListFetchAll(filters);
  _tlShopRows = rows;
  const tbody = document.getElementById("tl-shop-tbody");
  document.getElementById("tl-shop-empty").hidden = rows.length > 0;

  tbody.innerHTML = rows.map((r) => {
    const purchased = r.status === "purchased";
    return `
    <tr data-id="${r.id}"${purchased ? ' class="tl-shop-purchased"' : ""}>
      <td class="tl-shop-actions">
        ${purchased
          ? `<button type="button" class="btn btn-ghost btn-sm tl-shop-toggle" data-id="${r.id}" data-purchased="1" title="Put it back on the to-buy list">&#8617; To Buy</button>`
          : `<button type="button" class="btn btn-ghost btn-sm tl-shop-toggle tl-shop-bought" data-id="${r.id}" data-purchased="0" title="I bought this">&#10003; Bought</button>`}
        <button type="button" class="btn btn-ghost btn-sm tl-shop-edit" data-id="${r.id}" title="Edit" aria-label="Edit">&#9998;</button>
        <button type="button" class="btn btn-ghost btn-sm tl-shop-del" data-id="${r.id}" title="Delete" aria-label="Delete">&#128465;</button>
      </td>
      <td><strong>${_tlEsc(r.item_name)}</strong>${purchased ? `<div class="muted" style="font-size:.72rem">Purchased${r.purchased_date ? " " + _tlEsc(r.purchased_date) : ""}</div>` : ""}</td>
      <td>${_tlEsc(r.specification)}</td>
      <td>${_tlEsc(r.brand)}</td>
      <td>${r.qty == null ? "" : r.qty}</td>
      <td>${_tlEsc(r.category)}</td>
      <td>${_tlTypeLabel(r.type)}</td>
      <td>${_tlMoney(r.estimated_price)}</td>
      <td>${_tlEsc(_tlPriorityLabel(r.priority))}</td>
      <td class="muted" style="font-size:.82rem">${_tlEsc(r.notes)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".tl-shop-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.purchased === "1") {
        const res = await saaToolShoppingListMarkPurchased(id, false);
        if (!res.ok) { alert("Couldn't update: " + res.error); return; }
        renderShoppingList();
        return;
      }
      const row = _tlShopRows.find((r) => r.id === id) || {};
      const choice = await _tlShopBoughtChoice(row.item_name || "this item");
      if (!choice) return;
      const res = choice === "delete"
        ? await saaToolShoppingListDelete(id)
        : await saaToolShoppingListMarkPurchased(id, true);
      if (!res.ok) { alert("Couldn't update: " + res.error); return; }
      if (_tlShopEditingId === id) _tlShopResetForm();
      renderShoppingList();
    });
  });

  tbody.querySelectorAll(".tl-shop-edit").forEach((btn) => {
    btn.addEventListener("click", () => _tlShopStartEdit(btn.dataset.id));
  });

  tbody.querySelectorAll(".tl-shop-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = _tlShopRows.find((r) => r.id === btn.dataset.id) || {};
      const ok = await saaConfirm(`Delete "${_tlEsc(row.item_name || "this item")}" from the Tools to Buy list? This can't be undone.`,
        { title: "Delete item", okLabel: "Delete", cancelLabel: "Cancel" });
      if (!ok) return;
      const res = await saaToolShoppingListDelete(btn.dataset.id);
      if (!res.ok) { alert("Couldn't delete: " + res.error); return; }
      if (_tlShopEditingId === btn.dataset.id) _tlShopResetForm();
      renderShoppingList();
    });
  });
}

const _TL_SHOP_FIELDS = { name: "item_name", spec: "specification", brand: "brand", qty: "qty", category: "category", type: "type", price: "estimated_price", priority: "priority", notes: "notes" };

function _tlShopFormValues() {
  return {
    item_name: document.getElementById("tl-shop-add-name").value.trim(),
    specification: document.getElementById("tl-shop-add-spec").value.trim(),
    brand: document.getElementById("tl-shop-add-brand").value.trim(),
    qty: document.getElementById("tl-shop-add-qty").value,
    category: document.getElementById("tl-shop-add-category").value.trim(),
    type: document.getElementById("tl-shop-add-type").value,
    estimated_price: document.getElementById("tl-shop-add-price").value,
    priority: document.getElementById("tl-shop-add-priority").value,
    notes: document.getElementById("tl-shop-add-notes").value.trim(),
  };
}

/** Back to "Add" mode with an empty form. */
function _tlShopResetForm() {
  _tlShopEditingId = null;
  ["name", "spec", "brand", "qty", "category", "price", "notes"].forEach((f) => {
    const el = document.getElementById(`tl-shop-add-${f}`);
    if (el) el.value = f === "qty" ? "1" : "";
  });
  document.getElementById("tl-shop-add-type").value = "tools";
  document.getElementById("tl-shop-add-priority").value = "";
  document.getElementById("tl-shop-form-title").textContent = "Add to Shopping List";
  document.getElementById("tl-shop-add-btn").textContent = "Add to List";
  document.getElementById("tl-shop-cancel-edit-btn").hidden = true;
  document.getElementById("tl-shop-form-card").classList.remove("tl-shop-editing");
}

/** Fill the Add form with an existing item and switch it to "Save Changes". */
function _tlShopStartEdit(id) {
  const row = _tlShopRows.find((r) => r.id === id);
  if (!row) return;
  _tlShopEditingId = id;
  Object.entries(_TL_SHOP_FIELDS).forEach(([f, col]) => {
    const el = document.getElementById(`tl-shop-add-${f}`);
    if (!el) return;
    let v = row[col];
    if (f === "type") v = v || "tools";
    el.value = v == null ? "" : v;
  });
  document.getElementById("tl-shop-form-title").textContent = `Edit: ${row.item_name || "item"}`;
  document.getElementById("tl-shop-add-btn").textContent = "Save Changes";
  document.getElementById("tl-shop-cancel-edit-btn").hidden = false;
  document.getElementById("tl-shop-add-status").textContent = "";
  const card = document.getElementById("tl-shop-form-card");
  card.classList.add("tl-shop-editing");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("tl-shop-add-name").focus({ preventScroll: true });
}

document.getElementById("tl-shop-add-btn").addEventListener("click", async () => {
  const status = document.getElementById("tl-shop-add-status");
  const vals = _tlShopFormValues();
  if (!vals.item_name) { status.textContent = "Item name is required."; return; }
  const editing = _tlShopEditingId;
  const res = editing ? await saaToolShoppingListUpdate(editing, vals) : await saaToolShoppingListAdd(vals);
  if (!res.ok) { status.textContent = "Error: " + res.error; return; }
  _tlShopResetForm();
  status.textContent = editing ? "Changes saved." : "Added to shopping list.";
  renderShoppingList();
});

document.getElementById("tl-shop-cancel-edit-btn").addEventListener("click", () => {
  _tlShopResetForm();
  document.getElementById("tl-shop-add-status").textContent = "";
});

document.getElementById("tl-shop-show-purchased").addEventListener("change", renderShoppingList);

document.querySelectorAll("#tl-tabs .cal-view-btn").forEach((b) => {
  b.addEventListener("click", () => _tlSwitchTab(b.dataset.tab));
});

/* ---- Shared filter bar ---- */

function renderAll() {
  renderInventory();
  renderPurchases();
  renderShoppingList();
}

let _tlSearchTimer = null;
document.getElementById("tl-type-filter").addEventListener("change", renderAll);
document.getElementById("tl-search").addEventListener("input", () => {
  clearTimeout(_tlSearchTimer);
  _tlSearchTimer = setTimeout(renderAll, 200);
});
document.getElementById("tl-date-from").addEventListener("change", renderPurchases);
document.getElementById("tl-date-to").addEventListener("change", renderPurchases);
document.getElementById("tl-clear-btn").addEventListener("click", () => {
  document.getElementById("tl-type-filter").value = "";
  document.getElementById("tl-search").value = "";
  document.getElementById("tl-date-from").value = "";
  document.getElementById("tl-date-to").value = "";
  renderAll();
});

// The Stock Counts tab starts marked "active" in the generated markup, but
// every tab panel starts hidden except it (see gen_tools.py) -- _tlSwitchTab
// keeps the button/panel state in sync going forward, so run it once up
// front to match the default markup rather than assuming they never drift.
_tlSwitchTab("stock");
renderAll();
