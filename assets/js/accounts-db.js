/* ============================================================
   SAA Comfort Air LLC — Accounts data + calculation layer
   (Round 101, 2026-10-06)

   Per Vijayan: "Add another section for accounts in employee dashboard.
   that would calculate the profit and loss and make documents for tax
   submission."  Answers: taxed as a multi-member partnership (Form 1065);
   show cash AND accrual side by side; documents = P&L (Excel), tax summary
   by category (Excel), printable PDF package, receipts / sales-tax ledger.

   Nothing new is stored in the database -- every number is computed live
   from what the app already records:
     income   : payments (cash basis, by payment date)
                invoices (accrual basis, by issue date; void ignored)
     expenses : receipt line items (Receipts bucket = job materials = cost of
                goods sold; Tools and Supplies buckets = operating), the
                Expenses tab (tax-deductible ones, mapped by tax category),
                and mileage (miles x IRS standard rate).
   Requires jobs-db.js, invoices-db.js, payments-db.js, receipts-db.js,
   expenses-db.js, mileage-db.js (and auth.js's shared _saaClient).

   Everything below the loaders is a PURE function (no DOM, no network), so
   the numbers can be unit-tested and reused by the Excel / PDF builders.
   ============================================================ */

// IRS standard business mileage rates ($/mile). 2026 = 72.5 cents (IRS
// Notice, Dec 2025). The page lets the user override the rate.
const SAA_IRS_MILEAGE_RATES = { 2023: 0.655, 2024: 0.67, 2025: 0.70, 2026: 0.725 };
function saaAcctMileageRate(year) {
  const y = Number(year);
  if (SAA_IRS_MILEAGE_RATES[y] != null) return SAA_IRS_MILEAGE_RATES[y];
  return y > 2026 ? SAA_IRS_MILEAGE_RATES[2026] : SAA_IRS_MILEAGE_RATES[2023];
}

/* ---- Where every kind of cost lands -------------------------------------
   section: "cogs" (Form 1125-A / Form 1065 line 2) or "opex" (deductions).
   line:    the Form 1065 page-1 line it rolls up to ("20" = Other deductions,
            itemised on the attached statement). */
const SAA_ACCT_CATEGORIES = {
  materials:  { section: "cogs", line: "2",   label: "Job materials & parts (purchases)" },
  subs:       { section: "cogs", line: "2",   label: "Subcontract / contract labor (jobs)" },
  wages:      { section: "opex", line: "9",   label: "Salaries & wages (non-partners)" },
  guaranteed: { section: "opex", line: "10",  label: "Guaranteed payments to partners" },
  repairs:    { section: "opex", line: "11",  label: "Repairs & maintenance" },
  rent:       { section: "opex", line: "13",  label: "Rent" },
  taxes:      { section: "opex", line: "14",  label: "Taxes & licenses" },
  interest:   { section: "opex", line: "15",  label: "Interest" },
  depr:       { section: "opex", line: "16a", label: "Depreciation" },
  tools:      { section: "opex", line: "20",  label: "Tools & small equipment" },
  supplies:   { section: "opex", line: "20",  label: "Shop supplies & consumables" },
  meals:      { section: "opex", line: "20",  label: "Meals (50% deductible)" },
  travel:     { section: "opex", line: "20",  label: "Travel" },
  prof:       { section: "opex", line: "20",  label: "Professional fees" },
  advert:     { section: "opex", line: "20",  label: "Advertising" },
  insurance:  { section: "opex", line: "20",  label: "Insurance" },
  utilities:  { section: "opex", line: "20",  label: "Utilities & phone" },
  software:   { section: "opex", line: "20",  label: "Software & subscriptions" },
  bankfees:   { section: "opex", line: "20",  label: "Bank & card fees" },
  contract:   { section: "opex", line: "20",  label: "Contract labor (not job-specific)" },
  vehicle:    { section: "opex", line: "20",  label: "Vehicle & fuel (actual costs)" },
  mileage:    { section: "opex", line: "20",  label: "Vehicle — standard mileage" },
  other:      { section: "opex", line: "20",  label: "Other expenses" },
};
// Display order within each section.
const SAA_ACCT_ORDER = Object.keys(SAA_ACCT_CATEGORIES);

// Expense-tab "tax category" text -> key above.
const SAA_ACCT_TAXCAT_MAP = {
  "Meals (50% deductible)": "meals", "Travel": "travel", "Contract labor": "subs",
  "Professional fees": "prof", "Tools & equipment": "tools", "Supplies": "supplies",
  "Vehicle & fuel": "vehicle", "Advertising": "advert", "Other": "other",
  "Wages & payroll": "wages", "Guaranteed payments to partners": "guaranteed",
  "Repairs & maintenance": "repairs", "Rent": "rent", "Licenses, permits & taxes": "taxes",
  "Interest": "interest", "Depreciation": "depr", "Insurance": "insurance",
  "Utilities & phone": "utilities", "Software & subscriptions": "software", "Bank & card fees": "bankfees",
};

const SAA_ACCT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ---------- small helpers ---------- */
function _acctNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function _acctRound(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function _acctDay(v) { return v ? String(v).slice(0, 10) : ""; }
function _acctCust(c) { return c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : ""; }

/** period = { year, kind: "year" | "q1".."q4" | "m1".."m12" } -> {from,to,label,months:[1..12]} */
function saaAcctPeriod(year, kind) {
  const y = Number(year);
  kind = kind || "year";
  let m1 = 1, m2 = 12, label = String(y);
  const q = /^q([1-4])$/.exec(kind), m = /^m(\d{1,2})$/.exec(kind);
  if (q) { m1 = (Number(q[1]) - 1) * 3 + 1; m2 = m1 + 2; label = "Q" + q[1] + " " + y; }
  else if (m) { m1 = m2 = Math.min(12, Math.max(1, Number(m[1]))); label = SAA_ACCT_MONTHS[m1 - 1] + " " + y; }
  else label = "Full year " + y;
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m2, 0)).getUTCDate();
  const months = []; for (let i = m1; i <= m2; i++) months.push(i);
  return { year: y, kind, from: `${y}-${pad(m1)}-01`, to: `${y}-${pad(m2)}-${pad(last)}`, label, months };
}
function _acctIn(period, dateStr) { return !!dateStr && dateStr >= period.from && dateStr <= period.to; }

/* ---------- loaders ---------- */
/** Everything the Accounts page needs, fetched once. */
async function saaAcctLoadAll() {
  const [invoices, payments, receiptLines, expenses, mileage, events, jobOptions] = await Promise.all([
    saaInvoicesFetchAll().catch((e) => { console.error(e); return []; }),
    saaPaymentsFetchAll().catch((e) => { console.error(e); return []; }),
    saaLineItemsFetchAll().catch((e) => { console.error(e); return []; }),
    saaExpensesFetchAll().catch((e) => { console.error(e); return []; }),
    saaMileageFetchAll().catch((e) => { console.error(e); return []; }),
    // Round 106 (project P&L): event -> its CURRENT job, and every job's number + customer name
    (async () => { const r = await _saaClient.from("events").select("id,job_id"); return r.data || []; })().catch((e) => { console.error(e); return []; }),
    (typeof saaReceiptsFetchJobPickerOptions === "function" ? saaReceiptsFetchJobPickerOptions() : Promise.resolve([])).catch((e) => { console.error(e); return []; }),
  ]);
  return { invoices, payments, receiptLines, expenses, mileage, events, jobOptions };
}

/** Years that have any data (plus the current year), newest first. */
function saaAcctYears(data) {
  const set = new Set([new Date().getFullYear()]);
  const add = (d) => { const y = parseInt(String(d || "").slice(0, 4), 10); if (y > 2000) set.add(y); };
  (data.invoices || []).forEach((i) => add(i.issue_date));
  (data.payments || []).forEach((p) => add(p.payment_date));
  (data.receiptLines || []).forEach((r) => add(r.r_received_at));
  (data.expenses || []).forEach((e) => add(e.expense_date));
  (data.mileage || []).forEach((l) => add(l.log_date));
  return [...set].sort((a, b) => b - a);
}

/* ---------- classification of one cost ---------- */
/** Receipt line item -> { key, flagged } */
function saaAcctClassifyReceiptLine(li) {
  const key = li.bucket === "tools" ? "tools" : li.bucket === "supplies" ? "supplies" : "materials";
  return { key };
}
/** Expense row -> { key, included, note } (non-deductible expenses are left out of the P&L). */
function saaAcctClassifyExpense(e) {
  if (!e.tax_deductible) return { key: "other", included: false, note: "Not tax deductible" };
  const tc = e.tax_category || "";
  let key = SAA_ACCT_TAXCAT_MAP[tc];
  let note = "";
  if (key === "subs" && e.scope !== "job") key = "contract";
  if (!key) {
    if (e.scope === "tools") key = "tools";
    else if (/meal|food/i.test(e.category || "")) key = "meals";
    else if (/travel/i.test(e.category || "")) key = "travel";
    else if (/subcontract|labor/i.test(e.category || "")) key = e.scope === "job" ? "subs" : "contract";
    else if (/advis|profession/i.test(e.category || "")) key = "prof";
    else key = "other";
    note = "No tax category set";
  }
  return { key, included: true, note };
}

/* ---------- the main calculation ---------- */
/**
 * data    = saaAcctLoadAll() result
 * period  = saaAcctPeriod(...)
 * opts    = { mileageRate }   ($ per mile)
 */
function saaAcctBuild(data, period, opts) {
  opts = opts || {};
  const rate = opts.mileageRate != null ? _acctNum(opts.mileageRate) : saaAcctMileageRate(period.year);

  /* ---- income ---- */
  const payments = (data.payments || []).filter((p) => _acctIn(period, _acctDay(p.payment_date)));
  const liveInvoices = (data.invoices || []).filter((i) => i.status !== "void");
  const invoices = liveInvoices.filter((i) => _acctIn(period, _acctDay(i.issue_date)));
  const invTotal = (i) => (i.totalDue != null ? _acctNum(i.totalDue) : _acctNum(i.amount_total) - _acctNum(i.discount) + _acctNum(i.additional_charges));
  const cashRevenue = _acctRound(payments.reduce((s, p) => s + _acctNum(p.amount), 0));
  const accrualRevenue = _acctRound(invoices.reduce((s, i) => s + invTotal(i), 0));
  const arOutstanding = _acctRound(liveInvoices.reduce((s, i) => s + Math.max(0, invTotal(i) - _acctNum(i.amountPaid)), 0));
  const draftInvoices = invoices.filter((i) => i.status === "draft");

  /* ---- costs: unify receipt lines + expenses into one list ---- */
  const costs = [];
  let noAmount = 0, needsReview = 0, excluded = { count: 0, amount: 0 }, noTaxCat = 0, noTaxCatAmount = 0;
  (data.receiptLines || []).forEach((li) => {
    const date = _acctDay(li.r_received_at);
    if (!_acctIn(period, date)) return;
    const cls = saaAcctClassifyReceiptLine(li);
    const hasAmt = li.item_total != null && li.item_total !== "";
    if (!hasAmt) noAmount++;
    if (li.auto_tagged) needsReview++;
    const sub = hasAmt ? _acctNum(li.item_total) : 0;
    const tax = hasAmt ? _acctNum(li.sales_tax) : 0;
    costs.push({
      date, source: "Receipt", vendor: li.r_vendor || "", description: li.item_description || "",
      category: li.category || "", key: cls.key, bucket: li.bucket,
      project: (li.job && li.job.job_number) || li.project_label || "",
      jobId: (li.event && li.event.job_id) || li.job_id || null, customerId: li.customer_id || null, customerName: _acctCust(li.customer), projectLabel: li.project_label || "",
      ref: li.r_receipt_number || "", payment: li.r_payment_method || "",
      subtotal: sub, salesTax: tax, amount: _acctRound(sub + tax),
      flag: !hasAmt ? "No amount" : li.auto_tagged ? "Needs review" : "",
    });
  });
  (data.expenses || []).forEach((e) => {
    const date = _acctDay(e.expense_date);
    if (!_acctIn(period, date)) return;
    const cls = saaAcctClassifyExpense(e);
    const amt = _acctNum(e.amount);
    if (!cls.included) { excluded.count++; excluded.amount = _acctRound(excluded.amount + amt); return; }
    if (cls.note) { noTaxCat++; noTaxCatAmount += amt; }
    costs.push({
      date, source: "Expense", vendor: e.vendor || "", description: e.description || "",
      category: e.category || "", key: cls.key, bucket: e.scope || "",
      project: e.scope === "job" ? "Job / project" : e.scope === "tools" ? "SAA - Tools" : "SAA",
      jobId: e.scope === "job" ? (e.job_id || null) : null, customerId: null, projectLabel: e.scope === "tools" ? "SAA - Tools" : e.scope === "job" ? "" : "SAA (general)",
      ref: "", payment: e.payment_method || "",
      subtotal: amt, salesTax: 0, amount: _acctRound(amt),
      flag: cls.note || (e.reimbursable && !e.reimbursed ? "Owed back to payer" : ""),
    });
  });

  /* ---- mileage -> standard-mileage deduction ---- */
  const logs = (data.mileage || []).filter((l) => _acctIn(period, _acctDay(l.log_date)));
  const miles = _acctRound(logs.reduce((s, l) => s + _acctNum(l.miles), 0));
  const mileageAmount = _acctRound(miles * rate);
  const byTech = {};
  logs.forEach((l) => {
    const name = (l.technician && l.technician.name) || "Unassigned";
    const g = byTech[name] || (byTech[name] = { name, miles: 0, trips: 0 });
    g.miles += _acctNum(l.miles); g.trips += 1;
  });
  const mileageByTech = Object.values(byTech).map((g) => ({ name: g.name, trips: g.trips, miles: _acctRound(g.miles), amount: _acctRound(g.miles * rate) }))
    .sort((a, b) => b.miles - a.miles);
  if (mileageAmount) {
    costs.push({
      date: period.to, source: "Mileage", vendor: "Company vehicles", description: `${miles} mi x $${rate.toFixed(3)}/mi (IRS standard rate)`,
      category: "Mileage", key: "mileage", bucket: "", project: "", ref: "", payment: "",
      subtotal: mileageAmount, salesTax: 0, amount: mileageAmount, flag: "", synthetic: true,
    });
  }

  /* ---- roll up by category ---- */
  const byKey = {};
  costs.forEach((c) => {
    const g = byKey[c.key] || (byKey[c.key] = { key: c.key, amount: 0, count: 0, salesTax: 0 });
    g.amount += c.amount; g.count += 1; g.salesTax += c.salesTax;
  });
  const lineFor = (key) => {
    const meta = SAA_ACCT_CATEGORIES[key], g = byKey[key] || { amount: 0, count: 0, salesTax: 0 };
    return { key, label: meta.label, section: meta.section, line: meta.line, amount: _acctRound(g.amount), count: g.count, salesTax: _acctRound(g.salesTax) };
  };
  const cogs = SAA_ACCT_ORDER.filter((k) => SAA_ACCT_CATEGORIES[k].section === "cogs").map(lineFor).filter((l) => l.count);
  const opex = SAA_ACCT_ORDER.filter((k) => SAA_ACCT_CATEGORIES[k].section === "opex").map(lineFor).filter((l) => l.count);
  const sum = (arr) => _acctRound(arr.reduce((s, l) => s + l.amount, 0));
  const cogsTotal = sum(cogs), opexTotal = sum(opex);
  const salesTaxPaid = _acctRound(costs.reduce((s, c) => s + c.salesTax, 0));

  const net = { cash: _acctRound(cashRevenue - cogsTotal - opexTotal), accrual: _acctRound(accrualRevenue - cogsTotal - opexTotal) };
  const gross = { cash: _acctRound(cashRevenue - cogsTotal), accrual: _acctRound(accrualRevenue - cogsTotal) };

  /* ---- tax view: meals limited to 50% ---- */
  const mealsFull = (byKey.meals && _acctRound(byKey.meals.amount)) || 0;
  const mealsNonDeductible = _acctRound(mealsFull * 0.5);
  const totalDeductionsTax = _acctRound(opexTotal - mealsNonDeductible);
  const taxable = { cash: _acctRound(gross.cash - totalDeductionsTax), accrual: _acctRound(gross.accrual - totalDeductionsTax) };
  const line = (n) => _acctRound(opex.filter((l) => l.line === n).reduce((s, l) => s + (l.key === "meals" ? l.amount * 0.5 : l.amount), 0));
  const form1065 = [
    { line: "1a", label: "Gross receipts or sales", cash: cashRevenue, accrual: accrualRevenue, income: true },
    { line: "1b", label: "Returns and allowances", cash: 0, accrual: 0, income: true },
    { line: "2",  label: "Cost of goods sold (Form 1125-A)", cash: cogsTotal, accrual: cogsTotal },
    { line: "3",  label: "Gross profit", cash: gross.cash, accrual: gross.accrual, subtotal: true },
    { line: "8",  label: "Total income (loss)", cash: gross.cash, accrual: gross.accrual, subtotal: true },
    { line: "9",  label: "Salaries and wages (other than to partners)", cash: line("9"), accrual: line("9") },
    { line: "10", label: "Guaranteed payments to partners", cash: line("10"), accrual: line("10") },
    { line: "11", label: "Repairs and maintenance", cash: line("11"), accrual: line("11") },
    { line: "12", label: "Bad debts", cash: 0, accrual: 0 },
    { line: "13", label: "Rent", cash: line("13"), accrual: line("13") },
    { line: "14", label: "Taxes and licenses", cash: line("14"), accrual: line("14") },
    { line: "15", label: "Interest", cash: line("15"), accrual: line("15") },
    { line: "16a", label: "Depreciation (Form 4562)", cash: line("16a"), accrual: line("16a") },
    { line: "20", label: "Other deductions (attach statement)", cash: line("20"), accrual: line("20") },
    { line: "21", label: "Total deductions", cash: totalDeductionsTax, accrual: totalDeductionsTax, subtotal: true },
    { line: "22", label: "Ordinary business income (loss)", cash: taxable.cash, accrual: taxable.accrual, subtotal: true, final: true },
  ];
  const otherDeductions = opex.filter((l) => l.line === "20").map((l) => Object.assign({}, l, {
    taxAmount: l.key === "meals" ? _acctRound(l.amount * 0.5) : l.amount,
  }));

  /* ---- 1099-NEC contractor report (Round 101b) ----
     Contract / subcontract labor paid to people & unincorporated businesses.
     Card / PayPal / Venmo payments are reported by the processor on a 1099-K,
     so they are listed but not counted towards the 1099-NEC amount. */
  const necThreshold = opts.necThreshold != null ? _acctNum(opts.necThreshold) : (period.year >= 2026 ? 2000 : 600);
  const isThirdParty = (pm) => /card|credit|debit|paypal|venmo|cash app|stripe|square/i.test(pm || "");
  const byPayee = {};
  (data.expenses || []).forEach((e) => {
    const date = _acctDay(e.expense_date);
    if (!_acctIn(period, date)) return;
    const cls = saaAcctClassifyExpense(e);
    if (!cls.included || (cls.key !== "subs" && cls.key !== "contract")) return;
    const name = (e.vendor || "").trim() || "(no payee name)";
    const g = byPayee[name.toLowerCase()] || (byPayee[name.toLowerCase()] = { payee: name, payments: 0, total: 0, card: 0, reportable: 0, firstDate: date, lastDate: date, methods: {} });
    const amt = _acctNum(e.amount);
    g.payments += 1; g.total += amt;
    if (isThirdParty(e.payment_method)) g.card += amt; else g.reportable += amt;
    if (e.payment_method) g.methods[e.payment_method] = 1;
    if (date < g.firstDate) g.firstDate = date;
    if (date > g.lastDate) g.lastDate = date;
  });
  const contractors = Object.values(byPayee).map((g) => ({
    payee: g.payee, payments: g.payments, total: _acctRound(g.total), card: _acctRound(g.card), reportable: _acctRound(g.reportable),
    firstDate: g.firstDate, lastDate: g.lastDate, methods: Object.keys(g.methods).join(", "),
    needs1099: g.reportable >= necThreshold && g.reportable > 0,
    missingName: g.payee === "(no payee name)",
  })).sort((a, b) => b.reportable - a.reportable || b.total - a.total);
  const nec = {
    threshold: necThreshold, payees: contractors,
    totalPaid: _acctRound(contractors.reduce((s, c) => s + c.total, 0)),
    totalReportable: _acctRound(contractors.reduce((s, c) => s + c.reportable, 0)),
    formsNeeded: contractors.filter((c) => c.needs1099).length,
  };

  /* ---- Sales tax summary (Round 101b) ----
     Tax PAID on purchases is recorded on every receipt line. Sales tax
     COLLECTED from customers is not stored on invoices, so it is not
     computed here -- the Texas Comptroller return needs your taxable-sales
     figure from your invoices. */
  const stMonth = {}, stVendor = {};
  costs.forEach((c) => {
    if (!c.salesTax) return;
    const mk = c.date.slice(0, 7);
    stMonth[mk] = (stMonth[mk] || 0) + c.salesTax;
    const vn = c.vendor || "(no vendor)";
    const v = stVendor[vn] || (stVendor[vn] = { vendor: vn, lines: 0, subtotal: 0, tax: 0 });
    v.lines += 1; v.subtotal += c.subtotal; v.tax += c.salesTax;
  });
  const salesTaxSummary = {
    totalPaid: salesTaxPaid,
    byMonth: period.months.map((mo) => { const k = `${period.year}-${String(mo).padStart(2, "0")}`; return { label: SAA_ACCT_MONTHS[mo - 1], key: k, tax: _acctRound(stMonth[k] || 0) }; }),
    byVendor: Object.values(stVendor).map((v) => ({ vendor: v.vendor, lines: v.lines, subtotal: _acctRound(v.subtotal), tax: _acctRound(v.tax) })).sort((a, b) => b.tax - a.tax),
    taxableBase: _acctRound(costs.filter((c) => c.salesTax).reduce((s, c) => s + c.subtotal, 0)),
  };

  /* ---- by month ---- */
  const months = period.months.map((mo) => {
    const key = `${period.year}-${String(mo).padStart(2, "0")}`;
    const inM = (d) => String(d || "").slice(0, 7) === key;
    const cash = _acctRound(payments.filter((p) => inM(p.payment_date)).reduce((s, p) => s + _acctNum(p.amount), 0));
    const acc = _acctRound(invoices.filter((i) => inM(i.issue_date)).reduce((s, i) => s + invTotal(i), 0));
    const cg = _acctRound(costs.filter((c) => SAA_ACCT_CATEGORIES[c.key].section === "cogs" && inM(c.date)).reduce((s, c) => s + c.amount, 0));
    // mileage is booked at period end by the loop above; re-spread it by month for the monthly view
    const ox = _acctRound(costs.filter((c) => !c.synthetic && SAA_ACCT_CATEGORIES[c.key].section === "opex" && inM(c.date)).reduce((s, c) => s + c.amount, 0)
      + _acctRound(logs.filter((l) => inM(l.log_date)).reduce((s, l) => s + _acctNum(l.miles), 0) * rate));
    return { key, label: SAA_ACCT_MONTHS[mo - 1], cash, accrual: acc, cogs: cg, opex: ox, netCash: _acctRound(cash - cg - ox), netAccrual: _acctRound(acc - cg - ox) };
  });

  /* ---- Profit & loss by project (Round 106) ----
     A project is a job. Revenue: payments (cash) and invoices (accrual) go to the job the invoice
     belongs to -- an invoice / payment raised against an Event counts under that Event's CURRENT job,
     the same rule the Receipts "By Project" tab uses for costs. Costs: receipt lines, job-scope
     expenses. Everything with no job (shop tools, general expenses, mileage, ...) is listed as
     overhead so the project rows always add up to the P&L above. */
  const optByJob = {}; (data.jobOptions || []).forEach((o) => { optByJob[o.job_id] = o; });
  const eventJob = {}; (data.events || []).forEach((ev) => { eventJob[ev.id] = ev.job_id; });
  const invById = {}; (data.invoices || []).forEach((i) => { invById[i.id] = i; });
  const pGroups = {};
  const pgroup = (key, kind, label, customer, jobId) => pGroups[key] || (pGroups[key] = { key, kind, label, customer: customer || "", job_id: jobId || null, revCash: 0, revAccrual: 0, cogs: 0, opex: 0, count: 0 });
  const jobGroup = (jobId, fallbackLabel) => {
    const o = optByJob[jobId], parts = o ? String(o.label).split(" — ") : [];
    return pgroup("job:" + jobId, "job", o ? parts[0] : (fallbackLabel || "Job"), o ? parts.slice(1).join(" — ") : "", jobId);
  };
  const noJobGroup = (c) => {
    if (c && c.customerId) { const name = c.customerName || "Customer"; return pgroup("cust:" + c.customerId, "customer", name + " (no job)", name, null); }
    if (c && c.synthetic) return pgroup("lbl:mileage", "shop", "Mileage (not tied to a job)", "", null);
    if (c && c.projectLabel) return pgroup("lbl:" + c.projectLabel, "shop", c.projectLabel, "", null);
    return pgroup("none", "none", "Unassigned (no job)", "", null);
  };
  payments.forEach((p) => {
    const inv = invById[p.invoice_id] || null;
    const jid = (p.event_id && eventJob[p.event_id]) || (inv && inv.event_id && eventJob[inv.event_id]) || (inv && inv.job_id) || p.job_id || null;
    const g = jid ? jobGroup(jid, (p.job && p.job.job_number) || "") : noJobGroup(null);
    g.revCash += _acctNum(p.amount);
  });
  invoices.forEach((i) => {
    const jid = (i.event_id && eventJob[i.event_id]) || i.job_id || null;
    const g = jid ? jobGroup(jid, (i.job && i.job.job_number) || "") : noJobGroup(null);
    g.revAccrual += invTotal(i);
  });
  costs.forEach((c) => {
    const g = c.jobId ? jobGroup(c.jobId, c.project) : noJobGroup(c);
    if (SAA_ACCT_CATEGORIES[c.key].section === "cogs") g.cogs += c.amount; else g.opex += c.amount;
    g.count += 1;
  });
  const projects = Object.values(pGroups).map((g) => {
    const r = { key: g.key, kind: g.kind, label: g.label, customer: g.customer, job_id: g.job_id, count: g.count,
      revCash: _acctRound(g.revCash), revAccrual: _acctRound(g.revAccrual), cogs: _acctRound(g.cogs), opex: _acctRound(g.opex) };
    r.cost = _acctRound(r.cogs + r.opex);
    r.profitCash = _acctRound(r.revCash - r.cost); r.profitAccrual = _acctRound(r.revAccrual - r.cost);
    r.marginCash = r.revCash > 0 ? r.profitCash / r.revCash : null; r.marginAccrual = r.revAccrual > 0 ? r.profitAccrual / r.revAccrual : null;
    return r;
  }).sort((a, b) => (a.kind === "job" || a.kind === "customer" ? 0 : 1) - (b.kind === "job" || b.kind === "customer" ? 0 : 1)
    || Math.max(b.revCash, b.revAccrual) - Math.max(a.revCash, a.revAccrual) || b.cost - a.cost || a.label.localeCompare(b.label));
  const pSum = (f) => _acctRound(projects.reduce((s, r) => s + r[f], 0));
  const projectTotals = { revCash: pSum("revCash"), revAccrual: pSum("revAccrual"), cogs: pSum("cogs"), opex: pSum("opex"), cost: pSum("cost"), profitCash: pSum("profitCash"), profitAccrual: pSum("profitAccrual"),
    jobCount: projects.filter((r) => r.kind === "job" || r.kind === "customer").length };

  costs.sort((a, b) => b.date.localeCompare(a.date) || a.vendor.localeCompare(b.vendor));
  const incomeLedger = payments.map((p) => ({
    date: _acctDay(p.payment_date), customer: _acctCust(p.customer), job: (p.job && p.job.job_number) || "",
    invoice: (p.invoice && p.invoice.invoice_number) || "", method: p.method || "", ref: p.reference_number || "", amount: _acctNum(p.amount),
  })).sort((a, b) => b.date.localeCompare(a.date));
  const invoiceLedger = invoices.map((i) => ({
    date: _acctDay(i.issue_date), invoice: i.invoice_number || "", customer: _acctCust(i.customer),
    job: (i.job && i.job.job_number) || "", status: i.status || "", total: invTotal(i), paid: _acctNum(i.amountPaid),
    due: _acctRound(Math.max(0, invTotal(i) - _acctNum(i.amountPaid))),
  })).sort((a, b) => b.date.localeCompare(a.date));

  return {
    period, rate,
    revenue: { cash: cashRevenue, accrual: accrualRevenue, arOutstanding, paymentCount: payments.length, invoiceCount: invoices.length },
    cogs, opex, cogsTotal, opexTotal, gross, net, salesTaxPaid,
    // Round 107: where the total cost comes from, so the card ties to the Receipts page tiles
    costBySource: (() => { const o = { receipts: 0, expenses: 0, mileage: 0 }; costs.forEach((c) => { o[c.source === "Receipt" ? "receipts" : c.source === "Expense" ? "expenses" : "mileage"] += c.amount; }); Object.keys(o).forEach((k) => { o[k] = _acctRound(o[k]); }); return o; })(),
    tax: { form1065, otherDeductions, mealsFull, mealsNonDeductible, totalDeductions: totalDeductionsTax, taxable },
    mileage: { miles, amount: mileageAmount, rate, trips: logs.length, byTech: mileageByTech },
    months, costs, incomeLedger, invoiceLedger, nec, salesTaxSummary, projects, projectTotals,
    attention: {
      noAmount, needsReview, excluded, noTaxCat, noTaxCatAmount: _acctRound(noTaxCatAmount),
      draftInvoices: { count: draftInvoices.length, amount: _acctRound(draftInvoices.reduce((s, i) => s + invTotal(i), 0)) },
    },
  };
}
