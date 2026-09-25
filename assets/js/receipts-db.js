/* ============================================================
   SAA Comfort Air LLC — Receipts data layer
   Backs the employee Receipts page (receipts.html). Two tables:

   - receipts: one row per receipt email pulled from Gmail
     (saacomfortair@gmail.com — Inbox + the "Receipts" label) --
     vendor, date, store, payment method, receipt #, and the
     receipt's own total/tax (for display + reconciliation).
     Receipt files themselves are NOT stored (Gmail attachment
     bytes aren't reachable from this pipeline) -- gmail_view_url
     opens the original email so the actual receipt/photo can be
     viewed there.

   - receipt_line_items: one row per line item on a receipt.
     A single receipt can hold many lines, each independently
     bucketed (Receipts / Tools / Supplies), categorized, and
     job-linked -- e.g. one Daikin invoice where most lines are
     job materials and a few are reassigned to SAA-Tools shop
     stock. auto_tagged=true means nobody has confirmed this
     line yet -- editing it clears the flag.

   Round 50 (2026-09-24): split out of the old single-table
   "receipts" schema so line-item detail (what Vijayan asked for)
   can live under three bucket buttons, with Summary / By Category
   / By Job on the page's main/landing view.

   Requires auth.js to have already created the shared _saaClient.
   ============================================================ */

const SAA_RECEIPT_BUCKETS = ["receipts", "tools", "supplies"];

/* ---- Reads ---- */

// Every line item, each carrying its parent receipt's fields flattened on
// (r_vendor, r_subject, r_received_at, r_gmail_view_url, r_store_location,
// r_payment_method, r_receipt_number, r_receipt_total, r_sales_tax_total,
// r_notes) plus hydrated job/customer display objects.
async function saaLineItemsFetchAll({ bucket, search } = {}) {
  let query = _saaClient.from("receipt_line_items").select("*");
  if (bucket) query = query.eq("bucket", bucket);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  let rows = data || [];

  // Hydrate the parent receipt's fields without a heavy join -- pull the
  // small set of receipts actually referenced (same pattern as the
  // job/customer hydration below).
  const receiptIds = [...new Set(rows.map((r) => r.receipt_id).filter(Boolean))];
  const receiptsRes = receiptIds.length
    ? await _saaClient.from("receipts").select("*").in("id", receiptIds)
    : { data: [] };
  const receiptById = Object.fromEntries((receiptsRes.data || []).map((r) => [r.id, r]));
  rows = rows.map((li) => {
    const r = receiptById[li.receipt_id] || {};
    return Object.assign({}, li, {
      r_vendor: r.vendor, r_subject: r.subject, r_received_at: r.received_at,
      r_gmail_view_url: r.gmail_view_url, r_store_location: r.store_location,
      r_payment_method: r.payment_method, r_receipt_number: r.receipt_number,
      r_receipt_total: r.receipt_total, r_sales_tax_total: r.sales_tax_total,
      r_notes: r.notes,
    });
  });

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
      [r.r_vendor, r.r_subject, r.category, r.item_description, r.project_label, r.notes, r.r_receipt_number,
        r.job && r.job.job_number, r.customer && (r.customer.first_name + " " + r.customer.last_name)]
        .some((s) => (s || "").toLowerCase().includes(q))
    );
  }
  return rows.sort((a, b) => (b.r_received_at || "").localeCompare(a.r_received_at || ""));
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

async function saaLineItemUpdate(id, patch) {
  const clean = {};
  ["bucket", "category", "item_description", "notes", "project_label"].forEach((k) => {
    if (k in patch) clean[k] = patch[k] === "" ? null : patch[k];
  });
  if ("item_total" in patch) clean.item_total = patch.item_total === "" || patch.item_total == null ? null : Number(patch.item_total);
  if ("sales_tax" in patch) clean.sales_tax = patch.sales_tax === "" || patch.sales_tax == null ? null : Number(patch.sales_tax);
  if ("job_id" in patch) clean.job_id = patch.job_id || null;
  if ("customer_id" in patch) clean.customer_id = patch.customer_id || null;
  clean.auto_tagged = false; // a human touched this row -- no longer just a best guess
  clean.updated_at = new Date().toISOString();
  const { data, error } = await _saaClient.from("receipt_line_items").update(clean).eq("id", id).select().maybeSingle();
  if (error) { console.error(error); return { error: error.message || "Could not save." }; }
  return { data };
}

/* ---- Grouping / summary helpers (pure functions, no DB access) ---- */

// Tax-inclusive line total -- null when the amount hasn't been read yet
// (a photo receipt pending manual entry).
function saaLineTotal(li) {
  if (li.item_total == null) return null;
  return Number(li.item_total) + Number(li.sales_tax || 0);
}

function saaReceiptMonthKey(li) {
  return (li.r_received_at || "").slice(0, 7); // "YYYY-MM"
}

function saaReceiptMonthLabel(key) {
  if (!key) return "Unknown";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// { key, label, rows: [line items] }, newest month first
function saaReceiptsGroupByMonth(rows) {
  const groups = {};
  rows.forEach((r) => {
    const key = saaReceiptMonthKey(r);
    (groups[key] = groups[key] || []).push(r);
  });
  return Object.keys(groups).sort().reverse().map((key) => ({ key, label: saaReceiptMonthLabel(key), rows: groups[key] }));
}

// Within one month's line items, group by parent receipt (so a 22-line
// Daikin invoice reads as one card, not 22 flat rows). Newest receipt first.
function saaGroupByReceipt(rows) {
  const groups = {};
  const order = [];
  rows.forEach((li) => {
    if (!groups[li.receipt_id]) { groups[li.receipt_id] = []; order.push(li.receipt_id); }
    groups[li.receipt_id].push(li);
  });
  return order
    .map((id) => ({ receipt_id: id, lines: groups[id].sort((a, b) => (a.line_number || 0) - (b.line_number || 0)) }))
    .sort((a, b) => (b.lines[0].r_received_at || "").localeCompare(a.lines[0].r_received_at || ""));
}

function saaReceiptsSummary(rows) {
  const byBucket = {};
  SAA_RECEIPT_BUCKETS.forEach((b) => (byBucket[b] = { count: 0, total: 0 }));
  rows.forEach((r) => {
    const b = byBucket[r.bucket] || (byBucket[r.bucket] = { count: 0, total: 0 });
    b.count += 1;
    b.total += saaLineTotal(r) || 0;
  });
  const grandTotal = rows.reduce((sum, r) => sum + (saaLineTotal(r) || 0), 0);
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
    g.total += saaLineTotal(r) || 0;
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
    g.total += saaLineTotal(r) || 0;
  });
  return Object.values(groups).sort((a, b) => b.total - a.total);
}
