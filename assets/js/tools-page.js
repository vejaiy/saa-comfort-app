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

/* ---- Stock Counts ---- */

async function renderInventory() {
  const rows = await saaToolInventoryFetchAll(_tlFilters());
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

/* ---- Shared filter bar ---- */

function renderAll() {
  renderInventory();
  renderPurchases();
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

renderAll();
