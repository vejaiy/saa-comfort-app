/* ============================================================
   SAA Comfort Air LLC — Expenses tab (employee/receipts.html)
   Round 76 (2026-09-30). Record expenses for SAA in general, for a
   job / project, or for tools -- food, travel, subcontract, advisory, or
   any category you add. Filters, totals, by-category table, months,
   reimbursement tracking, receipt photos / PDFs, Excel + PDF downloads.
   Depends on receipts-db.js, expenses-db.js and receipts-page.js globals
   (_rcEsc, _rcMoney, _rcJobOptions, _rcCsvField, _rcSwitchTab, ...).
   ============================================================ */

let _exAll = [];
let _exPayers = [];
let _exEditing = null;      // the expense being edited, or null for a new one
let _exPendingRemove = [];  // attachment paths to delete when Save is pressed
let _exTaxAuto = "";        // last auto-suggested tax category (so a manual pick isn't overwritten)
const EX_NEW_CATEGORY = "__new__";

function _exDate(s) {
  const d = saaExpenseDateObj(s);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
function _exFullDate(s) {
  const d = saaExpenseDateObj(s);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
function _exToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function _exJobLabel(e) {
  if (e.scope !== "job") return "";
  const o = (typeof _rcJobOptions !== "undefined" ? _rcJobOptions : []).find((x) => x.job_id === e.job_id);
  return o ? o.label : (e.job_id ? "Job" : "Job (removed)");
}
function _exAppliesTo(e) {
  return e.scope === "job" ? _exJobLabel(e) : saaExpenseScopeLabel(e.scope);
}
function _exCategories() {
  const used = _exAll.map((e) => e.category).filter(Boolean);
  return [...new Set(SAA_EXPENSE_DEFAULT_CATEGORIES.concat(used))].sort((a, b) => a.localeCompare(b));
}

/* ---------------- Filters ---------------- */

function _exFilters() {
  return {
    period: document.getElementById("ex-f-period").value,
    category: document.getElementById("ex-f-category").value,
    scope: document.getElementById("ex-f-scope").value,
    owedOnly: document.getElementById("ex-f-owed").checked,
    search: document.getElementById("rc-search").value,
    jobLabel: _exJobLabel,
  };
}
function _exFiltered() { return saaExpensesFilter(_exAll, _exFilters()); }

function _exRefreshCategoryFilter() {
  const sel = document.getElementById("ex-f-category");
  const prev = sel.value;
  sel.innerHTML = `<option value="">All categories</option>` + _exCategories().map((c) => `<option value="${_rcEsc(c)}">${_rcEsc(c)}</option>`).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/* ---------------- Render ---------------- */

function _exRowHtml(e) {
  let reimb = `<span class="muted">&mdash;</span>`;
  if (e.reimbursable) {
    reimb = e.reimbursed
      ? `<span class="rc-badge ex-badge-ok">reimbursed${e.reimbursed_on ? " " + _rcEsc(_exDate(e.reimbursed_on)) : ""}</span>`
      : `<span class="rc-badge rc-badge-review">owed back</span>`;
  }
  const files = (e.file_paths || []).length;
  const tax = e.tax_deductible ? (e.tax_category ? _rcEsc(e.tax_category) : "Deductible") : `<span class="muted">Not deductible</span>`;
  const payBits = [e.paid_by, e.payment_method].filter(Boolean).map(_rcEsc).join(" &middot; ");
  return `
<tr class="jb-row" data-id="${e.id}">
  <td>${_exDate(e.expense_date)}</td>
  <td>${_rcEsc(e.vendor) || "&mdash;"}</td>
  <td>${_rcEsc(e.description)}${e.notes ? `<div class="muted" style="font-size:.78rem;white-space:normal">${_rcEsc(e.notes)}</div>` : ""}</td>
  <td>${_rcEsc(e.category)}</td>
  <td>${_rcEsc(_exAppliesTo(e))}</td>
  <td class="ex-amt">${_rcMoney(e.amount)}</td>
  <td>${payBits || "&mdash;"}</td>
  <td>${reimb}</td>
  <td>${tax}</td>
  <td>${files ? `<span title="${files} attachment${files === 1 ? "" : "s"}">&#128206; ${files}</span>` : ""}</td>
  <td style="white-space:nowrap"><button type="button" class="btn btn-ghost btn-sm ex-edit-btn" data-id="${e.id}">Edit</button></td>
</tr>`;
}

function saaExpensesRender() {
  if (!document.getElementById("ex-months")) return;
  const rows = _exFiltered();
  const s = saaExpensesSummary(rows);
  document.getElementById("rc-count").textContent = `${rows.length} expense${rows.length === 1 ? "" : "s"} · ${_rcMoney(s.total)}`;

  const cards = [
    { label: "Total Expenses", value: _rcMoney(s.total), sub: `${s.count} expense${s.count === 1 ? "" : "s"}` },
    { label: "SAA (general)", value: _rcMoney(s.byScope.saa), sub: "business-wide" },
    { label: "Jobs / Projects", value: _rcMoney(s.byScope.job), sub: "tied to a job" },
    { label: "Tools", value: _rcMoney(s.byScope.tools), sub: "tool-related" },
    { label: "Owed Back", value: _rcMoney(s.owed), sub: `${s.owedCount} to reimburse`, owed: true, warn: s.owed > 0 },
  ];
  const host = document.getElementById("ex-summary");
  host.innerHTML = cards.map((c) => {
    const inner = `<div class="rc-sc-label">${_rcEsc(c.label)}</div><div class="rc-sc-value">${c.value}</div><div class="rc-sc-sub">${_rcEsc(c.sub)}</div>` +
      (c.owed ? `<div class="rc-sc-go">${document.getElementById("ex-f-owed").checked ? "Show all" : "Show only these"} &rarr;</div>` : "");
    return c.owed
      ? `<button type="button" class="rc-summary-card rc-summary-btn${c.warn ? " rc-summary-warn" : ""}" id="ex-owed-tile">${inner}</button>`
      : `<div class="rc-summary-card">${inner}</div>`;
  }).join("");
  const owedTile = document.getElementById("ex-owed-tile");
  if (owedTile) owedTile.addEventListener("click", () => {
    const cb = document.getElementById("ex-f-owed");
    cb.checked = !cb.checked;
    saaExpensesRender();
  });

  document.getElementById("ex-category-tbody").innerHTML = saaExpensesByCategory(rows).map((g) =>
    `<tr><td>${_rcEsc(g.category)}</td><td>${g.count}</td><td>${_rcMoney(g.total)}</td></tr>`).join("")
    || `<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No expenses match your filters.</td></tr>`;

  const wrap = document.getElementById("ex-months");
  document.getElementById("ex-empty").hidden = rows.length > 0;
  wrap.innerHTML = saaExpensesGroupByMonth(rows).map((m) => {
    const total = m.rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const sorted = m.rows.slice().sort((a, b) => (a.expense_date || "").localeCompare(b.expense_date || ""));
    return `
<div class="rc-month-header" data-month="${m.key}">
  <span>${_rcEsc(m.label)} <span class="muted">(${m.rows.length} expense${m.rows.length === 1 ? "" : "s"})</span></span>
  <span class="rc-month-total">${_rcMoney(total)} <span class="rc-month-arrow">&#9660;</span></span>
</div>
<div class="rc-month-rows" data-month-rows="${m.key}">
  <div class="jobs-table-wrap rc-table-scroll">
    <table class="jobs-table ex-table">
      <thead><tr><th>Date</th><th>Payee</th><th>Description</th><th>Category</th><th>Applies To</th><th>Amount</th><th>Paid By / Method</th><th>Reimbursement</th><th>Tax</th><th>Files</th><th></th></tr></thead>
      <tbody>${sorted.map(_exRowHtml).join("")}</tbody>
    </table>
  </div>
</div>`;
  }).join("");
  wrap.querySelectorAll(".rc-month-header").forEach((h) => {
    h.addEventListener("click", () => {
      h.classList.toggle("rc-month-collapsed");
      wrap.querySelector(`.rc-month-rows[data-month-rows="${h.dataset.month}"]`).classList.toggle("rc-month-collapsed");
    });
  });
  wrap.querySelectorAll(".ex-edit-btn").forEach((b) => b.addEventListener("click", () => _exOpenModal(b.dataset.id)));
}

async function saaExpensesLoad() {
  _exAll = await saaExpensesFetchAll();
  _exRefreshCategoryFilter();
  saaExpensesRender();
  if (typeof _rcActiveTab !== "undefined" && _rcActiveTab === "overview" && typeof _rcRenderOverview === "function") _rcRenderOverview();
}

/* ---------------- Downloads ---------------- */

function _exPeriodLabel() {
  const sel = document.getElementById("ex-f-period");
  return sel.options[sel.selectedIndex].textContent;
}

function _exDownloadCsv() {
  const rows = _exFiltered().slice().sort((a, b) => (a.expense_date || "").localeCompare(b.expense_date || ""));
  const header = ["Date", "Payee", "Description", "Category", "Applies To", "Amount", "Payment Method", "Paid By",
    "Reimbursable", "Reimbursed", "Reimbursed On", "Tax Deductible", "Tax Category", "Notes"];
  const lines = [header.map(_rcCsvField).join(",")];
  let total = 0;
  rows.forEach((e) => {
    total += Number(e.amount) || 0;
    lines.push([
      _exFullDate(e.expense_date), e.vendor, e.description, e.category, _exAppliesTo(e), e.amount, e.payment_method, e.paid_by,
      e.reimbursable ? "Yes" : "No", e.reimbursable ? (e.reimbursed ? "Yes" : "No") : "", e.reimbursed_on ? _exFullDate(e.reimbursed_on) : "",
      e.tax_deductible ? "Yes" : "No", e.tax_category, e.notes,
    ].map(_rcCsvField).join(","));
  });
  if (rows.length) lines.push(["", "", "", "", "Total", total.toFixed(2), "", "", "", "", "", "", "", ""].join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SAA-expenses-${_exPeriodLabel().replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function _exDownloadPdf() {
  const rows = _exFiltered().slice().sort((a, b) => (a.expense_date || "").localeCompare(b.expense_date || ""));
  printReceipts({
    bucketLabel: "Expenses",
    periodLabel: _exPeriodLabel(),
    generatedOn: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    rows: rows.map((e) => ({
      dateLabel: _exFullDate(e.expense_date),
      r_vendor: e.vendor,
      item_description: e.description,
      category: e.category,
      projectLabel: _exAppliesTo(e),
      qty: null,
      item_total: e.amount,
      sales_tax: null,
      subtotal: e.amount,
    })),
  });
}

/* ---------------- Add / edit modal ---------------- */

function _exFillCategorySelect(selected) {
  const sel = document.getElementById("ex-cat-select");
  const cats = _exCategories();
  if (selected && !cats.includes(selected)) cats.push(selected);
  sel.innerHTML = `<option value="">&mdash; Select category &mdash;</option>` +
    cats.map((c) => `<option value="${_rcEsc(c)}">${_rcEsc(c)}</option>`).join("") +
    `<option value="${EX_NEW_CATEGORY}">+ Add new category&hellip;</option>`;
  sel.value = selected || "";
  document.getElementById("ex-cat-new").hidden = true;
  document.getElementById("ex-cat-new").value = "";
}
function _exFillPayers(selected) {
  const sel = document.getElementById("ex-paidby");
  const opts = [SAA_EXPENSE_COMPANY_PAYER, SAA_EXPENSE_OWNER_PAYER].concat(_exPayers.filter((n) => n !== "Vijayan"), ["Someone else (see notes)"]);
  if (selected && !opts.includes(selected)) opts.splice(opts.length - 1, 0, selected);
  sel.innerHTML = `<option value="">&mdash; Select &mdash;</option>` + opts.map((o) => `<option value="${_rcEsc(o)}">${_rcEsc(o)}</option>`).join("");
  sel.value = selected || "";
}
function _exFillSimpleSelect(id, list, selected, blankLabel) {
  const sel = document.getElementById(id);
  const opts = list.slice();
  if (selected && !opts.includes(selected)) opts.push(selected);
  sel.innerHTML = `<option value="">${blankLabel}</option>` + opts.map((o) => `<option value="${_rcEsc(o)}">${_rcEsc(o)}</option>`).join("");
  sel.value = selected || "";
}
function _exFillJobs(selected) {
  const sel = document.getElementById("ex-job");
  sel.innerHTML = `<option value="">&mdash; Select job / project &mdash;</option>` +
    (typeof _rcJobOptions !== "undefined" ? _rcJobOptions : []).map((o) => `<option value="${o.job_id}">${_rcEsc(o.label)}</option>`).join("");
  sel.value = selected || "";
}

function _exSyncVisibility() {
  document.getElementById("ex-job-wrap").hidden = document.getElementById("ex-scope").value !== "job";
  const reimb = document.getElementById("ex-reimb").checked;
  document.getElementById("ex-reimb-more").hidden = !reimb;
  document.getElementById("ex-reimbursed-on-wrap").hidden = !(reimb && document.getElementById("ex-reimbursed").checked);
  document.getElementById("ex-taxcat-wrap").hidden = !document.getElementById("ex-taxded").checked;
}

function _exRenderExistingFiles() {
  const host = document.getElementById("ex-files-existing");
  const paths = ((_exEditing && _exEditing.file_paths) || []).filter((p) => !_exPendingRemove.includes(p));
  host.innerHTML = paths.map((p, i) => {
    const ext = (p.split(".").pop() || "").toUpperCase();
    return `<div class="ex-file" data-path="${_rcEsc(p)}">
      <button type="button" class="btn btn-ghost btn-sm ex-file-view">&#128206; Attachment ${i + 1} (${_rcEsc(ext)}) &mdash; View</button>
      <button type="button" class="ex-file-x" aria-label="Remove attachment" title="Remove">&times;</button>
    </div>`;
  }).join("");
}

function _exOpenModal(id) {
  _exEditing = id ? _exAll.find((x) => x.id === id) || null : null;
  _exPendingRemove = [];
  const e = _exEditing;
  document.getElementById("ex-title").textContent = e ? "Edit Expense" : "Add Expense";
  document.getElementById("ex-date").value = e ? e.expense_date : _exToday();
  document.getElementById("ex-amount").value = e ? e.amount : "";
  document.getElementById("ex-vendor").value = e ? (e.vendor || "") : "";
  document.getElementById("ex-desc").value = e ? (e.description || "") : "";
  _exFillCategorySelect(e ? e.category : "");
  document.getElementById("ex-scope").value = e ? e.scope : "saa";
  _exFillJobs(e ? e.job_id : "");
  _exFillSimpleSelect("ex-method", SAA_EXPENSE_PAYMENT_METHODS, e ? e.payment_method : "", "&mdash; Select &mdash;");
  _exFillPayers(e ? e.paid_by : SAA_EXPENSE_COMPANY_PAYER);
  document.getElementById("ex-reimb").checked = e ? !!e.reimbursable : false;
  document.getElementById("ex-reimbursed").checked = e ? !!e.reimbursed : false;
  document.getElementById("ex-reimbursed-on").value = e && e.reimbursed_on ? e.reimbursed_on : _exToday();
  document.getElementById("ex-taxded").checked = e ? !!e.tax_deductible : true;
  _exFillSimpleSelect("ex-taxcat", SAA_EXPENSE_TAX_CATEGORIES, e ? e.tax_category : "", "&mdash; Select &mdash;");
  _exTaxAuto = "";
  document.getElementById("ex-notes").value = e ? (e.notes || "") : "";
  document.getElementById("ex-files").value = "";
  _exRenderExistingFiles();
  document.getElementById("ex-delete").hidden = !e;
  document.getElementById("ex-status").textContent = "";
  _exSyncVisibility();
  document.getElementById("ex-overlay").hidden = false;
}

function _exCloseModal() { document.getElementById("ex-overlay").hidden = true; }

function _exOnCategoryChange() {
  const sel = document.getElementById("ex-cat-select");
  const isNew = sel.value === EX_NEW_CATEGORY;
  const input = document.getElementById("ex-cat-new");
  input.hidden = !isNew;
  if (isNew) { input.value = ""; input.focus(); }
  // Suggest the matching tax category unless one was picked by hand.
  const taxSel = document.getElementById("ex-taxcat");
  const suggested = SAA_EXPENSE_TAX_DEFAULTS[sel.value];
  if (suggested && (!taxSel.value || taxSel.value === _exTaxAuto)) {
    taxSel.value = suggested;
    _exTaxAuto = suggested;
  }
}

function _exOnPaidByChange() {
  const v = document.getElementById("ex-paidby").value;
  if (!v) return;
  const personal = v !== SAA_EXPENSE_COMPANY_PAYER;
  document.getElementById("ex-reimb").checked = personal; // paid out of pocket -> owed back (can be unticked)
  if (!personal) document.getElementById("ex-reimbursed").checked = false;
  _exSyncVisibility();
}

async function _exSave() {
  const status = document.getElementById("ex-status");
  const btn = document.getElementById("ex-save");
  const catSel = document.getElementById("ex-cat-select").value;
  const category = catSel === EX_NEW_CATEGORY ? document.getElementById("ex-cat-new").value.trim() : catSel;
  const scope = document.getElementById("ex-scope").value;
  const jobId = document.getElementById("ex-job").value;
  const jobOpt = (typeof _rcJobOptions !== "undefined" ? _rcJobOptions : []).find((o) => o.job_id === jobId);
  const existingKept = ((_exEditing && _exEditing.file_paths) || []).filter((p) => !_exPendingRemove.includes(p));
  const fields = {
    expense_date: document.getElementById("ex-date").value,
    amount: document.getElementById("ex-amount").value,
    vendor: document.getElementById("ex-vendor").value,
    description: document.getElementById("ex-desc").value,
    category,
    scope,
    job_id: jobId,
    customer_id: jobOpt ? jobOpt.customer_id : null,
    payment_method: document.getElementById("ex-method").value,
    paid_by: document.getElementById("ex-paidby").value,
    reimbursable: document.getElementById("ex-reimb").checked,
    reimbursed: document.getElementById("ex-reimbursed").checked,
    reimbursed_on: document.getElementById("ex-reimbursed-on").value,
    tax_deductible: document.getElementById("ex-taxded").checked,
    tax_category: document.getElementById("ex-taxcat").value,
    notes: document.getElementById("ex-notes").value,
    file_paths: existingKept,
  };
  btn.disabled = true;
  status.textContent = "Saving…";
  let res = await saaExpenseSave(_exEditing ? _exEditing.id : null, fields);
  if (!res.ok) { status.textContent = res.error; btn.disabled = false; return; }
  const saved = res.expense;

  let warn = "";
  const picked = Array.from(document.getElementById("ex-files").files || []);
  if (picked.length) {
    status.textContent = "Uploading attachment…";
    const up = await saaExpenseUploadFiles(saved.id, picked);
    if (up.paths.length) {
      const r2 = await saaExpenseSave(saved.id, Object.assign({}, fields, { file_paths: existingKept.concat(up.paths) }));
      if (!r2.ok) warn = "Saved, but the attachment link failed: " + r2.error;
    }
    if (up.errors.length) warn = "Saved, but some files did not upload: " + up.errors.join("; ");
  }
  if (_exPendingRemove.length) await saaExpenseRemoveFiles(_exPendingRemove);

  btn.disabled = false;
  if (warn) { status.textContent = warn; await saaExpensesLoad(); return; }
  _exCloseModal();
  await saaExpensesLoad();
}

async function _exDelete() {
  if (!_exEditing) return;
  if (!window.confirm("Delete this expense" + ((_exEditing.file_paths || []).length ? " and its attachments" : "") + "? This can't be undone.")) return;
  const res = await saaExpenseDelete(_exEditing);
  if (!res.ok) { document.getElementById("ex-status").textContent = res.error; return; }
  _exCloseModal();
  await saaExpensesLoad();
}

async function _exViewFile(path) {
  // Open the tab first (inside the tap) so phone browsers don't block it, then point it at the signed link.
  const w = window.open("", "_blank");
  const url = await saaExpenseSignedUrl(path);
  if (url) { if (w) w.location.href = url; else window.location.href = url; }
  else { if (w) w.close(); document.getElementById("ex-status").textContent = "Couldn't open that attachment."; }
}

/* ---------------- Wiring ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  if (!document.getElementById("ex-overlay")) return;
  document.getElementById("ex-add-btn").addEventListener("click", () => _exOpenModal(null));
  ["ex-f-period", "ex-f-category", "ex-f-scope", "ex-f-owed"].forEach((id) => document.getElementById(id).addEventListener("change", saaExpensesRender));
  document.getElementById("ex-dl-csv").addEventListener("click", _exDownloadCsv);
  document.getElementById("ex-dl-pdf").addEventListener("click", _exDownloadPdf);
  document.getElementById("rc-clear-btn").addEventListener("click", () => {
    document.getElementById("ex-f-period").value = "all";
    document.getElementById("ex-f-category").value = "";
    document.getElementById("ex-f-scope").value = "";
    document.getElementById("ex-f-owed").checked = false;
    saaExpensesRender();
  });

  document.getElementById("ex-close").addEventListener("click", _exCloseModal);
  document.getElementById("ex-cancel").addEventListener("click", _exCloseModal);
  document.getElementById("ex-save").addEventListener("click", _exSave);
  document.getElementById("ex-delete").addEventListener("click", _exDelete);
  document.getElementById("ex-cat-select").addEventListener("change", _exOnCategoryChange);
  document.getElementById("ex-paidby").addEventListener("change", _exOnPaidByChange);
  ["ex-scope", "ex-reimb", "ex-reimbursed", "ex-taxded"].forEach((id) => document.getElementById(id).addEventListener("change", _exSyncVisibility));
  document.getElementById("ex-files-existing").addEventListener("click", (ev) => {
    const row = ev.target.closest(".ex-file");
    if (!row) return;
    if (ev.target.closest(".ex-file-view")) _exViewFile(row.dataset.path);
    else if (ev.target.closest(".ex-file-x")) { _exPendingRemove.push(row.dataset.path); _exRenderExistingFiles(); }
  });

  _exPayers = await saaExpensesFetchPayers();
  await saaExpensesLoad();
});
