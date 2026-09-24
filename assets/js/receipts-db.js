/* ============================================================
   SAA Comfort Air LLC — Receipts data layer
   Backs the employee Receipts page (receipts.html). One table:

   - receipts: one row per receipt email pulled from Gmail
     (saacomfortair@gmail.com — Inbox + the "Receipts" label),
     bucketed into equipment / tools / supplies, auto-categorized
     and auto-tagged to a job/customer where the email made that
     clear (vendor/subject keywords, "for <customer>'s job"
     phrasing). auto_tagged=true means nobody has confirmed the
     bucket/category/project yet — the Receipts page lets the
     office fix any of those fields inline, which clears the flag.

     Receipt files themselves are NOT stored (Gmail attachment
     bytes aren't reachable from this pipeline) — gmail_view_url
     opens the original email so the actual receipt/photo can be
     viewed there.

   Requires auth.js to have already created the shared _saaClient.
   ============================================================ */

const SAA_RECEIPT_BUCKETS = ["equipment", "tools", "supplies"];

/* ---- Reads ---- */

async function saaReceiptsFetchAll({ bucket, search, dateFrom, dateTo } = {}) {
  let query = _saaClient.from("receipts").select("*");
  if (bucket) query = query.eq("bucket", bucket);
  if (dateFrom) query = query.gte("received_at", dateFrom);
  if (dateTo) query = query.lte("received_at", dateTo);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  let rows = data || [];

  // Hydrate job/customer display labels without a heavy join —
  // pull the small set of jobs/customers actually referenced.
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];
  const customerIds = [...new Set(rows.map((r) => r.customer_id).filter(Boolean))];
  const [jobsRes, customersRes] = await Promise.all([
    jobIds.length ? _saaClient.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] }),
    customerIds.length ? _saaClient.from("customers").select("id, first_name, last_name").in("id", customerIds) : Promise.resolve({ data: [] }),
  ]);
  const jobById = Object.fromEntries((jobsRes.data || []).map((j) => [j.id, j]));
  const customerById = Object.fromEntries((customersRes.data || []).map((c) => [c.id, c]));
  rows = rows.map((r) => Object.assign({}, r, {
    job: r.job_id ? jobById[r.job_id] || null : null,
    customer: r.customer_id ? customerById[r.customer_id] || null : null,
  }));

  const q = (search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.vendor, r.subject, r.category, r.item_description, r.project_label, r.notes,
        r.job && r.job.job_number, r.customer && (r.customer.first_name + " " + r.customer.last_name)]
        .some((s) => (s || "").toLowerCase().includes(q))
    );
  }
  return rows.sort((a, b) => (b.received_at || "").localeCompare(a.received_at || ""));
}

async function saaReceiptsFetchJobPickerOptions() {
  const [{ data: jobs, error: e1 }, { data: customers, error: e2 }] = await Promise.all([
    _saaClient.from("jobs").select("id, job_number, customer_id").order("job_number"),
    _saaClient.from("customers").select("id, first_name, last_name"),
  ]);
  if (e1) console.error(e1);
  if (e2) console.error(e2);
  const customerById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  return (jobs || []).map((j) => {
    const c = customerById[j.customer_id];
    return { job_id: j.id, customer_id: j.customer_id, label: j.job_number + (c ? " — " + c.first_name + " " + c.last_name : "") };
  });
}

/* ---- Writes ---- */

async function saaReceiptUpdate(id, patch) {
  const clean = {};
  ["bucket", "category", "item_description", "vendor", "notes", "project_label"].forEach((k) => {
    if (k in patch) clean[k] = patch[k] === "" ? null : patch[k];
  });
  if ("amount_total" in patch) clean.amount_total = patch.amount_total === "" || patch.amount_total == null ? null : Number(patch.amount_total);
  if ("job_id" in patch) clean.job_id = patch.job_id || null;
  if ("customer_id" in patch) clean.customer_id = patch.customer_id || null;
  clean.auto_tagged = false; // a human touched this row — no longer just a best guess
  clean.updated_at = new Date().toISOString();
  const { data, error } = await _saaClient.from("receipts").update(clean).eq("id", id).select().maybeSingle();
  if (error) { console.error(error); return { error: error.message || "Could not save." }; }
  return { data };
}

/* ---- Grouping / summary helpers (pure functions, no DB access) ---- */

function saaReceiptMonthKey(r) {
  return (r.received_at || "").slice(0, 7); // "YYYY-MM"
}

function saaReceiptMonthLabel(key) {
  if (!key) return "Unknown";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// { "2026-09": [rows...], "2026-08": [rows...] }, newest month first
function saaReceiptsGroupByMonth(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = saaReceiptMonthKey(r);
    (groups[key] = groups[key] || []).push(r);
  });
  return Object.keys(groups).sort().reverse().map((key) => ({ key, label: saaReceiptMonthLabel(key), rows: groups[key] }));
}

function saaReceiptsSummary(rows) {
  const byBucket = {};
  SAA_RECEIPT_BUCKETS.forEach((b) => (byBucket[b] = { count: 0, total: 0 }));
  rows.forEach((r) => {
    const b = byBucket[r.bucket] || (byBucket[r.bucket] = { count: 0, total: 0 });
    b.count += 1;
    b.total += Number(r.amount_total || 0);
  });
  const grandTotal = rows.reduce((sum, r) => sum + Number(r.amount_total || 0), 0);
  const needsReview = rows.filter((r) => r.auto_tagged).length;
  return { byBucket, grandTotal, count: rows.length, needsReview };
}

// [{ category, count, total }], highest total first
function saaReceiptsByCategory(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = r.category || "Uncategorized";
    const g = groups[key] || (groups[key] = { category: key, count: 0, total: 0 });
    g.count += 1;
    g.total += Number(r.amount_total || 0);
  });
  return Object.values(groups).sort((a, b) => b.total - a.total);
}

// [{ label, job_id, customer_id, count, total }], highest total first.
// "project" here means: a linked job, else a linked customer, else the
// generic SAA - Tools/Supplies/Equipment bucket project_label.
function saaReceiptsByProject(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = r.job_id || r.customer_id || r.project_label || "Unassigned";
    const label = (r.job && r.job.job_number) || (r.customer && (r.customer.first_name + " " + r.customer.last_name)) || r.project_label || "Unassigned";
    const g = groups[key] || (groups[key] = { label, job_id: r.job_id || null, customer_id: r.customer_id || null, count: 0, total: 0 });
    g.count += 1;
    g.total += Number(r.amount_total || 0);
  });
  return Object.values(groups).sort((a, b) => b.total - a.total);
}
