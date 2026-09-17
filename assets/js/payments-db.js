/* ============================================================
   SAA Comfort Air LLC — global Payments list (employee/payments.html)
   Round 37 follow-up (2026-09-17), companion to invoices-db.js — same
   "there was no cross-job view of this" gap, for money actually received
   rather than invoices raised. Requires jobs-db.js to already be loaded.
   ============================================================ */

/** filters: { search, dateFrom, dateTo } — all optional.
 *  Returns payments newest-first, each augmented with its invoice, job,
 *  and customer. */
async function saaPaymentsFetchAll(filters) {
  filters = filters || {};
  let query = _saaClient.from("payments").select("*").order("payment_date", { ascending: false });
  if (filters.dateFrom) query = query.gte("payment_date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("payment_date", filters.dateTo);
  const { data: payments, error: e1 } = await query;
  if (e1) throw e1;
  if (!payments || !payments.length) return [];

  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id).filter(Boolean))];
  const custIds = [...new Set(payments.map((p) => p.customer_id).filter(Boolean))];

  const [{ data: invoices }, { data: customers }] = await Promise.all([
    invoiceIds.length ? _saaClient.from("invoices").select("id,invoice_number,job_id").in("id", invoiceIds) : { data: [] },
    custIds.length ? _saaClient.from("customers").select("id,first_name,last_name,phone").in("id", custIds) : { data: [] },
  ]);
  const invoiceById = Object.fromEntries((invoices || []).map((i) => [i.id, i]));
  const jobIds = [...new Set((invoices || []).map((i) => i.job_id).filter(Boolean))];
  const { data: jobs } = jobIds.length
    ? await _saaClient.from("jobs").select("id,job_number,job_type,title").in("id", jobIds)
    : { data: [] };
  const jobById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));

  let rows = payments.map((p) => {
    const invoice = invoiceById[p.invoice_id] || null;
    return Object.assign({}, p, {
      invoice,
      job: invoice ? jobById[invoice.job_id] || null : null,
      customer: custById[p.customer_id] || null,
    });
  });

  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) => {
      const custName = r.customer ? `${r.customer.first_name || ""} ${r.customer.last_name || ""}`.toLowerCase() : "";
      return (r.invoice && (r.invoice.invoice_number || "").toLowerCase().includes(q))
        || (r.job && (r.job.job_number || "").toLowerCase().includes(q))
        || custName.includes(q)
        || (r.customer && String(r.customer.phone || "").includes(q))
        || (r.reference_number || "").toLowerCase().includes(q);
    });
  }
  return rows;
}
