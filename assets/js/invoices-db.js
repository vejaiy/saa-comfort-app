/* ============================================================
   SAA Comfort Air LLC — global Invoices list (employee/invoices.html)
   Round 37 follow-up (2026-09-17), per Vijayan: "invoice and payments in
   dashboard to show invoice list and payment lists in separate pages when
   clicked" -- until now an invoice only ever existed inside its own job's
   Job Card (jbRenderInvoiceBox in jobs.js); there was no way to see every
   invoice across every job at once. Requires jobs-db.js to already be
   loaded -- reuses saaJobsInvoiceTotalDue/saaJobsPaymentStatus so this
   list's Total Due/Payment Status math can never drift from what the Job
   Card and the Jobs Master List already show for the same invoice.
   ============================================================ */

/** filters: { status, paymentStatus, search } — all optional.
 *  Returns invoices newest-first, each augmented with its job, customer,
 *  amountPaid, totalDue, and derived paymentStatus. */
async function saaInvoicesFetchAll(filters) {
  filters = filters || {};
  const { data: invoices, error: e1 } = await _saaClient
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });
  if (e1) throw e1;
  if (!invoices || !invoices.length) return [];

  const jobIds = [...new Set(invoices.map((i) => i.job_id).filter(Boolean))];
  const custIds = [...new Set(invoices.map((i) => i.customer_id).filter(Boolean))];
  const invoiceIds = invoices.map((i) => i.id);

  const [{ data: jobs }, { data: customers }, { data: payments }] = await Promise.all([
    jobIds.length ? _saaClient.from("jobs").select("id,job_number,job_type,title").in("id", jobIds) : { data: [] },
    custIds.length ? _saaClient.from("customers").select("id,first_name,last_name,phone").in("id", custIds) : { data: [] },
    invoiceIds.length ? _saaClient.from("payments").select("invoice_id,amount").in("invoice_id", invoiceIds) : { data: [] },
  ]);

  const jobById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const paidByInvoice = {};
  const hasPaymentByInvoice = {};
  (payments || []).forEach((p) => {
    paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount || 0);
    hasPaymentByInvoice[p.invoice_id] = true;
  });

  let rows = invoices.map((inv) => {
    const amountPaid = paidByInvoice[inv.id] || 0;
    const hasPayment = !!hasPaymentByInvoice[inv.id];
    return Object.assign({}, inv, {
      job: jobById[inv.job_id] || null,
      customer: custById[inv.customer_id] || null,
      amountPaid,
      totalDue: saaJobsInvoiceTotalDue(inv),
      paymentStatus: saaJobsPaymentStatus(inv, amountPaid, hasPayment),
    });
  });

  if (filters.status) rows = rows.filter((r) => r.status === filters.status);
  if (filters.paymentStatus) rows = rows.filter((r) => r.paymentStatus === filters.paymentStatus);
  if (filters.search) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter((r) => {
      const custName = r.customer ? `${r.customer.first_name || ""} ${r.customer.last_name || ""}`.toLowerCase() : "";
      return (r.invoice_number || "").toLowerCase().includes(q)
        || (r.job && (r.job.job_number || "").toLowerCase().includes(q))
        || custName.includes(q)
        || (r.customer && String(r.customer.phone || "").includes(q));
    });
  }
  return rows;
}
