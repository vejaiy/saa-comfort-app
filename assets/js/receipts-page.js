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
  if (r.job && r.event) return `${r.job.job_number} / ${r.event.event_number}`;
  if (r.job) return r.job.job_number;
  if (r.customer) return `${r.customer.first_name} ${r.customer.last_name}`;
  return r.project_label || "Unassigned";
}
function _rcBucketLabel(b) {
  return b === "receipts" ? "Receipts" : b === "tools" ? "Tools" : b === "supplies" ? "Supplies" : (b || "");
}

// Newest first (Round 77, per Vijayan: "in webview and excel make descending
// order as default"). Same-day rows keep a stable, predictable order.
function _rcSortNewestFirst(rows) {
  return rows.slice().sort((a, b) => (b.r_received_at || "").localeCompare(a.r_received_at || ""));
}

let _rcAllRows = []; // all line items
let _rcJobOptions = [];
let _rcEventOptions = []; // Round 51: every Event, filtered client-side to the selected Job
let _rcActiveTab = "overview";

// Round 51 (2026-09-25): rebuild the "Event (optional)" select to only the
// Events that belong to the given Job, preserving `selectedEventId` if it's
// still one of that Job's Events (e.g. re-opening a row that's already
// event-linked) -- otherwise resets to blank, since a leftover Event from a
// DIFFERENT Job never makes sense once the Job selection changes.
// Round 80 (2026-10-01), per Vijayan ("change to show event list"): ONE
// Job / Event picker. Each job is listed with its own Events indented right
// under it (newest first); picking a job links the line to the whole job,
// picking an Event links it to that Event (and its job). Values: "<job id>"
// or "evt:<event id>".
function _rcFillJobEventSelect() {
  const sel = document.getElementById("rc-edit-job");
  let html = `<option value="">&mdash; Not linked to a job &mdash;</option>`;
  _rcJobOptions.forEach((j) => {
    html += `<option value="${j.job_id}">${_rcEsc(j.label)}</option>`;
    _rcEventOptions.filter((e) => e.job_id === j.job_id).forEach((e) => {
      html += `<option value="evt:${e.event_id}">&nbsp;&nbsp;&nbsp;&nbsp;&#8627; ${_rcEsc(e.label)}</option>`;
    });
  });
  sel.innerHTML = html;
}
function _rcJobEventValue(jobId, eventId) {
  if (eventId && _rcEventOptions.some((e) => e.event_id === eventId)) return "evt:" + eventId;
  return jobId || "";
}
function _rcParseJobEvent(val) {
  if (val && val.startsWith("evt:")) {
    const ev = _rcEventOptions.find((e) => e.event_id === val.slice(4));
    return { job_id: ev ? ev.job_id : null, event_id: ev ? ev.event_id : null };
  }
  return { job_id: val || null, event_id: null };
}

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
  //
  // "rc-lineitems-table" (2026-09-26, per Vijayan: "make columns straight
  // for items in receipt, tools, supplies tab") -- each month renders its
  // OWN <table>, and plain auto table layout sizes every table's columns
  // independently from that table's own content, so one month's columns
  // drift out of alignment with the next month's (or with Tools'/Supplies'
  // own month tables) whenever their content widths differ. The <colgroup>
  // below gives every one of these tables, in every bucket, the exact same
  // fixed column widths (see style.css), so they always line up.
  return `
<div class="jobs-table-wrap rc-table-scroll">
  <table class="jobs-table rc-lineitems-table">
    <colgroup>
      <col><col><col><col><col><col><col><col><col><col><col><col><col><col><col>
    </colgroup>
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
  _rcPopulateDownloadPeriod(bucket);
  const wrap = document.getElementById(`rc-months-${bucket}`);
  document.getElementById(`rc-empty-${bucket}`).hidden = rows.length > 0;
  const months = saaReceiptsGroupByMonth(rows);
  wrap.innerHTML = months.map((m) => {
    const total = m.rows.reduce((sum, r) => sum + (saaLineTotal(r) || 0), 0);
    const receiptCount = new Set(m.rows.map((r) => r.receipt_id)).size;
    // Flat, spreadsheet-style rows, NEWEST first within the month (Round 77;
    // the month groups themselves are newest first too), not grouped by receipt.
    const sortedRows = _rcSortNewestFirst(m.rows);
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

/* ---- Download (Excel/PDF, by month or year) ---- */

// A receipt line's own date, formatted for a spreadsheet/print row --
// distinct from the on-screen table's abbreviated _rcDate (no year) since
// an export can span many years and needs to disambiguate them.
function _rcFullDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function _rcBucketRowsForDownload(bucket) {
  return _rcApplyClientFilters(_rcAllRows.filter((r) => r.bucket === bucket));
}

// Repopulates the "By month"/"By year" value dropdown from whatever's
// currently in that bucket (respecting the page's own search/needs-review
// filters, same data the on-screen month groups are built from), keeping
// the previously chosen period selected if it's still on the list.
function _rcPopulateDownloadPeriod(bucket) {
  const typeSel = document.getElementById(`rc-dl-period-type-${bucket}`);
  const valueSel = document.getElementById(`rc-dl-period-value-${bucket}`);
  if (!typeSel || !valueSel) return;
  const mode = typeSel.value;
  valueSel.style.display = mode === "all" ? "none" : "";
  if (mode === "all") return;
  const rows = _rcBucketRowsForDownload(bucket);
  const prev = valueSel.value;
  let keys, labelFor;
  if (mode === "month") {
    keys = [...new Set(rows.map(saaReceiptMonthKey).filter(Boolean))].sort().reverse();
    labelFor = saaReceiptMonthLabel;
  } else {
    keys = [...new Set(rows.map((r) => saaReceiptMonthKey(r).slice(0, 4)).filter(Boolean))].sort().reverse();
    labelFor = (k) => k;
  }
  valueSel.innerHTML = keys.map((k) => `<option value="${k}">${_rcEsc(labelFor(k))}</option>`).join("")
    || `<option value="">No data yet</option>`;
  if (prev && keys.includes(prev)) valueSel.value = prev;
}

// The period chosen in a bucket's "Download" dropdowns, as a date-key prefix
// ('' = all time, 'YYYY' = a year, 'YYYY-MM' = a month) + a human label.
function _rcPeriodSpec(bucket) {
  const typeSel = document.getElementById(`rc-dl-period-type-${bucket}`);
  const valueSel = document.getElementById(`rc-dl-period-value-${bucket}`);
  const mode = typeSel.value;
  if (mode === "month" && valueSel.value) return { prefix: valueSel.value, label: saaReceiptMonthLabel(valueSel.value) };
  if (mode === "year" && valueSel.value) return { prefix: valueSel.value, label: valueSel.value };
  return { prefix: "", label: "All time" };
}

// Line items of one bucket inside a period, newest first.
function _rcRowsForPeriod(bucket, spec) {
  let rows = _rcBucketRowsForDownload(bucket);
  if (spec.prefix) rows = rows.filter((r) => saaReceiptMonthKey(r).startsWith(spec.prefix));
  return _rcSortNewestFirst(rows);
}

// The rows + a human period label for the selected bucket/period, newest first
// (matches the on-screen month groups' own row order).
function _rcSelectedExportRows(bucket) {
  const spec = _rcPeriodSpec(bucket);
  return { rows: _rcRowsForPeriod(bucket, spec), periodLabel: spec.label };
}

/* ---- Excel workbook (Round 77): Receipts / Tools / Supplies / Expenses tabs ---- */

// A line with no usable amount (phone-photo placeholder, or never filled in).
function _rcNoAmount(r) {
  return r.item_total == null || (Number(r.item_total) === 0 && /phone photo/i.test(r.item_description || ""));
}

function _rcLineItemSheet(bucket, rows, periodLabel) {
  const label = _rcBucketLabel(bucket);
  const titleWord = bucket === "receipts" ? "Purchase Receipts" : label;
  const flags = [], flagText = [];
  const data = rows.map((r) => {
    const subtotal = saaLineTotal(r);
    let f = null, t = "";
    if (r.auto_tagged) { f = "warn"; t = "Needs review"; }
    if (_rcNoAmount(r)) { f = "warn"; t = t ? t + " / No amount" : "No amount"; }
    if (!f && subtotal != null && subtotal < 0) { f = "neg"; t = "Return"; }
    flags.push(f); flagText.push(t);
    return [
      r.r_received_at, r.r_vendor, r.r_store_location, r.item_description, r.category || "Uncategorized",
      _rcProjectLabel(r), r.specification, r.qty, r.unit_price, r.item_total, r.sales_tax, subtotal,
      r.r_payment_method, r.r_receipt_number, r.notes, t,
    ];
  });
  return {
    name: label,
    tabColor: bucket === "receipts" ? "2F5496" : bucket === "tools" ? "C55A11" : "548235",
    title: `SAA Comfort Air LLC \u2014 ${periodLabel} ${titleWord}`,
    subtitle: `Period: ${periodLabel}   |   Generated ${saaXlsxTodayLabel()}   |   ${rows.length} line item${rows.length === 1 ? "" : "s"}, newest first   |   Subtotal = Item Total + Sales Tax   |   Yellow = needs review / no amount, red = return`,
    freezeCols: 2,
    totals: true,
    emptyText: `No ${label.toLowerCase()} for ${periodLabel}.`,
    columns: [
      { header: "Date", width: 12.5, type: "date" },
      { header: "Vendor", width: 18 },
      { header: "Store Location", width: 30, type: "wrap" },
      { header: "Item Description", width: 42, type: "wrap" },
      { header: "Category", width: 22 },
      { header: "Job / Project", width: 34 },
      { header: "Specification", width: 24, type: "wrap" },
      { header: "Qty", width: 7, type: "int" },
      { header: "Unit Price", width: 12, type: "money" },
      { header: "Item Total", width: 13, type: "money", total: true },
      { header: "Sales Tax", width: 11, type: "money", total: true },
      { header: "Subtotal", width: 13, type: "money", total: true },
      { header: "Payment Method", width: 16 },
      { header: "Receipt / Order Number", width: 20 },
      { header: "Notes", width: 34, type: "wrap" },
      { header: "Flag", width: 25 },
    ],
    rows: data,
    flags,
  };
}

// One workbook with a tab per bucket + Expenses, all for one period.
// opts.first = "expenses" puts the Expenses tab first (Expenses-tab button).
function _rcDownloadXlsx(spec, opts) {
  opts = opts || {};
  const sheets = {};
  ["receipts", "tools", "supplies"].forEach((b) => {
    sheets[b] = _rcLineItemSheet(b, _rcRowsForPeriod(b, spec), spec.label);
  });
  if (typeof saaExpensesBuildSheet === "function") {
    sheets.expenses = saaExpensesBuildSheet(spec, opts.expenseRows);
  }
  const order = opts.first === "expenses" ? ["expenses", "receipts", "tools", "supplies"] : ["receipts", "tools", "supplies", "expenses"];
  saaXlsxDownload(`SAA-purchases-and-expenses-${spec.label.replace(/\s+/g, "-").toLowerCase()}-${saaXlsxStamp()}.xlsx`,
    order.map((k) => sheets[k]).filter(Boolean));
}

function _rcDownloadExcel(bucket) { _rcDownloadXlsx(_rcPeriodSpec(bucket)); }

function _rcDownloadPdf(bucket) {
  const { rows, periodLabel } = _rcSelectedExportRows(bucket);
  printReceipts({
    bucketLabel: _rcBucketLabel(bucket),
    periodLabel,
    generatedOn: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    rows: rows.map((r) => ({
      dateLabel: _rcFullDate(r.r_received_at),
      r_vendor: r.r_vendor,
      item_description: r.item_description,
      category: r.category,
      projectLabel: _rcProjectLabel(r),
      qty: r.qty,
      item_total: r.item_total,
      sales_tax: r.sales_tax,
      subtotal: saaLineTotal(r),
    })),
  });
}

function _rcRenderOverview() {
  const rows = _rcApplyClientFilters(_rcAllRows);
  const s = saaReceiptsSummary(rows);
  // Round 69 (2026-09-28): the Receipts / Tools / Supplies / Needs Review
  // tiles are buttons that jump to the matching tab. Needs Review ticks the
  // "Needs review only" filter and opens the first bucket that has any
  // unconfirmed line items. Total Spend is informational (plain tile).
  const reviewBucket = SAA_RECEIPT_BUCKETS.find((b) => rows.some((r) => r.auto_tagged && (r.bucket || "receipts") === b)) || "receipts";
  const cards = [
    { label: "Total Spend", value: _rcMoney(s.grandTotal), sub: `${s.count} line item${s.count === 1 ? "" : "s"}` },
    { label: "Receipts", value: _rcMoney(s.byBucket.receipts.total), sub: `${s.byBucket.receipts.count} line items`, tab: "receipts" },
    { label: "Tools", value: _rcMoney(s.byBucket.tools.total), sub: `${s.byBucket.tools.count} line items`, tab: "tools" },
    { label: "Supplies", value: _rcMoney(s.byBucket.supplies.total), sub: `${s.byBucket.supplies.count} line items`, tab: "supplies" },
    // Round 76: Expenses (food, travel, subcontract, ...) are tracked separately from receipt line items.
    ...(typeof _exAll !== "undefined" && typeof saaExpensesSummary === "function" ? [(() => {
      const es = saaExpensesSummary(_exAll);
      return { label: "Expenses", value: _rcMoney(es.total), sub: `${es.count} expense${es.count === 1 ? "" : "s"}`, tab: "expenses" };
    })()] : []),
    { label: "Needs Review", value: String(s.needsReview), sub: "auto-tagged, unconfirmed", tab: reviewBucket, review: true, warn: s.needsReview > 0 },
  ];
  const host = document.getElementById("rc-summary-cards");
  host.innerHTML = cards.map((c) => {
    const inner = `
  <div class="rc-sc-label">${_rcEsc(c.label)}</div>
  <div class="rc-sc-value">${c.value}</div>
  <div class="rc-sc-sub">${_rcEsc(c.sub)}</div>` + (c.tab ? `
  <div class="rc-sc-go">${c.review ? "Review now" : "Open"} &rarr;</div>` : "");
    return c.tab
      ? `<button type="button" class="rc-summary-card rc-summary-btn${c.warn ? " rc-summary-warn" : ""}" data-tab="${c.tab}"${c.review ? ' data-review="1"' : ""}>${inner}</button>`
      : `<div class="rc-summary-card">${inner}</div>`;
  }).join("");
  host.querySelectorAll(".rc-summary-btn").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.review) document.getElementById("rc-needs-review-only").checked = true;
      _rcSwitchTab(b.dataset.tab);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

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
  else if (_rcActiveTab === "expenses") { if (typeof saaExpensesRender === "function") saaExpensesRender(); } // Round 76
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
  document.getElementById("rc-edit-job").value = _rcJobEventValue(li.job_id, li.event_id);
  document.getElementById("rc-edit-view-email").href = li.r_gmail_view_url || "#";
  document.getElementById("rc-edit-status").textContent = "";
  document.getElementById("rc-edit-overlay").hidden = false;
}

async function _rcSaveEdit() {
  const overlay = document.getElementById("rc-edit-overlay");
  const id = overlay.dataset.id;
  const statusEl = document.getElementById("rc-edit-status");
  statusEl.textContent = "Saving…";
  const picked = _rcParseJobEvent(document.getElementById("rc-edit-job").value);
  const jobOpt = _rcJobOptions.find((o) => o.job_id === picked.job_id);
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
    job_id: picked.job_id,
    // Round 51: which of that Job's own Events (visits) this line belongs
    // to, if any -- the select is already scoped to the current Job (see
    // _rcRefreshEventOptionsForJob), so its value is never a stale/foreign
    // Event id. Saving this fires the DB trigger that recalculates both
    // the Job's and the Event's Actual Material Cost automatically.
    event_id: picked.event_id,
    customer_id: jobOpt ? jobOpt.customer_id : null,
    project_label: jobOpt ? null : undefined,
  };
  const res = await saaLineItemUpdate(id, patch);
  if (res.error) { statusEl.textContent = res.error; return; }
  overlay.hidden = true;
  await _rcLoadAll();
}

async function _rcDeleteEdit() {
  const overlay = document.getElementById("rc-edit-overlay");
  const id = overlay.dataset.id;
  const li = _rcAllRows.find((x) => x.id === id);
  if (!li) return;
  const name = li.item_description || "this line item";
  if (!window.confirm(`Delete "${name}" permanently?\n\nThis cannot be undone.`)) return;
  const statusEl = document.getElementById("rc-edit-status");
  statusEl.textContent = "Deleting…";
  const res = await saaLineItemDelete(id);
  if (res.error) { statusEl.textContent = res.error; return; }
  overlay.hidden = true;
  await _rcLoadAll();
}

/* ---- Wiring ---- */

document.addEventListener("DOMContentLoaded", async () => {
  [_rcJobOptions, _rcEventOptions] = await Promise.all([
    saaReceiptsFetchJobPickerOptions(),
    saaReceiptsFetchEventPickerOptions(),
  ]);
  _rcFillJobEventSelect();

  document.querySelectorAll("#rc-tabs .cal-view-btn").forEach((b) => {
    b.addEventListener("click", () => _rcSwitchTab(b.dataset.tab));
  });
  SAA_RECEIPT_BUCKETS.forEach((bucket) => {
    document.getElementById(`rc-dl-period-type-${bucket}`).addEventListener("change", () => _rcPopulateDownloadPeriod(bucket));
    document.getElementById(`rc-dl-xlsx-${bucket}`).addEventListener("click", () => _rcDownloadExcel(bucket));
    document.getElementById(`rc-dl-pdf-${bucket}`).addEventListener("click", () => _rcDownloadPdf(bucket));
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
  document.getElementById("rc-edit-delete").addEventListener("click", _rcDeleteEdit);

  // The Overview tab starts marked "active" in the generated markup, but
  // every tab panel starts with the `hidden` attribute set (so a tab
  // button's own click handler is the only thing that clears it) --
  // _rcSwitchTab does that unhide, so it needs to run once up front for
  // the default tab, not just on a later click.
  _rcSwitchTab("overview");
  await _rcLoadAll();
});
