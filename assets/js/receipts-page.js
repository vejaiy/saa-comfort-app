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
  _rcRenderActiveTab();
}

function _rcLineItemRowHtml(li) {
  const reviewBadge = li.auto_tagged ? `<span class="rc-badge rc-badge-review">needs review</span>` : "";
  const total = saaLineTotal(li);
  return `
<div class="rc-receipt-row" data-id="${li.id}">
  <div class="rc-r-main">
    <div class="rc-r-vendor">${_rcEsc(li.item_description) || "&mdash;"} ${reviewBadge}</div>
    <div class="rc-r-item">${_rcEsc(li.category) || "Uncategorized"}${li.qty ? ` &middot; qty ${li.qty}` : ""}</div>
    ${li.notes ? `<div class="rc-r-item muted">${_rcEsc(li.notes)}</div>` : ""}
  </div>
  <div class="rc-r-project muted">${_rcEsc(_rcProjectLabel(li))}</div>
  <div class="rc-r-amount">${total == null ? "&mdash;" : _rcMoney(total)}</div>
  <button type="button" class="btn btn-ghost btn-sm rc-edit-btn" data-id="${li.id}">Edit</button>
</div>`;
}

function _rcReceiptCardHtml(group) {
  const first = group.lines[0];
  const subtotal = group.lines.reduce((sum, li) => sum + (saaLineTotal(li) || 0), 0);
  const meta = [first.r_receipt_number, first.r_store_location].filter(Boolean).join(" &middot; ");
  return `
<div class="rc-receipt-card" style="border:1px solid var(--line);border-radius:var(--radius);margin-bottom:14px;overflow:hidden">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 14px;background:#f8fafb;border-bottom:1px solid var(--line);flex-wrap:wrap">
    <div>
      <span style="font-weight:700">${_rcEsc(first.r_vendor) || "&mdash;"}</span>
      <span class="muted" style="font-size:.82rem;margin-left:8px">${_rcDate(first.r_received_at)}</span>
      ${meta ? `<div class="muted" style="font-size:.78rem">${meta}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:10px">
      <span style="font-weight:600">${_rcMoney(subtotal)}</span>
      <a href="#" target="_blank" class="btn btn-ghost btn-sm" onclick="this.href='${_rcEsc(first.r_gmail_view_url) || '#'}'">View Email &rarr;</a>
    </div>
  </div>
  <div style="padding:8px 12px">
    ${group.lines.map(_rcLineItemRowHtml).join("")}
  </div>
</div>`;
}

function _rcRenderBucketTab(bucket) {
  const rows = _rcApplyClientFilters(_rcAllRows.filter((r) => r.bucket === bucket));
  const wrap = document.getElementById(`rc-months-${bucket}`);
  document.getElementById(`rc-empty-${bucket}`).hidden = rows.length > 0;
  const months = saaReceiptsGroupByMonth(rows);
  wrap.innerHTML = months.map((m) => {
    const total = m.rows.reduce((sum, r) => sum + (saaLineTotal(r) || 0), 0);
    const receiptGroups = saaGroupByReceipt(m.rows);
    return `
<div class="rc-month-header" data-month="${m.key}">
  <span>${m.label} <span class="muted">(${m.rows.length} line item${m.rows.length === 1 ? "" : "s"} / ${receiptGroups.length} receipt${receiptGroups.length === 1 ? "" : "s"})</span></span>
  <span class="rc-month-total">${_rcMoney(total)} <span class="rc-month-arrow">&#9660;</span></span>
</div>
<div class="rc-month-rows" data-month-rows="${m.key}">
  ${receiptGroups.map(_rcReceiptCardHtml).join("")}
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
  document.getElementById("rc-edit-category").value = li.category || "";
  document.getElementById("rc-edit-item").value = li.item_description || "";
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
  const patch = {
    bucket: document.getElementById("rc-edit-bucket").value,
    category: document.getElementById("rc-edit-category").value,
    item_description: document.getElementById("rc-edit-item").value,
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
