/* ============================================================
   SAA Comfort Air LLC — printable Accounts / tax package (PDF via the
   browser's Print dialog). Round 101 (2026-10-06). Same letterhead system
   as print-receipts.js / print-mileage-summary.js. Pure renderer: the
   Accounts page hands in the already-computed model.
   opts: { model, rows (P&L statement rows), cash, accrual, basisLabel, generatedOn }
   ============================================================ */

const SAA_ACCOUNTS_PRINT_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _acctPrintEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function _acctPrintMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? "(" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (v < 0 ? ")" : "");
}

function printAccountsPackage(opts) {
  const info = SAA_ACCOUNTS_PRINT_INFO, m = opts.model, c = opts.cash, a = opts.accrual;
  const cols = (c ? 1 : 0) + (a ? 1 : 0);
  const vals = (r, cls) => (c ? `<td class="num ${cls || ""}">${_acctPrintMoney(r.cash)}</td>` : "") + (a ? `<td class="num ${cls || ""}">${_acctPrintMoney(r.accrual)}</td>` : "");
  const th = (c ? '<th class="num">Cash basis</th>' : "") + (a ? '<th class="num">Accrual basis</th>' : "");
  const margin = (net, rev) => (rev > 0 ? ((net / rev) * 100).toFixed(1) + "%" : "—");

  const pnl = opts.rows.map((r) => {
    if (r.kind === "head") return `<tr class="head"><td colspan="${1 + cols}">${_acctPrintEsc(r.label)}</td></tr>`;
    const cls = r.kind === "sub" ? "sub" : r.kind === "net" ? "net" : "";
    const label = r.kind === "item" ? `<span class="ind">${_acctPrintEsc(r.label)}</span>` : _acctPrintEsc(r.label);
    return `<tr class="${cls}"><td>${label}</td>${vals(r)}</tr>`;
  }).join("") + `<tr class="muted"><td>Net margin</td>${c ? `<td class="num">${margin(m.net.cash, m.revenue.cash)}</td>` : ""}${a ? `<td class="num">${margin(m.net.accrual, m.revenue.accrual)}</td>` : ""}</tr>`;

  const T = (f) => m.months.reduce((s, x) => s + x[f], 0);
  const monthCols = (mo) => `<td>${_acctPrintEsc(mo.label || "Total")}</td>` + (c ? `<td class="num">${_acctPrintMoney(mo.cash)}</td>` : "") + (a ? `<td class="num">${_acctPrintMoney(mo.accrual)}</td>` : "") +
    `<td class="num">${_acctPrintMoney(mo.cogs)}</td><td class="num">${_acctPrintMoney(mo.opex)}</td>` + (c ? `<td class="num">${_acctPrintMoney(mo.netCash)}</td>` : "") + (a ? `<td class="num">${_acctPrintMoney(mo.netAccrual)}</td>` : "");
  const monthRows = m.months.map((mo) => `<tr>${monthCols(mo)}</tr>`).join("")
    + `<tr class="sub">${monthCols({ cash: T("cash"), accrual: T("accrual"), cogs: T("cogs"), opex: T("opex"), netCash: T("netCash"), netAccrual: T("netAccrual") })}</tr>`;

  const t = m.tax;
  const form = t.form1065.map((r) => `<tr class="${r.final ? "net" : r.subtotal ? "sub" : ""}"><td class="line">${_acctPrintEsc(r.line)}</td><td>${_acctPrintEsc(r.label)}</td>${vals(r)}</tr>`).join("");
  const l20 = t.otherDeductions.length
    ? t.otherDeductions.map((l) => `<tr><td>${_acctPrintEsc(l.label)}${l.key === "meals" ? " <span class='muted'>(50% limit applied)</span>" : ""}</td><td class="num">${l.count}</td><td class="num">${_acctPrintMoney(l.amount)}</td><td class="num">${_acctPrintMoney(l.taxAmount)}</td></tr>`).join("")
      + `<tr class="sub"><td>Total other deductions (line 20)</td><td class="num">${t.otherDeductions.reduce((s, l) => s + l.count, 0)}</td><td class="num">${_acctPrintMoney(t.otherDeductions.reduce((s, l) => s + l.amount, 0))}</td><td class="num">${_acctPrintMoney(t.otherDeductions.reduce((s, l) => s + l.taxAmount, 0))}</td></tr>`
    : `<tr><td colspan="4" class="muted">None in this period.</td></tr>`;
  const cogs = m.cogs.length
    ? m.cogs.map((l) => `<tr><td>${_acctPrintEsc(l.label)}</td><td class="num">${l.count}</td><td class="num">${_acctPrintMoney(l.amount)}</td></tr>`).join("")
      + `<tr class="sub"><td>Total cost of goods sold (line 2)</td><td class="num">${m.cogs.reduce((s, l) => s + l.count, 0)}</td><td class="num">${_acctPrintMoney(m.cogsTotal)}</td></tr>`
    : `<tr><td colspan="3" class="muted">None in this period.</td></tr>`;
  const mi = m.mileage;
  const mileage = mi.byTech.length
    ? mi.byTech.map((g) => `<tr><td>${_acctPrintEsc(g.name)}</td><td class="num">${g.trips}</td><td class="num">${g.miles.toFixed(1)}</td><td class="num">${_acctPrintMoney(g.amount)}</td></tr>`).join("")
      + `<tr class="sub"><td>Total @ $${mi.rate.toFixed(3)} per mile</td><td class="num">${mi.trips}</td><td class="num">${mi.miles.toFixed(1)}</td><td class="num">${_acctPrintMoney(mi.amount)}</td></tr>`
    : `<tr><td colspan="4" class="muted">No mileage logged in this period.</td></tr>`;

  const nec = m.nec, st = m.salesTaxSummary;
  const necRows = nec.payees.length
    ? nec.payees.map((c) => `<tr><td>${_acctPrintEsc(c.payee)}</td><td class="num">${c.payments}</td><td class="num">${_acctPrintMoney(c.total)}</td><td class="num">${_acctPrintMoney(c.card)}</td><td class="num">${_acctPrintMoney(c.reportable)}</td><td>${c.needs1099 ? "<b>Yes</b>" : "No"}</td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">No contract-labor payments in this period.</td></tr>`;
  const stRows = st.byVendor.length
    ? st.byVendor.map((v) => `<tr><td>${_acctPrintEsc(v.vendor)}</td><td class="num">${v.lines}</td><td class="num">${_acctPrintMoney(v.subtotal)}</td><td class="num">${_acctPrintMoney(v.tax)}</td></tr>`).join("") + `<tr><td colspan="3"><b>Total sales tax paid</b></td><td class="num"><b>${_acctPrintMoney(st.totalPaid)}</b></td></tr>`
    : `<tr><td colspan="4" class="muted">No sales tax recorded in this period.</td></tr>`;
  const at = m.attention, notes = [];
  notes.push(`<b>Basis.</b> Cash basis counts customer payments by the date received; accrual basis counts invoices by issue date (void invoices ignored). Costs are the same on both bases: receipt line items (including sales tax paid) by receipt date, tax-deductible Expenses by expense date, and mileage at the IRS standard rate.`);
  notes.push(`<b>Entity.</b> SAA Comfort Air LLC is treated as a multi-member partnership (Form 1065). Income is not taxed at the entity level; the ordinary business income above is allocated to partners on Schedule K-1 per the partnership agreement (allocation is not calculated here).`);
  notes.push(`<b>Meals</b> are shown at 100% on the Profit &amp; Loss and limited to 50% in the tax summary. <b>Tools</b> are treated as deductible small equipment (de minimis safe harbor); items that should be capitalized or expensed under Section 179 belong on Form 4562.`);
  notes.push(`<b>Vehicles.</b> Mileage uses the IRS standard rate of $${mi.rate.toFixed(3)} per mile; do not also deduct actual fuel or vehicle costs for the same vehicle. For partnerships, vehicle costs are often handled as partner expenses &mdash; confirm with your tax preparer.`);
  notes.push(`<b>Not included unless entered as Expenses:</b> payroll / wages, guaranteed payments, rent, insurance, interest, depreciation, licenses, bad debts. Sales tax collected from customers is not tracked in this app.`);
  if (at.noAmount) notes.push(`<b>Open items:</b> ${at.noAmount} receipt line(s) have no amount yet and are counted as $0.`);
  if (at.needsReview) notes.push(`${at.needsReview} receipt line(s) are still flagged &ldquo;needs review.&rdquo;`);
  if (at.draftInvoices.count) notes.push(`${at.draftInvoices.count} invoice(s) in Draft status (${_acctPrintMoney(at.draftInvoices.amount)}) are included in accrual revenue.`);
  notes.push(`<i>These figures are estimates prepared from the company's own records for review by a tax professional. They are not tax advice and are not a filed return.</i>`);

  // Round 106: the package is built from named sections so each Accounts tab can print just its own.
  // opts.only = ["pnl","months","projects","form","l20","cogs","mileage","nec","salestax","notes"] (default: all)
  const pj = m.projects || [], pt = m.projectTotals || {};
  const pcols = (r, cls) => (c ? `<td class="num">${_acctPrintMoney(r.revCash)}</td>` : "") + (a ? `<td class="num">${_acctPrintMoney(r.revAccrual)}</td>` : "")
    + `<td class="num">${_acctPrintMoney(r.cogs)}</td><td class="num">${_acctPrintMoney(r.opex)}</td>`
    + (c ? `<td class="num">${_acctPrintMoney(r.profitCash)}</td>` : "") + (a ? `<td class="num">${_acctPrintMoney(r.profitAccrual)}</td>` : "")
    + `<td class="num">${(() => { const mg = c ? r.marginCash : r.marginAccrual; return mg == null ? "—" : (mg * 100).toFixed(1) + "%"; })()}</td>`;
  const projRows = pj.length
    ? pj.map((r) => `<tr><td>${_acctPrintEsc(r.label)}${r.customer && r.kind === "job" ? ` <span class="muted">— ${_acctPrintEsc(r.customer)}</span>` : ""}</td>${pcols(r)}</tr>`).join("")
      + `<tr class="sub"><td>Total (${pj.length} line${pj.length === 1 ? "" : "s"})</td>${pcols({ revCash: pt.revCash, revAccrual: pt.revAccrual, cogs: pt.cogs, opex: pt.opex, profitCash: pt.profitCash, profitAccrual: pt.profitAccrual, marginCash: pt.revCash > 0 ? pt.profitCash / pt.revCash : null, marginAccrual: pt.revAccrual > 0 ? pt.profitAccrual / pt.revAccrual : null })}</tr>`
    : `<tr><td colspan="9" class="muted">No activity in this period.</td></tr>`;
  const SECTIONS = {
    pnl: { title: "Profit &amp; Loss statement", html: `<table><thead><tr><th>${_acctPrintEsc(m.period.label)}</th>${th}</tr></thead><tbody>${pnl}</tbody></table>` },
    months: { title: "Monthly summary", html: `<table><thead><tr><th>Month</th>${c ? '<th class="num">Revenue (cash)</th>' : ""}${a ? '<th class="num">Revenue (accrual)</th>' : ""}<th class="num">COGS</th><th class="num">Operating</th>${c ? '<th class="num">Net (cash)</th>' : ""}${a ? '<th class="num">Net (accrual)</th>' : ""}</tr></thead><tbody>${monthRows}</tbody></table>` },
    projects: { title: "Profit &amp; loss by project", html: `<p class="muted" style="margin:0 0 6px">Each job's revenue and costs. Receipts and expenses tied to a job count under it; shop, mileage and other overhead are listed separately so the total matches the statement above. Margin is on the ${c ? "cash" : "accrual"} basis.</p><table><thead><tr><th>Project</th>${c ? '<th class="num">Revenue (cash)</th>' : ""}${a ? '<th class="num">Revenue (accrual)</th>' : ""}<th class="num">COGS</th><th class="num">Operating</th>${c ? '<th class="num">Profit (cash)</th>' : ""}${a ? '<th class="num">Profit (accrual)</th>' : ""}<th class="num">Margin</th></tr></thead><tbody>${projRows}</tbody></table>` },
    form: { title: "Form 1065 summary (page 1 lines)", pb: true, html: `<table><thead><tr><th>Line</th><th>Description</th>${th}</tr></thead><tbody>${form}</tbody></table>
  <p class="muted" style="margin:6px 0 0">Reconciliation: book net profit + non-deductible meals (${_acctPrintMoney(t.mealsNonDeductible)}) = ordinary business income. Unpaid invoices (accounts receivable) as of today: ${_acctPrintMoney(m.revenue.arOutstanding)}.</p>` },
    l20: { title: "Other deductions statement (line 20)", html: `<table><thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Book amount</th><th class="num">Deductible</th></tr></thead><tbody>${l20}</tbody></table>` },
    cogs: { title: "Cost of goods sold (Form 1125-A)", html: `<table><thead><tr><th>Category</th><th class="num">Entries</th><th class="num">Amount</th></tr></thead><tbody>${cogs}</tbody></table>` },
    mileage: { title: "Vehicle mileage", html: `<table><thead><tr><th>Technician</th><th class="num">Trips / legs</th><th class="num">Miles</th><th class="num">Deduction</th></tr></thead><tbody>${mileage}</tbody></table>` },
    nec: { title: "1099-NEC contractor payments", html: `<p class="muted">Threshold $${nec.threshold.toLocaleString("en-US")} of non-card payments per payee; card and PayPal payments are reported on a 1099-K. ${nec.formsNeeded} 1099-NEC form(s) needed.</p>
  <table><thead><tr><th>Payee</th><th class="num">Payments</th><th class="num">Total paid</th><th class="num">Card / PayPal</th><th class="num">Reportable</th><th>1099-NEC?</th></tr></thead><tbody>${necRows}</tbody></table>` },
    salestax: { title: "Sales tax paid on purchases", html: `<table><thead><tr><th>Vendor</th><th class="num">Lines</th><th class="num">Purchases</th><th class="num">Tax paid</th></tr></thead><tbody>${stRows}</tbody></table>` },
    notes: { title: "Notes &amp; assumptions", html: `<ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` },
  };
  const ORDER = ["pnl", "months", "projects", "form", "l20", "cogs", "mileage", "nec", "salestax", "notes"];
  const wanted = (opts.only && opts.only.length ? ORDER.filter((k) => opts.only.includes(k)) : ORDER);
  const bodyHtml = wanted.map((k, i) => {
    const sec = SECTIONS[k];
    const pb = sec.pb && i > 0;
    return `<h3 class="sec${pb ? " pb" : ""}"${i === 0 ? ' style="margin-top:4px"' : ""}>${i + 1}. ${sec.title}</h3>\n  ${sec.html}`;
  }).join("\n\n  ");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${String(opts.title || "Tax Package").replace(/&amp;/g, "&")} — ${_acctPrintEsc(m.period.label)} — ${info.name}</title>
<style>
  @page { size: letter portrait; margin: 0.6in 0.65in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 11.5px; line-height: 1.4; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header h1 { font-size: 1.2rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .8rem; }
  .header .contact { text-align: right; font-size: .8rem; color: #55636e; }
  .title-row { margin: 6px 0 12px; }
  .title-row h2 { font-size: 1.35rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .title-row .sub { color: #55636e; font-size: .82rem; margin-top: 2px; }
  h3.sec { font-size: .95rem; color: #0f2439; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #cfd8de; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: .66rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 5px 4px; }
  td { padding: 5px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.line { width: 38px; font-weight: 700; color: #1a6b5a; }
  tr.head td { background: #eef3f6; font-weight: 700; text-transform: uppercase; font-size: .72rem; letter-spacing: .4px; color: #0f2439; }
  tr.sub td { font-weight: 700; border-top: 1px solid #8fa2b3; background: #f7f9fa; }
  tr.net td { font-weight: 700; border-top: 2px solid #1a6b5a; background: #e3f4f1; font-size: 1.05em; }
  .ind { padding-left: 14px; }
  .muted { color: #55636e; }
  .pb { page-break-before: always; }
  ul.notes { margin: 6px 0 0; padding-left: 18px; } ul.notes li { margin-bottom: 5px; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .72rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 22px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div><h1>${info.name}</h1><div class="sub">${info.license}</div></div>
    <div class="contact">${info.phone}<br>${info.email}<br>${info.address}</div>
  </div>
  <div class="rule"></div>
  <div class="title-row">
    <h2>${opts.title || "Profit &amp; Loss and Tax Summary"}</h2>
    <div class="sub">${_acctPrintEsc(m.period.label)} &mdash; ${_acctPrintEsc(opts.basisLabel)} &mdash; Generated ${_acctPrintEsc(opts.generatedOn)}</div>
  </div>

  ${bodyHtml}

  <div class="footer"><div>${info.name} &mdash; ${opts.title || "Profit &amp; Loss and Tax Summary"}, ${_acctPrintEsc(m.period.label)}</div><div>${info.address}</div></div>

<script>window.onload = function () { setTimeout(function () { window.print(); }, 150); };</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the tax package."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
