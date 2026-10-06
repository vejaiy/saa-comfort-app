/* ============================================================
   SAA Comfort Air LLC — Receipts page: "By Project" tab + Overview downloads
   (Round 105, 2026-10-07)

   Per Vijayan: "Add another tab to show receipts / cost by project. Add same
   download button in overview page."

   A PROJECT is a job. Every cost that belongs to one is added up under it:
     - receipt line items (Receipts / Tools / Supplies buckets, incl. sales tax)
     - Expenses tied to the job (subcontract, travel, meals ...)
   A line reassigned to an Event is counted under the Event's CURRENT job
   (events keep moving to the newest job record when a repeat visit converts
   older jobs), so one customer's work isn't split across retired job numbers.
   Costs with no job land in "Shop / overhead" groups (SAA - Tools, SAA
   (general) ...), a customer-only group, or "Unassigned".

   Loaded after receipts-page.js and expenses-page.js (uses _rcAllRows,
   _exAll, _rcJobOptions, _rcOpenEdit ... from them).
   ============================================================ */

const _pcOpen = new Set();
const _pcGroups = {};
let _pcModel = null;

function _pcName(opt) { return opt ? String(opt.label).split(" — ").slice(1).join(" — ") : ""; }
function _pcJobNum(opt) { return opt ? String(opt.label).split(" — ")[0] : ""; }

/* ---------- pure builder ---------- */
/** lines = receipt line items (hydrated), expenses = expense rows,
 *  jobOptions = [{ job_id, customer_id, label: "J-… — First Last" }].
 *  -> { projects:[{key,kind,label,customer,job_id,receipts,tools,supplies,expenses,total,count,items[]}], totals } */
function saaProjectCostsBuild(lines, expenses, jobOptions) {
  const optByJob = {};
  (jobOptions || []).forEach((o) => { optByJob[o.job_id] = o; });
  const groups = {};
  const group = (key, kind, label, customer, jobId) =>
    groups[key] || (groups[key] = { key, kind, label, customer: customer || "", job_id: jobId || null, receipts: 0, tools: 0, supplies: 0, expenses: 0, total: 0, count: 0, items: [] });
  const add = (g, item, bucketKey) => {
    g[bucketKey] += item.total; g.total += item.total; g.count += 1; g.items.push(item);
  };

  (lines || []).forEach((r) => {
    const effJob = (r.event && r.event.job_id) || r.job_id || null;
    let g;
    if (effJob) {
      const o = optByJob[effJob];
      g = group("job:" + effJob, "job", o ? _pcJobNum(o) : ((r.job && r.job.job_number) || "Job"), o ? _pcName(o) : "", effJob);
    } else if (r.customer_id) {
      const nm = r.customer ? `${r.customer.first_name || ""} ${r.customer.last_name || ""}`.trim() : "Customer";
      g = group("cust:" + r.customer_id, "customer", nm, nm, null);
    } else if (r.project_label) {
      g = group("lbl:" + r.project_label, "shop", r.project_label, "", null);
    } else {
      g = group("none", "none", "Unassigned", "", null);
    }
    const bucket = r.bucket === "tools" ? "tools" : r.bucket === "supplies" ? "supplies" : "receipts";
    const amt = typeof saaLineTotal === "function" ? (saaLineTotal(r) || 0) : (Number(r.item_total) || 0) + (Number(r.sales_tax) || 0);
    add(g, {
      id: r.id, isExpense: false, date: (r.r_received_at || "").slice(0, 10), source: bucket === "receipts" ? "Receipt" : bucket === "tools" ? "Tools" : "Supplies",
      vendor: r.r_vendor || "", description: r.item_description || "", category: r.category || "Uncategorized",
      event: (r.event && r.event.event_number) || "", itemTotal: Number(r.item_total) || 0, tax: Number(r.sales_tax) || 0, total: amt,
      review: !!r.auto_tagged,
    }, bucket);
  });

  (expenses || []).forEach((e) => {
    let g;
    if (e.scope === "job" && e.job_id) {
      const o = optByJob[e.job_id];
      g = group("job:" + e.job_id, "job", o ? _pcJobNum(o) : "Job", o ? _pcName(o) : "", e.job_id);
    } else if (e.scope === "tools") {
      g = group("lbl:SAA - Tools", "shop", "SAA - Tools", "", null);
    } else {
      g = group("lbl:SAA (general)", "shop", "SAA (general)", "", null);
    }
    const amt = Number(e.amount) || 0;
    add(g, {
      id: e.id, isExpense: true, date: (e.expense_date || "").slice(0, 10), source: "Expense", vendor: e.vendor || "",
      description: e.description || "", category: e.category || "", event: "", itemTotal: amt, tax: 0, total: amt, review: false,
    }, "expenses");
  });

  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const projects = Object.values(groups).map((g) => {
    ["receipts", "tools", "supplies", "expenses", "total"].forEach((k) => { g[k] = round(g[k]); });
    g.items.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
    return g;
  }).sort((a, b) => (a.kind === "none") - (b.kind === "none") || b.total - a.total);

  const sum = (pred) => round(projects.filter(pred).reduce((s, g) => s + g.total, 0));
  const totals = {
    jobCount: projects.filter((g) => g.kind === "job" || g.kind === "customer").length,
    jobCost: sum((g) => g.kind === "job" || g.kind === "customer"),
    shop: sum((g) => g.kind === "shop"),
    unassigned: sum((g) => g.kind === "none"),
    all: sum(() => true),
    receipts: round(projects.reduce((s, g) => s + g.receipts, 0)),
    tools: round(projects.reduce((s, g) => s + g.tools, 0)),
    supplies: round(projects.reduce((s, g) => s + g.supplies, 0)),
    expenses: round(projects.reduce((s, g) => s + g.expenses, 0)),
    count: projects.reduce((s, g) => s + g.count, 0),
  };
  return { projects, totals };
}

/* ---------- period + inputs ---------- */
function _pcLines() { return _rcApplyClientFilters(_rcAllRows || []); }
function _pcExpenses() {
  if (typeof _exAll === "undefined" || !_exAll) return [];
  if (document.getElementById("rc-needs-review-only").checked) return [];
  const search = (document.getElementById("rc-search") || {}).value || "";
  return typeof saaExpensesFilter === "function" ? saaExpensesFilter(_exAll, { search, jobLabel: typeof _exJobLabel === "function" ? _exJobLabel : undefined }) : _exAll;
}
function _pcMonthKeys() {
  const ks = new Set();
  _pcLines().forEach((r) => { const k = saaReceiptMonthKey(r); if (k) ks.add(k); });
  _pcExpenses().forEach((e) => { const k = (e.expense_date || "").slice(0, 7); if (k) ks.add(k); });
  return [...ks].sort().reverse();
}
function _pcPopulatePeriod(id) {
  const typeSel = document.getElementById(`rc-dl-period-type-${id}`), valSel = document.getElementById(`rc-dl-period-value-${id}`);
  if (!typeSel || !valSel) return;
  const mode = typeSel.value;
  valSel.style.display = mode === "all" ? "none" : "";
  if (mode === "all") return;
  const months = _pcMonthKeys();
  const keys = mode === "month" ? months : [...new Set(months.map((k) => k.slice(0, 4)))];
  const prev = valSel.value;
  valSel.innerHTML = keys.map((k) => `<option value="${k}">${_rcEsc(mode === "month" ? saaReceiptMonthLabel(k) : k)}</option>`).join("") || `<option value="">No data yet</option>`;
  if (prev && keys.includes(prev)) valSel.value = prev;
}
function _pcSpec(id) {
  const typeSel = document.getElementById(`rc-dl-period-type-${id}`), valSel = document.getElementById(`rc-dl-period-value-${id}`);
  const mode = typeSel ? typeSel.value : "all";
  if (mode === "month" && valSel.value) return { prefix: valSel.value, label: saaReceiptMonthLabel(valSel.value) };
  if (mode === "year" && valSel.value) return { prefix: valSel.value, label: valSel.value };
  return { prefix: "", label: "All time" };
}
function _pcInputs(spec) {
  let lines = _pcLines(), exps = _pcExpenses();
  if (spec && spec.prefix) {
    lines = lines.filter((r) => saaReceiptMonthKey(r).startsWith(spec.prefix));
    exps = exps.filter((e) => (e.expense_date || "").startsWith(spec.prefix));
  }
  return { lines, exps };
}
function _pcBuild(spec) {
  const { lines, exps } = _pcInputs(spec);
  return saaProjectCostsBuild(lines, exps, _rcJobOptions);
}

/* ---------- screen ---------- */
function _pcDetailHtml(g) {
  return `<div class="jobs-table-wrap rc-drill-scroll"><table class="jobs-table rc-drill-table">
  <thead><tr><th>Date</th><th>Type</th><th>Vendor / payee</th><th>Description</th><th>Category</th><th>Event</th><th>Amount</th><th></th></tr></thead>
  <tbody>${g.items.map((i) => `<tr>
    <td>${_rcFullDate(i.date)}</td><td>${_rcEsc(i.source)}</td><td>${_rcEsc(i.vendor) || "&mdash;"}</td>
    <td>${_rcEsc(i.description)}${i.review ? ' <span class="rc-badge rc-badge-review">needs review</span>' : ""}</td>
    <td>${_rcEsc(i.category)}</td><td>${_rcEsc(i.event)}</td><td>${_rcMoney(i.total)}</td>
    <td>${i.isExpense ? "" : `<button type="button" class="btn btn-ghost btn-sm rc-edit-btn" data-id="${i.id}">Edit</button>`}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function _pcRowHtml(g) {
  const open = _pcOpen.has(g.key);
  _pcGroups[g.key] = g;
  const kindNote = g.kind === "shop" ? "shop / overhead" : g.kind === "none" ? "no job linked" : g.kind === "customer" ? "customer only (no job)" : "";
  const label = `<strong>${_rcEsc(g.label)}</strong>${g.customer && g.kind === "job" ? ` <span class="muted">&mdash; ${_rcEsc(g.customer)}</span>` : ""}${kindNote ? ` <span class="muted pc-kind">${kindNote}</span>` : ""}`;
  const m = (v) => (v ? _rcMoney(v) : '<span class="muted">&mdash;</span>');
  return `<tr class="rc-drill-row${open ? " rc-drill-open" : ""}" data-drill="${_rcEsc(g.key)}" tabindex="0" role="button" aria-expanded="${open}">
  <td><span class="rc-drill-caret">&#9656;</span> ${label}</td><td class="num">${g.count}</td><td class="num">${m(g.receipts)}</td><td class="num">${m(g.tools)}</td><td class="num">${m(g.supplies)}</td><td class="num">${m(g.expenses)}</td><td class="num"><strong>${_rcMoney(g.total)}</strong></td>
  <td>${g.job_id ? `<a class="btn btn-ghost btn-sm" href="jobs.html?job=${g.job_id}">Open</a>` : ""}</td></tr>
  <tr class="rc-drill-detail" data-drill="${_rcEsc(g.key)}"${open ? "" : " hidden"}><td colspan="8">${open ? _pcDetailHtml(g) : ""}</td></tr>`;
}

function _pcToggle(tr) {
  const key = tr.dataset.drill;
  const detail = tr.parentElement.querySelector(`.rc-drill-detail[data-drill="${CSS.escape(key)}"]`);
  const g = _pcGroups[key];
  if (!detail || !g) return;
  const opening = detail.hidden;
  if (opening) {
    detail.firstElementChild.innerHTML = _pcDetailHtml(g);
    detail.querySelectorAll(".rc-edit-btn").forEach((b) => b.addEventListener("click", () => _rcOpenEdit(b.dataset.id)));
    _pcOpen.add(key);
  } else _pcOpen.delete(key);
  detail.hidden = !opening;
  tr.classList.toggle("rc-drill-open", opening);
  tr.setAttribute("aria-expanded", String(opening));
}

function saaProjectsRender() {
  _pcPopulatePeriod("projects");
  const model = _pcModel = _pcBuild(_pcSpec("projects"));
  const t = model.totals;
  const cards = [
    { label: "Projects", value: String(t.jobCount), sub: "jobs with costs" },
    { label: "Job costs", value: _rcMoney(t.jobCost), sub: "receipts + expenses on jobs" },
    { label: "Shop / overhead", value: _rcMoney(t.shop), sub: "SAA - Tools, general ..." },
    { label: "Unassigned", value: _rcMoney(t.unassigned), sub: "no job linked", warn: t.unassigned > 0 },
    { label: "Total", value: _rcMoney(t.all), sub: `${t.count} line${t.count === 1 ? "" : "s"}` },
  ];
  document.getElementById("pc-summary").innerHTML = cards.map((c) =>
    `<div class="rc-summary-card${c.warn ? " rc-summary-warn" : ""}"><div class="rc-sc-label">${_rcEsc(c.label)}</div><div class="rc-sc-value">${c.value}</div><div class="rc-sc-sub">${_rcEsc(c.sub)}</div></div>`).join("");
  const body = document.getElementById("pc-tbody");
  body.innerHTML = model.projects.map(_pcRowHtml).join("")
    || `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No costs in this period.</td></tr>`;
  document.getElementById("pc-tfoot").innerHTML = model.projects.length
    ? `<tr class="acct-sub"><td>Total</td><td class="num">${t.count}</td><td class="num">${_rcMoney(t.receipts)}</td><td class="num">${_rcMoney(t.tools)}</td><td class="num">${_rcMoney(t.supplies)}</td><td class="num">${_rcMoney(t.expenses)}</td><td class="num"><strong>${_rcMoney(t.all)}</strong></td><td></td></tr>` : "";
  body.closest("table").classList.add("rc-drill-host");
  body.querySelectorAll(".rc-drill-row").forEach((tr) => {
    tr.addEventListener("click", (ev) => { if (!ev.target.closest("a")) _pcToggle(tr); });
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); _pcToggle(tr); } });
  });
  body.querySelectorAll(".rc-drill-detail .rc-edit-btn").forEach((b) => b.addEventListener("click", () => _rcOpenEdit(b.dataset.id)));
}

/* ---------- Excel sheets ---------- */
function _pcKindLabel(g) { return g.kind === "job" ? "Job" : g.kind === "customer" ? "Customer (no job)" : g.kind === "shop" ? "Shop / overhead" : "Unassigned"; }

function _pcProjectSheet(model, label) {
  return {
    name: "By Project", tabColor: "1A6B5A",
    title: `SAA Comfort Air LLC — ${label} Cost by Project`,
    subtitle: `Period: ${label}   |   Generated ${saaXlsxTodayLabel()}   |   ${model.projects.length} project group${model.projects.length === 1 ? "" : "s"}, highest cost first   |   Receipts, tools and supplies include sales tax`,
    freezeCols: 1, totals: true, emptyText: `No costs for ${label}.`,
    columns: [
      { header: "Project", width: 26 }, { header: "Customer", width: 24 }, { header: "Kind", width: 17 }, { header: "Line items", width: 11, type: "int", total: true },
      { header: "Receipts", width: 14, type: "money", total: true }, { header: "Tools", width: 14, type: "money", total: true },
      { header: "Supplies", width: 14, type: "money", total: true }, { header: "Expenses", width: 14, type: "money", total: true },
      { header: "Total cost", width: 15, type: "money", total: true },
    ],
    rows: model.projects.map((g) => [g.label, g.customer, _pcKindLabel(g), g.count, g.receipts, g.tools, g.supplies, g.expenses, g.total]),
    flags: model.projects.map((g) => (g.kind === "none" ? "warn" : null)),
  };
}

function _pcDetailSheet(model, label) {
  const rows = [], flags = [];
  model.projects.forEach((g) => g.items.forEach((i) => {
    rows.push([g.label, g.customer, i.date, i.source, i.vendor, i.description, i.category, i.event, i.itemTotal, i.tax, i.total]);
    flags.push(i.review ? "warn" : i.total < 0 ? "neg" : null);
  }));
  return {
    name: "Project Detail", tabColor: "1A6B5A",
    title: `SAA Comfort Air LLC — ${label} Project Cost Detail`,
    subtitle: `Period: ${label}   |   Generated ${saaXlsxTodayLabel()}   |   ${rows.length} line${rows.length === 1 ? "" : "s"} grouped by project   |   Yellow = needs review, red = return`,
    freezeCols: 1, totals: true, emptyText: `No costs for ${label}.`,
    columns: [
      { header: "Project", width: 24 }, { header: "Customer", width: 22 }, { header: "Date", width: 12.5, type: "date" }, { header: "Type", width: 10 },
      { header: "Vendor / payee", width: 20 }, { header: "Description", width: 44, type: "wrap" }, { header: "Category", width: 22 }, { header: "Event", width: 16 },
      { header: "Item total", width: 13, type: "money", total: true }, { header: "Sales tax", width: 11, type: "money", total: true }, { header: "Amount", width: 13, type: "money", total: true },
    ],
    rows, flags,
  };
}

/** Overview sheet: cost by category, split by bucket (Expenses by their own category). */
function _pcOverviewData(spec) {
  const { lines, exps } = _pcInputs(spec);
  const cats = {};
  const cat = (k) => cats[k] || (cats[k] = { category: k, count: 0, receipts: 0, tools: 0, supplies: 0, expenses: 0, total: 0 });
  lines.forEach((r) => {
    const g = cat(r.category || "Uncategorized");
    const b = r.bucket === "tools" ? "tools" : r.bucket === "supplies" ? "supplies" : "receipts";
    const v = saaLineTotal(r) || 0;
    g.count += 1; g[b] += v; g.total += v;
  });
  exps.forEach((e) => { const g = cat((e.category || "Uncategorized") + " (expense)"); const v = Number(e.amount) || 0; g.count += 1; g.expenses += v; g.total += v; });
  const list = Object.values(cats).sort((a, b) => b.total - a.total);
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  list.forEach((g) => { ["receipts", "tools", "supplies", "expenses", "total"].forEach((k) => { g[k] = r2(g[k]); }); });
  return { list, lines, exps };
}

function _pcOverviewSheet(data, label) {
  return {
    name: "Overview", tabColor: "2F5496",
    title: `SAA Comfort Air LLC — ${label} Overview by Category`,
    subtitle: `Period: ${label}   |   Generated ${saaXlsxTodayLabel()}   |   ${data.lines.length} receipt line${data.lines.length === 1 ? "" : "s"} + ${data.exps.length} expense${data.exps.length === 1 ? "" : "s"}   |   Includes sales tax`,
    freezeCols: 1, totals: true, emptyText: `No costs for ${label}.`,
    columns: [
      { header: "Category", width: 34 }, { header: "Line items", width: 11, type: "int", total: true },
      { header: "Receipts", width: 14, type: "money", total: true }, { header: "Tools", width: 14, type: "money", total: true },
      { header: "Supplies", width: 14, type: "money", total: true }, { header: "Expenses", width: 14, type: "money", total: true },
      { header: "Total", width: 15, type: "money", total: true },
    ],
    rows: data.list.map((g) => [g.category, g.count, g.receipts, g.tools, g.supplies, g.expenses, g.total]),
  };
}

function _pcFile(prefix, label) { return `SAA-${prefix}-${label.replace(/\s+/g, "-").toLowerCase()}-${saaXlsxStamp()}.xlsx`; }

function _pcDownloadProjectsXlsx() {
  const spec = _pcSpec("projects"), model = _pcBuild(spec);
  saaXlsxDownload(_pcFile("cost-by-project", spec.label), [_pcProjectSheet(model, spec.label), _pcDetailSheet(model, spec.label)]);
}

// Overview button: the full 4-tab workbook (Receipts / Tools / Supplies / Expenses) plus an Overview sheet
// (cost by category) and the By Project sheet, all for the chosen period.
function _pcDownloadOverviewXlsx() {
  const spec = _pcSpec("overview");
  const data = _pcOverviewData(spec), model = _pcBuild(spec);
  _rcDownloadXlsx(spec, { pre: [_pcOverviewSheet(data, spec.label), _pcProjectSheet(model, spec.label)], file: _pcFile("receipts-overview", spec.label) });
}

/* ---------- PDF ---------- */
const _pcToday = () => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const _pcMoneyNum = (n) => (n === 0 ? "" : _rcMoney(n));

function _pcDownloadProjectsPdf() {
  const spec = _pcSpec("projects"), model = _pcBuild(spec), t = model.totals;
  printReceiptSections({
    title: "Cost by Project", periodLabel: spec.label, generatedOn: _pcToday(),
    sections: [
      { heading: "Summary by project", columns: [{ h: "Project" }, { h: "Customer" }, { h: "Lines", num: 1 }, { h: "Receipts", num: 1 }, { h: "Tools", num: 1 }, { h: "Supplies", num: 1 }, { h: "Expenses", num: 1 }, { h: "Total", num: 1 }],
        rows: model.projects.map((g) => [g.label + (g.kind === "shop" ? " (shop / overhead)" : ""), g.customer, g.count, _pcMoneyNum(g.receipts), _pcMoneyNum(g.tools), _pcMoneyNum(g.supplies), _pcMoneyNum(g.expenses), _rcMoney(g.total)]),
        total: ["Total", "", t.count, _rcMoney(t.receipts), _rcMoney(t.tools), _rcMoney(t.supplies), _rcMoney(t.expenses), _rcMoney(t.all)] },
      { heading: "Detail", pageBreak: true, columns: [{ h: "Project" }, { h: "Date" }, { h: "Type" }, { h: "Vendor / payee" }, { h: "Description" }, { h: "Category" }, { h: "Amount", num: 1 }],
        rows: model.projects.flatMap((g) => g.items.map((i) => [g.label, _rcFullDate(i.date), i.source, i.vendor, i.description, i.category, _rcMoney(i.total)])),
        total: ["Total", "", "", "", "", "", _rcMoney(t.all)] },
    ],
  });
}

function _pcDownloadOverviewPdf() {
  const spec = _pcSpec("overview"), data = _pcOverviewData(spec), model = _pcBuild(spec), t = model.totals;
  printReceiptSections({
    title: "Receipts &amp; Expenses Overview", periodLabel: spec.label, generatedOn: _pcToday(),
    sections: [
      { heading: "Totals", columns: [{ h: "Receipts", num: 1 }, { h: "Tools", num: 1 }, { h: "Supplies", num: 1 }, { h: "Expenses", num: 1 }, { h: "Total", num: 1 }],
        rows: [[_rcMoney(t.receipts), _rcMoney(t.tools), _rcMoney(t.supplies), _rcMoney(t.expenses), _rcMoney(t.all)]] },
      { heading: "By category", columns: [{ h: "Category" }, { h: "Lines", num: 1 }, { h: "Receipts", num: 1 }, { h: "Tools", num: 1 }, { h: "Supplies", num: 1 }, { h: "Expenses", num: 1 }, { h: "Total", num: 1 }],
        rows: data.list.map((g) => [g.category, g.count, _pcMoneyNum(g.receipts), _pcMoneyNum(g.tools), _pcMoneyNum(g.supplies), _pcMoneyNum(g.expenses), _rcMoney(g.total)]),
        total: ["Total", t.count, _rcMoney(t.receipts), _rcMoney(t.tools), _rcMoney(t.supplies), _rcMoney(t.expenses), _rcMoney(t.all)] },
      { heading: "By project", columns: [{ h: "Project" }, { h: "Customer" }, { h: "Lines", num: 1 }, { h: "Total", num: 1 }],
        rows: model.projects.map((g) => [g.label + (g.kind === "shop" ? " (shop / overhead)" : ""), g.customer, g.count, _rcMoney(g.total)]),
        total: ["Total", "", t.count, _rcMoney(t.all)] },
    ],
  });
}

/* ---------- wiring ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const wire = (id, onXlsx, onPdf) => {
    const typeSel = document.getElementById(`rc-dl-period-type-${id}`);
    if (!typeSel) return;
    typeSel.addEventListener("change", () => { _pcPopulatePeriod(id); if (id === "projects") saaProjectsRender(); });
    document.getElementById(`rc-dl-period-value-${id}`).addEventListener("change", () => { if (id === "projects") saaProjectsRender(); });
    document.getElementById(`rc-dl-xlsx-${id}`).addEventListener("click", onXlsx);
    document.getElementById(`rc-dl-pdf-${id}`).addEventListener("click", onPdf);
  };
  wire("overview", _pcDownloadOverviewXlsx, _pcDownloadOverviewPdf);
  wire("projects", _pcDownloadProjectsXlsx, _pcDownloadProjectsPdf);
  // Overview's period list follows the data (re-fill whenever the Overview tab is shown / data reloads).
  const refill = () => { _pcPopulatePeriod("overview"); };
  document.querySelectorAll("#rc-tabs .cal-view-btn").forEach((b) => b.addEventListener("click", () => setTimeout(refill, 0)));
  window.addEventListener("load", () => setTimeout(refill, 800));
});
