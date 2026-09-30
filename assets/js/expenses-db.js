/* ============================================================
   SAA Comfort Air LLC — Expenses data layer (Round 76, 2026-09-30)
   Backs the Expenses tab on the Receipts page. Per Vijayan: "Add a section
   to record expenses. expenses for SAA, for project, for tools, etc. it can
   be food, travel, subcontract, advisory etc."

   One row per expense in public.expenses: date, payee, description,
   category, who it applies to (SAA in general / a Job-project / Tools),
   amount, how it was paid + by whom, reimbursable / reimbursed, tax
   deductible + tax category, and any receipt photos / PDFs. Attachments live
   in the private "receipt-files" Storage bucket under expenses/<id>/... and
   are opened through short-lived signed URLs.
   Requires auth.js (shared _saaClient).
   ============================================================ */

const SAA_EXPENSE_BUCKET = "receipt-files";

const SAA_EXPENSE_DEFAULT_CATEGORIES = ["Food & meals", "Travel", "Subcontract / labor", "Advisory & professional"];
const SAA_EXPENSE_SCOPES = [
  { value: "saa", label: "SAA (general)" },
  { value: "job", label: "Job / project" },
  { value: "tools", label: "Tools" },
];
const SAA_EXPENSE_PAYMENT_METHODS = ["Credit card", "Debit card", "Cash", "Check", "Bank transfer / Zelle", "Other"];
const SAA_EXPENSE_COMPANY_PAYER = "SAA (company card / account)";
const SAA_EXPENSE_OWNER_PAYER = "Vijayan (personal)";
const SAA_EXPENSE_TAX_CATEGORIES = [
  "Meals (50% deductible)", "Travel", "Contract labor", "Professional fees", "Tools & equipment",
  "Supplies", "Vehicle & fuel", "Advertising", "Other",
];
// Suggested tax category when a category is picked and none is chosen yet.
const SAA_EXPENSE_TAX_DEFAULTS = {
  "Food & meals": "Meals (50% deductible)",
  "Travel": "Travel",
  "Subcontract / labor": "Contract labor",
  "Advisory & professional": "Professional fees",
};

function saaExpenseScopeLabel(scope) {
  const s = SAA_EXPENSE_SCOPES.find((x) => x.value === scope);
  return s ? s.label : (scope || "");
}

/* ---- Reads ---- */

async function saaExpensesFetchAll() {
  const { data, error } = await _saaClient.from("expenses").select("*").order("expense_date", { ascending: false });
  if (error) { console.error(error); return []; }
  return data || [];
}

async function saaExpensesFetchPayers() {
  const { data, error } = await _saaClient.from("technicians").select("id, name, active").order("name");
  if (error) { console.error(error); return []; }
  return (data || []).filter((t) => t.active !== false).map((t) => t.name).filter(Boolean);
}

/* ---- Writes ---- */

function _saaExpenseClean(f) {
  const str = (v) => { const s = (v == null ? "" : String(v)).trim(); return s || null; };
  const out = {
    expense_date: f.expense_date,
    vendor: str(f.vendor),
    description: str(f.description),
    category: str(f.category),
    scope: f.scope || "saa",
    job_id: f.scope === "job" ? (f.job_id || null) : null,
    customer_id: f.scope === "job" ? (f.customer_id || null) : null,
    amount: Number(f.amount),
    payment_method: str(f.payment_method),
    paid_by: str(f.paid_by),
    reimbursable: !!f.reimbursable,
    reimbursed: !!f.reimbursable && !!f.reimbursed,
    reimbursed_on: (!!f.reimbursable && !!f.reimbursed) ? (f.reimbursed_on || null) : null,
    tax_deductible: f.tax_deductible !== false,
    tax_category: f.tax_deductible === false ? null : str(f.tax_category),
    notes: str(f.notes),
  };
  if (f.file_paths) out.file_paths = f.file_paths;
  return out;
}

/** Insert (id falsy) or update one expense. Returns { ok, expense } or { ok:false, error }. */
async function saaExpenseSave(id, fields) {
  try {
    const row = _saaExpenseClean(fields);
    if (!row.expense_date) throw new Error("Pick the date.");
    if (!row.category) throw new Error("Pick a category.");
    if (!isFinite(row.amount)) throw new Error("Enter the amount.");
    if (row.scope === "job" && !row.job_id) throw new Error("Pick the job / project this expense belongs to.");
    let res;
    if (id) {
      row.updated_at = new Date().toISOString();
      res = await _saaClient.from("expenses").update(row).eq("id", id).select("*").single();
    } else {
      res = await _saaClient.from("expenses").insert(row).select("*").single();
    }
    if (res.error) throw res.error;
    return { ok: true, expense: res.data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Deletes the expense row and its attached files. */
async function saaExpenseDelete(expense) {
  try {
    const paths = (expense && expense.file_paths) || [];
    if (paths.length) await _saaClient.storage.from(SAA_EXPENSE_BUCKET).remove(paths);
    const { error } = await _saaClient.from("expenses").delete().eq("id", expense.id);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function _saaExpenseExt(file) {
  const t = (file.type || "").toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  if (t === "image/heic" || t === "image/heif") return "heic";
  const m = (file.name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : "jpg";
}

/** Uploads picked files for one expense; returns { paths, errors }. */
async function saaExpenseUploadFiles(expenseId, files) {
  const paths = [], errors = [];
  for (const file of files) {
    const path = `expenses/${expenseId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${_saaExpenseExt(file)}`;
    const { error } = await _saaClient.storage.from(SAA_EXPENSE_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (error) errors.push((file.name || "file") + ": " + error.message); else paths.push(path);
  }
  return { paths, errors };
}

async function saaExpenseRemoveFiles(paths) {
  if (!paths || !paths.length) return;
  await _saaClient.storage.from(SAA_EXPENSE_BUCKET).remove(paths);
}

/** A 1-hour link to a private attachment (null if it can't be made). */
async function saaExpenseSignedUrl(path) {
  const { data, error } = await _saaClient.storage.from(SAA_EXPENSE_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) { console.error(error); return null; }
  return data.signedUrl;
}

/* ---- Pure helpers ---- */

function saaExpenseMonthKey(e) { return (e.expense_date || "").slice(0, 7); }

/** 'YYYY-MM-DD' (a plain date, no timezone) -> local Date. */
function saaExpenseDateObj(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** Amount still owed back to whoever paid personally. */
function saaExpenseOwed(e) { return e.reimbursable && !e.reimbursed ? Number(e.amount) || 0 : 0; }

/** filters: { period: all|this_month|last_month|this_year, category, scope, owedOnly, search, jobLabel(fn) } */
function saaExpensesFilter(rows, f) {
  f = f || {};
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = ym(now);
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = ym(last);
  const q = (f.search || "").trim().toLowerCase();
  return rows.filter((e) => {
    if (f.period === "this_month" && saaExpenseMonthKey(e) !== thisMonth) return false;
    if (f.period === "last_month" && saaExpenseMonthKey(e) !== lastMonth) return false;
    if (f.period === "this_year" && (e.expense_date || "").slice(0, 4) !== String(now.getFullYear())) return false;
    if (f.category && e.category !== f.category) return false;
    if (f.scope && e.scope !== f.scope) return false;
    if (f.owedOnly && !saaExpenseOwed(e)) return false;
    if (q) {
      const hay = [e.vendor, e.description, e.category, e.paid_by, e.payment_method, e.notes, e.tax_category,
        saaExpenseScopeLabel(e.scope), f.jobLabel ? f.jobLabel(e) : ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function saaExpensesSummary(rows) {
  const s = { total: 0, count: rows.length, byScope: { saa: 0, job: 0, tools: 0 }, owed: 0, owedCount: 0, deductible: 0 };
  rows.forEach((e) => {
    const a = Number(e.amount) || 0;
    s.total += a;
    s.byScope[e.scope] = (s.byScope[e.scope] || 0) + a;
    if (saaExpenseOwed(e)) { s.owed += a; s.owedCount += 1; }
    if (e.tax_deductible) s.deductible += a;
  });
  return s;
}

// [{ category, count, total }], highest total first
function saaExpensesByCategory(rows) {
  const groups = {};
  rows.forEach((e) => {
    const key = e.category || "Uncategorized";
    const g = groups[key] || (groups[key] = { category: key, count: 0, total: 0 });
    g.count += 1;
    g.total += Number(e.amount) || 0;
  });
  return Object.values(groups).sort((a, b) => b.total - a.total);
}

// { key, label, rows }, newest month first
function saaExpensesGroupByMonth(rows) {
  const groups = {};
  rows.forEach((e) => { (groups[saaExpenseMonthKey(e)] = groups[saaExpenseMonthKey(e)] || []).push(e); });
  return Object.keys(groups).sort().reverse().map((key) => ({ key, label: saaReceiptMonthLabel(key), rows: groups[key] }));
}
