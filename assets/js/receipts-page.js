/* ============================================================
   SAA Comfort Air LLC — Receipts page logic (employee/receipts.html)
   Renders the Equipment / Tools / Supplies tabs (grouped by month,
   collapsible) plus Summary / By Category / By Project, from
   receipts-db.js. Round 49 (2026-09-24).
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
  return b === "equipment" ? "Equipment" : b === "tools" ? "Tools" : b === "supplies" ? "Supplies" : (b || "");
}

let _rcAllRows = [];
let _rcJobOptions = [];
let _rcActiveTab = "equipment";

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
  const rows = await saaReceiptsFetchAll(_rcFilters());
  _rcAllRows = rows;
  document.getElementById("rc-count").textContent = `${rows.length} receipt${rows.length === 1 ? "" : "s"}`;
  _rcRenderActiveTab();
}

function _rcReceiptRowHtml(r) {
  const reviewBadge = r.auto_tagged ? `<span class="rc-badge rc-badge-review">needs review</span>` : "";
  return `
<div class="rc-receipt-row" data-id="${r.id}">
  <div class="rc-r-date">${_rcDate(r.received_at)}</div>
  <div class="rc-r-main">
    <div class="rc-r-vendor">${_rcEsc(r.vendor) || "&mdash;"} ${reviewBadge}</div>
    <div class="rc-r-item">${_rcEsc(r.item_description) || _rcEsc(r.subject)}</div>
    <div class="rc-r-category">${_rcEsc(r.category) || "Uncategorized"}</div>
  </div>
  <div class="rc-r-project muted">${_rcEsc(_rcProjectLabel(r))}</div>
  <div class="rc-r-amount">${r.amount_total == null ? "&mdash;" : _rcMoney(r.amount_total)}</div>
  <button type="button" class="btn btn-ghost btn-sm rc-edit-btn" data-id="${r.id}">Edit</button>
</div>`;
}

function _rcRenderBucketTab(bucket) {
  const rows = _rcApplyClientFilters(_rcAllRows.filter((r) => r.bucket === bucket));
  const wrap = document.getElementById(`rc-months-${bucket}`);
  document.getElementById(`rc-empty-${bucket}`).hidden = rows.length > 0;
  const groups = saaReceiptsGroupByMonth(rows);
  wrap.innerHTML = groups.map((g) => {
    const total = g.rows.reduce((sum, r) => sum + Number(r.amount_total || 0), 0);
    return `
<div class="rc-month-header" data-month="${g.key}">
  <span>${g.label} <span class="muted">(${g.rows.length})</span></span>
  <span class="rc-month-total">${_rcMoney(total)} <span class="rc-month-arrow">&#9660;</span></span>
</div>
<div class="rc-month-rows" data-month-rows="${g.key}">
  ${g.rows.map(_rcReceiptRowHtml).join("")}
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

function _rcRenderSummary() {
  const rows = _rcApplyClientFilters(_rcAllRows);
  const s = saaReceiptsSummary(rows);
  const cards = [
    { label: "Total Spend", value: _rcMoney(s.grandTotal), sub: `${s.count} receipt${s.count === 1 ? "" : "s"}` },
    { label: "Equipment", value: _rcMoney(s.byBucket.equipment.total), sub: `${s.byBucket.equipment.count} receipts` },
    { label: "Tools", value: _rcMoney(s.byBucket.tools.total), sub: `${s.byBucket.tools.count} receipts` },
    { label: "Supplies", value: _rcMoney(s.byBucket.supplies.total), sub: `${s.byBucket.supplies.count} receipts` },
    { label: "Needs Review", value: String(s.needsReview), sub: "auto-tagged, unconfirmed" },
  ];
  document.getElementById("rc-summary-cards").innerHTML = cards.map((c) => `
<div class="rc-summary-card">
  <div class="rc-sc-label">${_rcEsc(c.label)}</div>
  <div class="rc-sc-value">${c.value}</div>
  <div class="rc-sc-sub">${_rcEsc(c.sub)}</div>
</div>`).join("");
}

function _rcRenderCategory() {
  const rows = _rcApplyClientFilters(_rcAllRows);
  const groups = saaReceiptsByCategory(rows);
  document.getElementById("rc-category-tbody").innerHTML = groups.map((g) => `
<tr><td>${_rcEsc(g.category)}</td><td>${g.count}</td><td>${_rcMoney(g.total)}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No receipts match your filters.</td></tr>`;
}

function _rcRenderProject() {
  const rows = _rcApplyClientFilters(_rcAllRows);
  const groups = saaReceiptsByProject(rows);
  document.getElementById("rc-project-tbody").innerHTML = groups.map((g) => `
<tr>
  <td>${_rcEsc(g.label)}</td><td>${g.count}</td><td>${_rcMoney(g.total)}</td>
  <td>${g.job_id ? `<a class="btn btn-ghost btn-sm" href="jobs.html?job=${g.job_id}">Open Job &rarr;</a>` : ""}</td>
</tr>`).join("")
    || `<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No receipts match your filters.</td></tr>`;
}

function _rcRenderActiveTab() {
  if (["equipment", "tools", "supplies"].includes(_rcActiveTab)) _rcRenderBucketTab(_rcActiveTab);
  else if (_rcActiveTab === "summary") _rcRenderSummary();
  else if (_rcActiveTab === "category") _rcRenderCategory();
  else if (_rcActiveTab === "project") _rcRenderProject();
}

function _rcSwitchTab(tab) {
  _rcActiveTab = tab;
  document.querySelectorAll("#rc-tabs .cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".rc-tab-panel").forEach((p) => { p.hidden = true; });
  const panel = document.getElementById(`rc-panel-${tab}`);
  if (panel) panel.hidden = false;
  _rcRenderActiveTab();
}

/* ---- Edit modal ---- */

function _rcOpenEdit(id) {
  const r = _rcAllRows.find((x) => x.id === id);
  if (!r) return;
  document.getElementById("rc-edit-overlay").dataset.id = id;
  document.getElementById("rc-edit-subject").textContent = r.subject || "";
  document.getElementById("rc-edit-bucket").value = r.bucket || "equipment";
  document.getElementById("rc-edit-category").value = r.category || "";
  document.getElementById("rc-edit-item").value = r.item_description || "";
  document.getElementById("rc-edit-vendor").value = r.vendor || "";
  document.getElementById("rc-edit-amount").value = r.amount_total == null ? "" : r.amount_total;
  document.getElementById("rc-edit-notes").value = r.notes || "";
  document.getElementById("rc-edit-job").value = r.job_id || "";
  document.getElementById("rc-edit-view-email").href = r.gmail_view_url || "#";
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
    vendor: document.getElementById("rc-edit-vendor").value,
    amount_total: document.getElementById("rc-edit-amount").value,
    notes: document.getElementById("rc-edit-notes").value,
    job_id: jobSel.value || null,
    customer_id: jobOpt ? jobOpt.customer_id : null,
  };
  const res = await saaReceiptUpdate(id, patch);
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

  // The Equipment tab starts marked "active" in the generated markup, but
  // every tab panel starts with the `hidden` attribute set (so a tab
  // button's own click handler is the only thing that clears it) --
  // _rcSwitchTab does that unhide, so it needs to run once up front for
  // the default tab, not just on a later click.
  _rcSwitchTab("equipment");
  await _rcLoadAll();
});
