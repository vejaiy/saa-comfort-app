/* ============================================================
   SAA Comfort Air LLC — Receipts page logic (employee/receipts.html)
   Landing view (Summary + By Category + By Job) plus three bucket
   buttons -- Receipts / Tools / Supplies -- that drill into that
   bucket's line items, grouped by month then by the receipt they
   came off. Round 50 (2026-09-24).
   ============================================================ */

function _rcEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function _rcMoney(n) {
  if (n == null || n === "") return "$0.00";
  const num = Number(n);
  const sign = num < 0 ? "-" : "";
  return sign + "$" + Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _rcDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function _rcProjectLabel(r) {
  if (r.job) return r.job.job_number;
  if (r.customer) return `${r.customer.first_name} ${r.customer.last_name}`;
  return r.project_label || "Unassigned";
}
function _rcBucketLabel(b) {
  return b === "receipts" ? "Receipts" : b === "tools" ? "Tools" : b === "supplies" ? "Supplies" : (b || "");
}

let _rcAllRows = []; // all line items
let _rcJobOptions = [];
let _rcActiveTab = "overview";

function _rcFilters() {
  return {
    search: document.getElementById("rc-search").value || undefined,
  };
}

function _rcApplyClientFilters(rows) {
  const needsReviewOnly = document.getElementById("rc-needs-review-only").checked;
  return needsReviewOnly ? rows.filter((r) => r.auto_tagged) : rows;
}

async function _rcLoadAll() {
  const rows = await saaLineItemsFetchAll(_rcFilters());
  _rcAllRows = rows;
  const receiptCount = new Set(rows.map((r) => r.receipt_id)).size;
  document.getElementById("rc-count").textContent = `${rows.length} line item${rows.length === 1 ? "" : "s"} on ${receiptCount} receipt${receiptCount === 1 ? "" : "s"}`;
  _rcRefreshCategoryOptions();
  _rcRenderActiveTab();
}

// Category field in the edit modal is a <select> of every category already
// in use, plus a "+ Add new category" option that reveals a text input --
// lets Vijayan pick an existing category (kept consistent across receipts)
// or assign a brand new one. (A <datalist> combo-box was tried first, but
// doesn't render as a usable dropdown on iPhone/mobile Safari.)
const RC_NEW_CATEGORY_VALUE = "__new__";
function _rcRefreshCategoryOptions() {
  const cats = [...new Set(_rcAllRows.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sel = document.getElementById("rc-edit-category-select");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML =
    `<option value="">&mdash; Select category &mdash;</option>` +
    cats.map((c) => `<option value="${_rcEsc(c)}">${_rcEsc(c)}</option>`).join("") +
    `<option value="${RC_NEW_CATEGORY_VALUE}">+ Add new category&hellip;</option>`;
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
function _rcOnCategorySelectChange() {
  const sel = document.getElementById("rc-edit-category-select");
  const newInput = document.getElementById("rc-edit-category-new");
  const isNew = sel.value === RC_NEW_CATEGORY_VALUE;
  newInput.hidden = !isNew;
  if (isNew) { newInput.value = ""; newInput.focus(); }
}

// Full-detail table row -- matches Vijayan's own tracking-sheet columns:
// Date / Vendor / Store Location / Item Description / Category / Job-Project /
// Specification / Qty / Unit Price / Item Total / Sales Tax / Subtotal /
// Payment Method / Receipt-Order Number, plus Email + Edit actions.
function _rcLineItemTableRowHtml(li) {
  const reviewBadge = li.auto_tagged ? ` <span class="rc-badge rc-badge-review">needs review</span>` : "";
  const subtotal = saaLineTotal(li);
  return `
<tr class="jb-row" data-id="${li.id}">
  <td>${_rcDate(li.r_received_at)}</td>
  <td>${_rcEsc(li.r_vendor) || "&mdash;"}</td>
  <td>${_rcEsc(li.r_store_location)}</td>
  <td>${_rcEsc(li.item_description)}${reviewBadge}${li.notes ? `<div class="muted" style="font-size:.78rem;white-space:normal">${_rcEsc(li.notes)}</div>` : ""}</td>
  <td>${_rcEsc(li.category) || "Uncategorized"}</td>
  <td>${_rcEsc(_rcProjectLabel(li))}</td>
  <td>${_rcEsc(li.specification)}</td>
  <td>${li.qty == null ? "" : li.qty}</td>
  <td>${li.unit_price == null ? "" : _rcMoney(li.unit_price)}</td>
  <td>${li.item_total == null ? "&mdash;" : _rcMoney(li.item_total)}</td>
  <td>${li.sales_tax == null ? "" : _rcMoney(li.sales_tax)}</td>
  <td>${subtotal == null ? "&mdash;" : _rcMoney(subtotal)}</td>
  <td>${_rcEsc(li.r_payment_method)}</td>
  <td>${_rcEsc(li.r_receipt_number)}</td>
  <td style="white-space:nowrap">
    <a href="${_rcEsc(li.r_gmail_view_url) || '#'}" target="_blank" class="btn btn-ghost btn-sm"${li.r_gmail_view_url ? "" : " style=\"visibility:hidden\""}>Email</a>
    <button type="button" class="btn btn-ghost btn-sm rc-edit-btn" data-id="${li.id}">Edit</button>
  </td>
</tr>`;
}

function _rcLineItemsTableHtml(rows) {
  // "jobs-table-wrap rc-table-scroll" -- a capped-height, scroll-both-ways
  // box so the horizontal scrollbar for this wide (14-column) table stays
  // reachable at the bottom of the visible table instead of the bottom of
  // the whole (possibly very long) month group. See style.css.
  return `
<div class="jobs-table-wrap rc-table-scroll">
  <table class="jobs-table">
    <thead><tr>
      <th>Date</th><th>Vendor</th><th>Store Location</th><th>Item Description</th><th>Category</th>
      <th>Job / Project</th><th>Specification</th><th>Qty</th><th>Unit Price</th><th>Item Total</th>
      <th>Sales Tax</th><th>Subtotal</th><th>Payment Method</th><th>Receipt / Order Number</th><th></th>
    </tr></thead>
    <tbody>${rows.map(_rcLineItemTableRowHtml).join("")}</tbody>
  </table>
</div>`;
}

function _rcRenderBucketTab(bucket) {
  const rows = _rcApplyClientFilters(_rcAllRows.filter((r) => r.bucket === bucket));
  const wrap = document.getElementById(`rc-months-${bucket}`);
  document.getElementById(`rc-empty-${bucket}`).hidden = rows.length > 0;
  const months = saaReceiptsGroupByMonth(rows);
  wrap.innerHTML = months.map((m) => {
    const total = m.rows.reduce((sum, r) => sum + (saaLineTotal(r) || 0), 0);
    const receiptCount = new Set(m.rows.map((r) => r.receipt_id)).size;
    // Flat, spreadsheet-style rows sorted oldest-to-newest within the month
    // (matches Vijayan's own tracking sheet), not grouped by receipt.
    const sortedRows = m.rows.slice().sort((a, b) => (a.r_received_at || "").localeCompare(b.r_received_at || ""));
    return `
<div class="rc-month-header" data-month="${m.key}">
  <span>${m.label} <span class="muted">(${m.rows.length} line item${m.rows.length === 1 ? "" : "s"} / ${receiptCount} receipt${receiptCount === 1 ? "" : "s"})</span></span>
  <span class="rc-month-total">${_rcMoney(total)} <span class="rc-month-arrow">&#9660;</span></span>
</div>
<div class="rc-month-rows" data-month-rows="${m.key}">
  ${_rcLineItemsTableHtml(sortedRows)}
</div>`;
  }).join("");

  wrap.querySelectorAll(".rc-month-header").forEach((h) => {
    h.addEventListener("click", () => {
      h.classList.toggle("rc-month-collapsed");
      wrap.querySelector(`.rc-month-rows[data-month-rows="${h.dataset.month}"]`).classList.toggle("rc-month-collapsed");
    });
  });
  wrap.querySelectorAll(".rc-edit-btn").forEach((b) => {
    b.addEventListener("click", () => _rcOpenEdit(b.dataset.id));
  });
}

function _rcRenderOverview() {
  const rows = _rcApplyClientFilters(_rcAllRows);
  const s = saaReceiptsSummary(rows);
  const cards = [
    { label: "Total Spend", value: _rcMoney(s.grandTotal), sub: `${s.count} line item${s.count === 1 ? "" : "s"}` },
    { label: "Receipts", value: _rcMoney(s.byBucket.receipts.total), sub: `${s.byBucket.receipts.count} line items` },
    { label: "Tools", value: _rcMoney(s.byBucket.tools.total), sub: `${s.byBucket.tools.count} line items` },
    { label: "Supplies", value: _rcMoney(s.byBucket.supplies.total), sub: `${s.byBucket.supplies.count} line items` },
    { label: "Needs Review", value: String(s.needsReview), sub: "auto-tagged, unconfirmed" },
  ];
  document.getElementById("rc-summary-cards").innerHTML = cards.map((c) => `
<div class="rc-summary-card">
  <div class="rc-sc-label">${_rcEsc(c.label)}</div>
  <div class="rc-sc-value">${c.value}</div>
  <div class="rc-sc-sub">${_rcEsc(c.sub)}</div>
</div>`).join("");

  const catGroups = saaReceiptsByCategory(rows);
  document.getElementById("rc-category-tbody").innerHTML = catGroups.map((g) => `
<tr><td>${_rcEsc(g.category)}</td><td>${g.count}</td><td>${_rcMoney(g.total)}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No line items match your filters.</td></tr>`;

  const projGroups = saaReceiptsByProject(rows);
  document.getElementById("rc-project-tbody").innerHTML = projGroups.map((g) => `
<tr>
  <td>${_rcEsc(g.label)}</td><td>${g.count}</td><td>${_rcMoney(g.total)}</td>
  <td>${g.job_id ? `<a class="btn btn-ghost btn-sm" href="jobs.html?job=${g.job_id}">Open Job &rarr;</a>` : ""}</td>
</tr>`).join("")
    || `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No line items match your filters.</td></tr>`;
}

function _rcRenderActiveTab() {
  if (_rcActiveTab === "overview") _rcRenderOverview();
  else _rcRenderBucketTab(_rcActiveTab);
}

function _rcSwitchTab(tab) {
  _rcActiveTab = tab;
  document.querySelectorAll("#rc-tabs .cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".rc-tab-panel").forEach((p) => { p.hidden = true; });
  const panel = document.getElementById(`rc-panel-${tab}`);
  if (panel) panel.hidden = false;
  _rcRenderActiveTab();
}

/* ---- Edit modal (edits one line item) ---- */

function _rcOpenEdit(id) {
  const li = _rcAllRows.find((x) => x.id === id);
  if (!li) return;
  document.getElementById("rc-edit-overlay").dataset.id = id;
  document.getElementById("rc-edit-subject").textContent = `${li.r_vendor || ""} — ${_rcDate(li.r_received_at)}${li.r_receipt_number ? " — " + li.r_receipt_number : ""}`;
  document.getElementById("rc-edit-bucket").value = li.bucket || "receipts";
  const catSel = document.getElementById("rc-edit-category-select");
  const catNew = document.getElementById("rc-edit-category-new");
  const hasOption = li.category && [...catSel.options].some((o) => o.value === li.category);
  if (li.category && !hasOption) {
    // Category isn't in the current option list (e.g. freshly typed on another
    // row before this modal's dropdown last refreshed) -- fall back to "new".
    catSel.value = RC_NEW_CATEGORY_VALUE;
    catNew.hidden = false;
    catNew.value = li.category;
  } else {
    catSel.value = li.category || "";
    catNew.hidden = true;
    catNew.value = "";
  }
  document.getElementById("rc-edit-item").value = li.item_description || "";
  document.getElementById("rc-edit-spec").value = li.specification || "";
  document.getElementById("rc-edit-amount").value = li.item_total == null ? "" : li.item_total;
  document.getElementById("rc-edit-tax").value = li.sales_tax == null ? "" : li.sales_tax;
  document.getElementById("rc-edit-notes").value = li.notes || "";
  document.getElementById("rc-edit-job").value = li.job_id || "";
  document.getElementById("rc-edit-view-email").href = li.r_gmail_view_url || "#";
  document.getElementById("rc-edit-status").textContent = "";
  document.getElementById("rc-edit-overlay").hidden = false;
}

async function _rcSaveEdit() {
  const overlay = document.getElementById("rc-edit-overlay");
  const id = overlay.dataset.id;
  const statusEl = document.getElementById("rc-edit-status");
  statusEl.textContent = "Saving…";
  const jobSel = document.getElementById("rc-edit-job");
  const jobOpt = _rcJobOptions.find((o) => o.job_id === jobSel.value);
  const catSelVal = document.getElementById("rc-edit-category-select").value;
  const category = catSelVal === RC_NEW_CATEGORY_VALUE
    ? document.getElementById("rc-edit-category-new").value.trim()
    : catSelVal;
  const patch = {
    bucket: document.getElementById("rc-edit-bucket").value,
    category: category,
    item_description: document.getElementById("rc-edit-item").value,
    specification: document.getElementById("rc-edit-spec").value,
    item_total: document.getElementById("rc-edit-amount").value,
    sales_tax: document.getElementById("rc-edit-tax").value,
    notes: document.getElementById("rc-edit-notes").value,
    job_id: jobSel.value || null,
    customer_id: jobOpt ? jobOpt.customer_id : null,
    project_label: jobOpt ? null : undefined,
  };
  const res = await saaLineItemUpdate(id, patch);
  if (res.error) { statusEl.textContent = res.error; return; }
  overlay.hidden = true;
  await _rcLoadAll();
}

/* ---- Wiring ---- */

document.addEventListener("DOMContentLoaded", async () => {
  _rcJobOptions = await saaReceiptsFetchJobPickerOptions();
  const jobSel = document.getElementById("rc-edit-job");
  _rcJobOptions.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.job_id;
    opt.textContent = o.label;
    jobSel.appendChild(opt);
  });

  document.querySelectorAll("#rc-tabs .cal-view-btn").forEach((b) => {
    b.addEventListener("click", () => _rcSwitchTab(b.dataset.tab));
  });
  document.getElementById("rc-search").addEventListener("input", () => { clearTimeout(window._rcSearchT); window._rcSearchT = setTimeout(_rcLoadAll, 250); });
  document.getElementById("rc-needs-review-only").addEventListener("change", _rcRenderActiveTab);
  document.getElementById("rc-edit-category-select").addEventListener("change", _rcOnCategorySelectChange);
  document.getElementById("rc-clear-btn").addEventListener("click", () => {
    document.getElementById("rc-search").value = "";
    document.getElementById("rc-needs-review-only").checked = false;
    _rcLoadAll();
  });
  document.getElementById("rc-edit-close").addEventListener("click", () => { document.getElementById("rc-edit-overlay").hidden = true; });
  document.getElementById("rc-edit-save").addEventListener("click", _rcSaveEdit);

  // The Overview tab starts marked "active" in the generated markup, but
  // every tab panel starts with the `hidden` attribute set (so a tab
  // button's own click handler is the only thing that clears it) --
  // _rcSwitchTab does that unhide, so it needs to run once up front for
  // the default tab, not just on a later click.
  _rcSwitchTab("overview");
  await _rcLoadAll();
});
