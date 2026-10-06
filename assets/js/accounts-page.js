/* ============================================================
   SAA Comfort Air LLC — Accounts page (employee/accounts.html)
   Round 101 (2026-10-06). Profit & Loss (cash / accrual / both), Form 1065
   tax summary, ledger, and the tax-submission documents (Excel + PDF).
   All numbers come from accounts-db.js (saaAcctBuild). Requires xlsx-export.js
   and print-accounts.js.
   ============================================================ */

(function () {
  let DATA = null;       // everything loaded from the database
  let MODEL = null;      // saaAcctBuild() result for the chosen period
  let LEDGER_VIEW = "expenses";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const money = (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const basis = () => $("acct-basis").value;           // cash | accrual | both
  const showCash = () => basis() !== "accrual";
  const showAccrual = () => basis() !== "cash";
  const basisLabel = () => (basis() === "cash" ? "Cash basis" : basis() === "accrual" ? "Accrual basis" : "Cash and accrual basis");

  /* ---------- statement rows (shared by screen, Excel, PDF) ---------- */
  function pnlRows(m) {
    const rows = [];
    const same = (v) => ({ cash: v, accrual: v });
    rows.push({ kind: "head", label: "Revenue" });
    rows.push({ kind: "item", label: "Gross revenue (payments received = cash; invoices issued = accrual)", cash: m.revenue.cash, accrual: m.revenue.accrual });
    rows.push({ kind: "head", label: "Cost of goods sold" });
    if (!m.cogs.length) rows.push({ kind: "item", label: "No job materials or subcontract costs in this period", cash: 0, accrual: 0, muted: true });
    m.cogs.forEach((l) => rows.push(Object.assign({ kind: "item", label: l.label, count: l.count }, same(l.amount))));
    rows.push(Object.assign({ kind: "sub", label: "Total cost of goods sold" }, same(m.cogsTotal)));
    rows.push({ kind: "sub", label: "Gross profit", cash: m.gross.cash, accrual: m.gross.accrual });
    rows.push({ kind: "head", label: "Operating expenses" });
    if (!m.opex.length) rows.push({ kind: "item", label: "No operating expenses in this period", cash: 0, accrual: 0, muted: true });
    m.opex.forEach((l) => rows.push(Object.assign({ kind: "item", label: l.label, count: l.count }, same(l.amount))));
    rows.push(Object.assign({ kind: "sub", label: "Total operating expenses" }, same(m.opexTotal)));
    rows.push({ kind: "net", label: "Net profit (loss)", cash: m.net.cash, accrual: m.net.accrual });
    return rows;
  }
  window.saaAcctPnlRows = pnlRows;

  function margin(net, rev) { return rev > 0 ? ((net / rev) * 100).toFixed(1) + "%" : "—"; }

  /* ---------- screen render ---------- */
  function cell(v, show, cls) { return show ? `<td class="num ${cls || ""}">${money(v)}</td>` : ""; }

  function renderCards() {
    const m = MODEL, b = basis();
    const rev = b === "accrual" ? m.revenue.accrual : m.revenue.cash;
    const net = b === "accrual" ? m.net.accrual : m.net.cash;
    const lab = b === "accrual" ? "invoiced" : "received";
    const card = (label, value, sub, cls) => `<div class="rc-summary-card"><div class="rc-sc-label">${label}</div><div class="rc-sc-value ${cls || ""}">${value}</div><div class="rc-sc-sub">${sub || ""}</div></div>`;
    $("acct-cards").innerHTML =
      card("Revenue", money(rev), `${b === "accrual" ? m.revenue.invoiceCount + " invoices" : m.revenue.paymentCount + " payments"} ${lab}` + (b === "both" ? ` &middot; accrual ${money(m.revenue.accrual)}` : "")) +
      card("Costs & expenses", money(m.cogsTotal + m.opexTotal), `COGS ${money(m.cogsTotal)} &middot; operating ${money(m.opexTotal)}`) +
      card("Net profit", money(net), `${margin(net, rev)} margin` + (b === "both" ? ` &middot; accrual ${money(m.net.accrual)}` : ""), net < 0 ? "acct-neg" : "acct-pos") +
      card("Unpaid invoices (A/R)", money(m.revenue.arOutstanding), "all invoices, as of today");
  }

  function renderPnl() {
    const m = MODEL, c = showCash(), a = showAccrual();
    $("acct-pnl-head").innerHTML = `<tr><th>${esc(m.period.label)} &mdash; Profit &amp; Loss</th>${c ? '<th class="num">Cash basis</th>' : ""}${a ? '<th class="num">Accrual basis</th>' : ""}</tr>`;
    $("acct-pnl-body").innerHTML = pnlRows(m).map((r) => {
      if (r.kind === "head") return `<tr class="acct-head"><td colspan="${1 + (c ? 1 : 0) + (a ? 1 : 0)}">${esc(r.label)}</td></tr>`;
      const cls = r.kind === "sub" ? "acct-sub" : r.kind === "net" ? "acct-net" : (r.muted ? "muted" : "");
      const negC = r.kind === "net" && r.cash < 0 ? "acct-neg" : "", negA = r.kind === "net" && r.accrual < 0 ? "acct-neg" : "";
      const label = r.kind === "item" ? `<span class="acct-ind">${esc(r.label)}</span>${r.count ? ` <span class="muted acct-n">(${r.count})</span>` : ""}` : esc(r.label);
      return `<tr class="${cls}"><td>${label}</td>${cell(r.cash, c, negC)}${cell(r.accrual, a, negA)}</tr>`;
    }).join("") +
      `<tr class="acct-margin"><td>Net margin</td>${c ? `<td class="num">${margin(m.net.cash, m.revenue.cash)}</td>` : ""}${a ? `<td class="num">${margin(m.net.accrual, m.revenue.accrual)}</td>` : ""}</tr>`;

    // by month
    $("acct-month-body").innerHTML = m.months.map((mo) =>
      `<tr><td>${esc(mo.label)}</td>${cell(mo.cash, c)}${cell(mo.accrual, a)}${cell(mo.cogs, true)}${cell(mo.opex, true)}${cell(mo.netCash, c, mo.netCash < 0 ? "acct-neg" : "")}${cell(mo.netAccrual, a, mo.netAccrual < 0 ? "acct-neg" : "")}</tr>`).join("");
    const T = (f) => m.months.reduce((s, x) => s + x[f], 0);
    $("acct-month-head").innerHTML = `<tr><th>Month</th>${c ? '<th class="num">Revenue (cash)</th>' : ""}${a ? '<th class="num">Revenue (accrual)</th>' : ""}<th class="num">COGS</th><th class="num">Operating</th>${c ? '<th class="num">Net (cash)</th>' : ""}${a ? '<th class="num">Net (accrual)</th>' : ""}</tr>`;
    $("acct-month-foot").innerHTML = `<tr class="acct-sub"><td>Total</td>${cell(T("cash"), c)}${cell(T("accrual"), a)}${cell(T("cogs"), true)}${cell(T("opex"), true)}${cell(T("netCash"), c)}${cell(T("netAccrual"), a)}</tr>`;

    renderAttention();
  }

  function renderAttention() {
    const at = MODEL.attention, items = [];
    if (at.noAmount) items.push(`<b>${at.noAmount}</b> receipt line${at.noAmount === 1 ? " has" : "s have"} no amount yet (placeholders) &mdash; counted as $0 until you fill them in on the Receipts page.`);
    if (at.needsReview) items.push(`<b>${at.needsReview}</b> receipt line${at.needsReview === 1 ? " is" : "s are"} still flagged <em>needs review</em> (auto-tagged) &mdash; amounts are included, but confirm the bucket / category.`);
    if (at.noTaxCat) items.push(`<b>${at.noTaxCat}</b> deductible expense${at.noTaxCat === 1 ? " has" : "s have"} no tax category (${money(at.noTaxCatAmount)}) &mdash; placed under &ldquo;Other expenses&rdquo;. Set a tax category on the Expenses tab.`);
    if (at.excluded.count) items.push(`<b>${at.excluded.count}</b> expense${at.excluded.count === 1 ? " is" : "s are"} marked <em>not tax deductible</em> (${money(at.excluded.amount)}) &mdash; left out of the P&amp;L.`);
    if (at.draftInvoices.count) items.push(`<b>${at.draftInvoices.count}</b> invoice${at.draftInvoices.count === 1 ? " is" : "s are"} still in Draft (${money(at.draftInvoices.amount)}) &mdash; included in accrual revenue. Mark an invoice Void to exclude it.`);
    if (MODEL.revenue.cash > 0 && MODEL.revenue.cash > MODEL.revenue.accrual + 0.005)
      items.push(`Cash revenue is higher than accrual revenue for this period: some payments were received for invoices issued in an earlier period.`);
    $("acct-attention").innerHTML = items.length
      ? `<h3 style="margin:0 0 8px">Needs attention</h3><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : `<h3 style="margin:0 0 4px">Needs attention</h3><p class="muted" style="margin:0">Nothing to flag for this period.</p>`;
  }

  function renderTax() {
    const m = MODEL, c = showCash(), a = showAccrual(), t = m.tax;
    $("acct-tax-head").innerHTML = `<tr><th>Line</th><th>Form 1065, page 1 &mdash; ${esc(m.period.label)}</th>${c ? '<th class="num">Cash basis</th>' : ""}${a ? '<th class="num">Accrual basis</th>' : ""}</tr>`;
    $("acct-tax-body").innerHTML = t.form1065.map((r) =>
      `<tr class="${r.final ? "acct-net" : r.subtotal ? "acct-sub" : ""}"><td class="acct-line">${esc(r.line)}</td><td>${esc(r.label)}</td>${cell(r.cash, c, r.final && r.cash < 0 ? "acct-neg" : "")}${cell(r.accrual, a, r.final && r.accrual < 0 ? "acct-neg" : "")}</tr>`).join("");

    $("acct-l20-body").innerHTML = t.otherDeductions.length
      ? t.otherDeductions.map((l) => `<tr><td>${esc(l.label)}${l.key === "meals" ? ' <span class="muted acct-n">(50% limit applied)</span>' : ""}</td><td class="num">${l.count}</td><td class="num">${money(l.amount)}</td><td class="num">${money(l.taxAmount)}</td></tr>`).join("") +
        `<tr class="acct-sub"><td>Total other deductions (line 20)</td><td class="num">${t.otherDeductions.reduce((s, l) => s + l.count, 0)}</td><td class="num">${money(t.otherDeductions.reduce((s, l) => s + l.amount, 0))}</td><td class="num">${money(t.otherDeductions.reduce((s, l) => s + l.taxAmount, 0))}</td></tr>`
      : `<tr><td colspan="4" class="muted">No other deductions in this period.</td></tr>`;

    $("acct-cogs-body").innerHTML = m.cogs.length
      ? m.cogs.map((l) => `<tr><td>${esc(l.label)}</td><td class="num">${l.count}</td><td class="num">${money(l.amount)}</td></tr>`).join("") +
        `<tr class="acct-sub"><td>Total cost of goods sold (Form 1065, line 2)</td><td class="num">${m.cogs.reduce((s, l) => s + l.count, 0)}</td><td class="num">${money(m.cogsTotal)}</td></tr>`
      : `<tr><td colspan="3" class="muted">No cost of goods sold in this period.</td></tr>`;

    const mi = m.mileage;
    $("acct-mileage-body").innerHTML = mi.byTech.length
      ? mi.byTech.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.trips}</td><td class="num">${g.miles.toFixed(1)}</td><td class="num">${money(g.amount)}</td></tr>`).join("") +
        `<tr class="acct-sub"><td>Total @ $${mi.rate.toFixed(3)} per mile</td><td class="num">${mi.trips}</td><td class="num">${mi.miles.toFixed(1)}</td><td class="num">${money(mi.amount)}</td></tr>`
      : `<tr><td colspan="4" class="muted">No mileage logged in this period.</td></tr>`;

    renderNecAndSalesTax();
    $("acct-recon").innerHTML =
      `<b>Book net profit</b> (cash ${money(m.net.cash)}${showAccrual() ? `, accrual ${money(m.net.accrual)}` : ""}) + <b>meals not deductible</b> (50% of ${money(t.mealsFull)} = ${money(t.mealsNonDeductible)}) = ` +
      `<b>ordinary business income</b> (cash ${money(t.taxable.cash)}${showAccrual() ? `, accrual ${money(t.taxable.accrual)}` : ""}).`;
  }

  /* ---------- 1099-NEC + sales tax (Round 101b) ---------- */
  function renderNecAndSalesTax() {
    const m = MODEL, n = m.nec, st = m.salesTaxSummary;
    $("acct-nec-note").textContent = `Contract / subcontract labor paid in ${m.period.label}. A 1099-NEC is due for a payee with $${n.threshold.toLocaleString("en-US")} or more in non-card payments (ignore corporations; file by Jan 31). Card and PayPal payments are reported by the processor on a 1099-K. Get a W-9 from each payee.`;
    $("acct-nec-body").innerHTML = n.payees.length
      ? n.payees.map((c) => `<tr${c.needs1099 ? ' class="acct-net"' : c.missingName ? ' class="row-off"' : ""}><td>${esc(c.payee)}</td><td class="num">${c.payments}</td><td class="num">${money(c.total)}</td><td class="num">${money(c.card)}</td><td class="num">${money(c.reportable)}</td><td>${esc(c.methods)}</td><td>${c.needs1099 ? "<b>Yes — file 1099-NEC</b>" : c.missingName ? "Add payee name" : "Below threshold / card"}</td></tr>`).join("") +
        `<tr class="acct-sub"><td>Total (${n.payees.length} payees, ${n.formsNeeded} form${n.formsNeeded === 1 ? "" : "s"} needed)</td><td class="num">${n.payees.reduce((s, c) => s + c.payments, 0)}</td><td class="num">${money(n.totalPaid)}</td><td class="num">${money(n.payees.reduce((s, c) => s + c.card, 0))}</td><td class="num">${money(n.totalReportable)}</td><td></td><td></td></tr>`
      : `<tr><td colspan="7" class="muted">No contract-labor expenses in this period. Record subcontract payments on the Receipts &rsaquo; Expenses tab (category Subcontract / labor, tax-deductible) and they appear here.</td></tr>`;
    $("acct-st-note").textContent = `Sales tax collected from customers is not recorded on invoices, so only tax PAID is shown. Use your invoice taxable sales for the Comptroller return.`;
    $("acct-st-month-body").innerHTML = st.byMonth.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${money(r.tax)}</td></tr>`).join("") +
      `<tr class="acct-sub"><td>Total tax paid on ${money(st.taxableBase)} of purchases</td><td class="num">${money(st.totalPaid)}</td></tr>`;
    $("acct-st-vendor-body").innerHTML = st.byVendor.length
      ? st.byVendor.map((v) => `<tr><td>${esc(v.vendor)}</td><td class="num">${v.lines}</td><td class="num">${money(v.subtotal)}</td><td class="num">${money(v.tax)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">No sales tax recorded in this period.</td></tr>`;
  }

  /* ---------- ledger ---------- */
  function renderLedger() {
    const m = MODEL, head = $("acct-ledger-head"), body = $("acct-ledger-body"), foot = $("acct-ledger-foot");
    document.querySelectorAll("#acct-ledger-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.view === LEDGER_VIEW));
    if (LEDGER_VIEW === "expenses") {
      head.innerHTML = `<tr><th>Date</th><th>Source</th><th>Vendor</th><th>Description</th><th>Category</th><th>P&amp;L line</th><th>Job / Project</th><th>Receipt #</th><th class="num">Subtotal</th><th class="num">Sales tax</th><th class="num">Total</th><th>Flag</th></tr>`;
      body.innerHTML = m.costs.map((c) => `<tr${c.flag ? ' class="row-off"' : ""}><td>${esc(c.date)}</td><td>${esc(c.source)}</td><td>${esc(c.vendor)}</td><td>${esc(c.description)}</td><td>${esc(c.category)}</td><td>${esc(SAA_ACCT_CATEGORIES[c.key].label)}</td><td>${esc(c.project)}</td><td>${esc(c.ref)}</td><td class="num">${money(c.subtotal)}</td><td class="num">${money(c.salesTax)}</td><td class="num">${money(c.amount)}</td><td>${esc(c.flag)}</td></tr>`).join("")
        || `<tr><td colspan="12" class="muted" style="text-align:center;padding:24px">No expenses in this period.</td></tr>`;
      foot.innerHTML = m.costs.length ? `<tr class="acct-sub"><td colspan="8">Total (${m.costs.length} entries)</td><td class="num">${money(m.costs.reduce((s, c) => s + c.subtotal, 0))}</td><td class="num">${money(m.salesTaxPaid)}</td><td class="num">${money(m.cogsTotal + m.opexTotal)}</td><td></td></tr>` : "";
    } else if (LEDGER_VIEW === "payments") {
      head.innerHTML = `<tr><th>Date</th><th>Customer</th><th>Job</th><th>Invoice #</th><th>Method</th><th>Reference #</th><th class="num">Amount</th></tr>`;
      body.innerHTML = m.incomeLedger.map((p) => `<tr><td>${esc(p.date)}</td><td>${esc(p.customer)}</td><td>${esc(p.job)}</td><td>${esc(p.invoice)}</td><td>${esc(p.method)}</td><td>${esc(p.ref)}</td><td class="num">${money(p.amount)}</td></tr>`).join("")
        || `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No payments in this period.</td></tr>`;
      foot.innerHTML = m.incomeLedger.length ? `<tr class="acct-sub"><td colspan="6">Total received (${m.incomeLedger.length})</td><td class="num">${money(m.revenue.cash)}</td></tr>` : "";
    } else {
      head.innerHTML = `<tr><th>Issued</th><th>Invoice #</th><th>Customer</th><th>Job</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th></tr>`;
      body.innerHTML = m.invoiceLedger.map((i) => `<tr><td>${esc(i.date)}</td><td>${esc(i.invoice)}</td><td>${esc(i.customer)}</td><td>${esc(i.job)}</td><td>${esc(i.status)}</td><td class="num">${money(i.total)}</td><td class="num">${money(i.paid)}</td><td class="num">${money(i.due)}</td></tr>`).join("")
        || `<tr><td colspan="8" class="muted" style="text-align:center;padding:24px">No invoices issued in this period.</td></tr>`;
      foot.innerHTML = m.invoiceLedger.length ? `<tr class="acct-sub"><td colspan="5">Total invoiced (${m.invoiceLedger.length})</td><td class="num">${money(m.revenue.accrual)}</td><td class="num">${money(m.invoiceLedger.reduce((s, i) => s + i.paid, 0))}</td><td class="num">${money(m.invoiceLedger.reduce((s, i) => s + i.due, 0))}</td></tr>` : "";
    }
  }

  /* ---------- Excel builders ---------- */
  const SUB = (r) => (r.kind === "sub" ? "mute" : r.kind === "net" ? "warn" : null);
  function amtCols(extra) {
    const cols = [];
    if (showCash()) cols.push({ header: "Cash basis", width: 17, type: "money" });
    if (showAccrual()) cols.push({ header: "Accrual basis", width: 17, type: "money" });
    return extra.concat(cols);
  }
  function amtCells(r) { const o = []; if (showCash()) o.push(r.cash == null ? "" : r.cash); if (showAccrual()) o.push(r.accrual == null ? "" : r.accrual); return o; }
  function subtitle(extra) { return "Generated " + saaXlsxTodayLabel() + "   |   " + basisLabel() + (extra ? "   |   " + extra : ""); }
  const TITLE = (what) => "SAA Comfort Air LLC — " + what + " — " + MODEL.period.label;

  function sheetPnl() {
    const rows = pnlRows(MODEL).filter((r) => r.kind !== "head" || true);
    const out = [], flags = [];
    let section = "";
    rows.forEach((r) => {
      if (r.kind === "head") { section = r.label; return; }
      out.push([section, r.label].concat(amtCells(r))); flags.push(SUB(r));
    });
    return { name: "Profit & Loss", title: TITLE("Profit & Loss"), subtitle: subtitle("grey = subtotals, yellow = net profit"), tabColor: "2F5496",
      columns: amtCols([{ header: "Section", width: 20 }, { header: "Line item", width: 52 }]), rows: out, flags };
  }
  function sheetMonths() {
    const cols = [{ header: "Month", width: 14 }];
    const rowsOf = (mo) => { const r = [mo.label]; if (showCash()) r.push(mo.cash); if (showAccrual()) r.push(mo.accrual); r.push(mo.cogs, mo.opex); if (showCash()) r.push(mo.netCash); if (showAccrual()) r.push(mo.netAccrual); return r; };
    if (showCash()) cols.push({ header: "Revenue (cash)", width: 16, type: "money", total: true });
    if (showAccrual()) cols.push({ header: "Revenue (accrual)", width: 17, type: "money", total: true });
    cols.push({ header: "Cost of goods sold", width: 17, type: "money", total: true }, { header: "Operating expenses", width: 18, type: "money", total: true });
    if (showCash()) cols.push({ header: "Net (cash)", width: 15, type: "money", total: true });
    if (showAccrual()) cols.push({ header: "Net (accrual)", width: 15, type: "money", total: true });
    return { name: "By Month", title: TITLE("Monthly Profit & Loss"), subtitle: subtitle(), tabColor: "2F5496", columns: cols, rows: MODEL.months.map(rowsOf), totals: true,
      flags: MODEL.months.map((mo) => (mo.netCash < 0 && showCash()) || (mo.netAccrual < 0 && !showCash()) ? "neg" : null) };
  }
  function sheetForm1065() {
    const t = MODEL.tax;
    return { name: "Form 1065 Summary", title: TITLE("Form 1065 Tax Summary (estimate for CPA review)"), subtitle: subtitle("grey = subtotals, yellow = ordinary business income"), tabColor: "548235",
      columns: amtCols([{ header: "Line", width: 8, type: "center" }, { header: "Form 1065, page 1", width: 52 }]),
      rows: t.form1065.map((r) => [r.line, r.label].concat(amtCells(r))), flags: t.form1065.map((r) => (r.final ? "warn" : r.subtotal ? "mute" : null)) };
  }
  function sheetL20() {
    const t = MODEL.tax;
    return { name: "Other Deductions (L20)", title: TITLE("Other Deductions Statement — Form 1065 line 20"), subtitle: subtitle("meals limited to 50%"), tabColor: "548235",
      columns: [{ header: "Category", width: 38 }, { header: "Entries", width: 10, type: "int", total: true }, { header: "Book amount", width: 16, type: "money", total: true }, { header: "Deductible amount", width: 18, type: "money", total: true }],
      rows: t.otherDeductions.map((l) => [l.label, l.count, l.amount, l.taxAmount]), totals: true, emptyText: "No other deductions in this period." };
  }
  function sheetCogs() {
    return { name: "COGS (Form 1125-A)", title: TITLE("Cost of Goods Sold detail — Form 1125-A / 1065 line 2"), subtitle: subtitle(), tabColor: "548235",
      columns: [{ header: "Category", width: 42 }, { header: "Entries", width: 10, type: "int", total: true }, { header: "Amount", width: 16, type: "money", total: true }],
      rows: MODEL.cogs.map((l) => [l.label, l.count, l.amount]), totals: true, emptyText: "No cost of goods sold in this period." };
  }
  function sheetMileage() {
    const mi = MODEL.mileage;
    return { name: "Mileage", title: TITLE("Vehicle mileage — standard rate $" + mi.rate.toFixed(3) + "/mile"), subtitle: subtitle("do not also deduct actual fuel/vehicle costs for the same vehicle"), tabColor: "548235",
      columns: [{ header: "Technician", width: 26 }, { header: "Trips / legs", width: 13, type: "int", total: true }, { header: "Miles", width: 12, type: "num", total: true }, { header: "Deduction", width: 15, type: "money", total: true }],
      rows: mi.byTech.map((g) => [g.name, g.trips, g.miles, g.amount]), totals: true, emptyText: "No mileage logged in this period." };
  }
  function sheetNec() {
    const n = MODEL.nec;
    return { name: "1099-NEC Report", title: TITLE("1099-NEC Contractor Report"), subtitle: subtitle(`threshold $${n.threshold.toLocaleString("en-US")}   |   yellow = 1099-NEC required   |   card/PayPal payments go on the processor's 1099-K`), tabColor: "7030A0",
      columns: [{ header: "Payee", width: 28 }, { header: "Payments", width: 10, type: "int", total: true }, { header: "First paid", width: 12, type: "date" }, { header: "Last paid", width: 12, type: "date" },
        { header: "Total paid", width: 15, type: "money", total: true }, { header: "Card / PayPal (1099-K)", width: 20, type: "money", total: true }, { header: "1099-NEC reportable", width: 20, type: "money", total: true },
        { header: "Paid via", width: 22 }, { header: "File 1099-NEC?", width: 18 }],
      rows: n.payees.map((c) => [c.payee, c.payments, c.firstDate, c.lastDate, c.total, c.card, c.reportable, c.methods, c.needs1099 ? "Yes" : c.missingName ? "Add payee name" : "No"]),
      flags: n.payees.map((c) => (c.needs1099 ? "warn" : c.missingName ? "neg" : null)), totals: true, emptyText: "No contract-labor payments in this period." };
  }
  function sheetSalesTax() {
    const st = MODEL.salesTaxSummary;
    return { name: "Sales Tax Paid", title: TITLE("Texas Sales Tax — paid on purchases"), subtitle: subtitle("tax collected from customers is not recorded on invoices"), tabColor: "7030A0",
      columns: [{ header: "Vendor", width: 30 }, { header: "Lines", width: 9, type: "int", total: true }, { header: "Purchases (before tax)", width: 22, type: "money", total: true }, { header: "Sales tax paid", width: 16, type: "money", total: true }],
      rows: st.byVendor.map((v) => [v.vendor, v.lines, v.subtotal, v.tax]), totals: true, emptyText: "No sales tax recorded in this period." };
  }
  function sheetSalesTaxMonths() {
    return { name: "Sales Tax by Month", title: TITLE("Texas Sales Tax paid — by month"), subtitle: subtitle(), tabColor: "7030A0",
      columns: [{ header: "Month", width: 16 }, { header: "Sales tax paid", width: 16, type: "money", total: true }],
      rows: MODEL.salesTaxSummary.byMonth.map((r) => [r.label, r.tax]), totals: true };
  }
  function sheetExpenses() {
    const costs = MODEL.costs;
    return { name: "Expenses Ledger", title: TITLE("Expense & Receipts Ledger (incl. sales tax paid)"), subtitle: subtitle(costs.length + " entries   |   yellow = needs review / no amount"), tabColor: "C55A11", freezeCols: 1,
      columns: [{ header: "Date", width: 12, type: "date" }, { header: "Source", width: 10 }, { header: "Vendor", width: 22 }, { header: "Description", width: 44, type: "wrap" },
        { header: "Category", width: 20 }, { header: "P&L category", width: 30 }, { header: "Job / Project", width: 20 }, { header: "Receipt #", width: 14 }, { header: "Payment", width: 14 },
        { header: "Subtotal", width: 13, type: "money", total: true }, { header: "Sales tax", width: 12, type: "money", total: true }, { header: "Total", width: 13, type: "money", total: true }, { header: "Flag", width: 16 }],
      rows: costs.map((c) => [c.date, c.source, c.vendor, c.description, c.category, SAA_ACCT_CATEGORIES[c.key].label, c.project, c.ref, c.payment, c.subtotal, c.salesTax, c.amount, c.flag]),
      flags: costs.map((c) => (c.flag ? "warn" : c.amount < 0 ? "neg" : null)), totals: true, emptyText: "No expenses in this period." };
  }
  function sheetPayments() {
    return { name: "Income - Payments", title: TITLE("Income Ledger — payments received (cash basis)"), subtitle: subtitle(MODEL.incomeLedger.length + " payments"), tabColor: "2E75B6",
      columns: [{ header: "Date", width: 12, type: "date" }, { header: "Customer", width: 24 }, { header: "Job", width: 18 }, { header: "Invoice #", width: 14 }, { header: "Method", width: 12 }, { header: "Reference #", width: 16 }, { header: "Amount", width: 14, type: "money", total: true }],
      rows: MODEL.incomeLedger.map((p) => [p.date, p.customer, p.job, p.invoice, p.method, p.ref, p.amount]), totals: true, emptyText: "No payments in this period." };
  }
  function sheetInvoices() {
    return { name: "Income - Invoices", title: TITLE("Income Ledger — invoices issued (accrual basis)"), subtitle: subtitle(MODEL.invoiceLedger.length + " invoices   |   yellow = balance due"), tabColor: "2E75B6",
      columns: [{ header: "Issued", width: 12, type: "date" }, { header: "Invoice #", width: 14 }, { header: "Customer", width: 24 }, { header: "Job", width: 18 }, { header: "Status", width: 10 },
        { header: "Total", width: 14, type: "money", total: true }, { header: "Paid", width: 14, type: "money", total: true }, { header: "Balance", width: 14, type: "money", total: true }],
      rows: MODEL.invoiceLedger.map((i) => [i.date, i.invoice, i.customer, i.job, i.status, i.total, i.paid, i.due]), flags: MODEL.invoiceLedger.map((i) => (i.due > 0.005 ? "warn" : null)), totals: true, emptyText: "No invoices issued in this period." };
  }

  function fname(kind) { return `SAA-${kind}-${MODEL.period.label.replace(/[^A-Za-z0-9]+/g, "-")}-${saaXlsxStamp()}`; }
  const DOWNLOADS = {
    pnl: () => saaXlsxDownload(fname("Profit-and-Loss"), [sheetPnl(), sheetMonths()]),
    tax: () => saaXlsxDownload(fname("Tax-Summary-1065"), [sheetForm1065(), sheetL20(), sheetCogs(), sheetMileage()]),
    nec: () => saaXlsxDownload(fname("1099-NEC-Report"), [sheetNec()]),
    salestax: () => saaXlsxDownload(fname("Sales-Tax-Summary"), [sheetSalesTax(), sheetSalesTaxMonths()]),
    ledger: () => saaXlsxDownload(fname("Receipts-Ledger"), [sheetExpenses(), sheetPayments(), sheetInvoices()]),
    all: () => saaXlsxDownload(fname("Complete-Tax-Workbook"), [sheetPnl(), sheetMonths(), sheetForm1065(), sheetL20(), sheetCogs(), sheetMileage(), sheetNec(), sheetSalesTax(), sheetSalesTaxMonths(), sheetExpenses(), sheetPayments(), sheetInvoices()]),
    pdf: () => printAccountsPackage({ model: MODEL, rows: pnlRows(MODEL), cash: showCash(), accrual: showAccrual(), basisLabel: basisLabel(), generatedOn: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) }),
  };
  // exposed for tests
  window._saaAcctTest = { sheets: () => ({ pnl: sheetPnl(), months: sheetMonths(), form1065: sheetForm1065(), l20: sheetL20(), cogs: sheetCogs(), mileage: sheetMileage(), nec: sheetNec(), salestax: sheetSalesTax(), salestaxMonths: sheetSalesTaxMonths(), expenses: sheetExpenses(), payments: sheetPayments(), invoices: sheetInvoices() }), model: () => MODEL };

  /* ---------- wiring ---------- */
  function recompute() {
    if (!DATA) return;
    const rateRaw = parseFloat($("acct-rate").value);
    MODEL = saaAcctBuild(DATA, saaAcctPeriod($("acct-year").value, $("acct-period").value), { mileageRate: isFinite(rateRaw) ? rateRaw : undefined });
    renderCards(); renderPnl(); renderTax(); renderLedger();
    $("acct-period-label").textContent = MODEL.period.label + " · " + basisLabel();
  }

  function showTab(tab) {
    if (!["pl", "tax", "ledger", "docs"].includes(tab)) tab = "pl";
    document.querySelectorAll("#acct-tabs .cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".acct-panel").forEach((p) => { p.hidden = p.dataset.tab !== tab; });
    document.querySelectorAll(".acct-panel-extra").forEach((p) => { p.hidden = p.dataset.for !== tab; });
  }
  function tabFromHash() { return (location.hash || "").replace("#", "") || "pl"; }

  // Years that have data (plus this year); keeps the chosen year across a refresh.
  function fillYears() {
    const years = saaAcctYears(DATA), keep = $("acct-year").value;
    $("acct-year").innerHTML = years.map((y) => `<option>${y}</option>`).join("");
    const cur = String(new Date().getFullYear());
    $("acct-year").value = years.map(String).includes(keep) ? keep : (years.includes(Number(cur)) ? cur : String(years[0]));
  }

  function setDefaultRate() {
    const yr = Number($("acct-year").value);
    $("acct-rate").value = saaAcctMileageRate(yr).toFixed(3);
  }

  async function init() {
    document.querySelectorAll("#acct-tabs .cal-view-btn").forEach((b) => b.addEventListener("click", () => { showTab(b.dataset.tab); try { history.replaceState(null, "", "#" + b.dataset.tab); } catch (e) { /* ignore */ } }));
    window.addEventListener("hashchange", () => showTab(tabFromHash()));
    showTab(tabFromHash());
    document.querySelectorAll("#acct-ledger-toggle button").forEach((b) => b.addEventListener("click", () => { LEDGER_VIEW = b.dataset.view; renderLedger(); }));
    document.querySelectorAll("[data-acct-dl]").forEach((b) => b.addEventListener("click", () => { if (MODEL) DOWNLOADS[b.dataset.acctDl](); }));

    DATA = await saaAcctLoadAll();
    fillYears();
    setDefaultRate();
    $("acct-year").addEventListener("change", () => { setDefaultRate(); recompute(); });
    ["acct-period", "acct-basis", "acct-rate"].forEach((id) => $(id).addEventListener("change", recompute));
    $("acct-rate").addEventListener("input", recompute);
    $("acct-refresh").addEventListener("click", async () => { $("acct-refresh").disabled = true; DATA = await saaAcctLoadAll(); fillYears(); recompute(); $("acct-refresh").disabled = false; });
    recompute();
    $("acct-loading").hidden = true;
  }
  init();
})();
