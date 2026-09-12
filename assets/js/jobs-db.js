/* ============================================================
   SAA Comfort Air LLC — Jobs Master List data layer
   Backs employee/jobs.html: the office-facing record of every job
   from intake through completion, cost, and payment — customer,
   equipment, diagnosis, quote link, actual cost, invoice, and
   payments all in one place. Requires auth.js to have already
   created the shared _saaClient.

   Design notes:
   - Same flat-fetch-then-stitch-in-JS pattern as calendar-db.js and
     quotes-db.js (easier to unit-test/mock than nested selects).
   - A Job here is the same `jobs` row the Dispatch Calendar uses —
     this page and the calendar both read/write one table, so a job
     created on either page shows up on both. Creating a job here
     also creates a matching `appointments` row with no start time,
     which is exactly what already makes a job show up in the
     calendar's "Unscheduled Jobs" queue — no extra plumbing needed,
     it falls out of the existing schema.
   - Equipment (brand/model/serial/refrigerant/etc.) lives on the
     `equipment` table keyed by customer, not by job — it describes
     what's installed at that customer's property, which is a
     customer-level fact, not a per-job one. Saving equipment from a
     Job Card updates that customer's most recent equipment row (or
     creates their first one).
   - Actual Material/Labor/Other cost are plain numbers typed in by
     the office after the job is done (real receipts aren't
     something the app can look up) — Quoted Amount is the one cost
     figure that auto-fills, from a linked saved quote. Total Actual
     Cost / Gross Profit / Gross Margin % are never stored; they're
     computed live in jobs.js from whatever's on screen so they can
     never drift out of sync with the fields they're derived from.
   ============================================================ */

/** Every job_type value the `jobs` table accepts, with a display label —
 *  covers both the Dispatch Calendar's quick-dispatch types and the
 *  Jobs List's own broader categories, so a job created on either page
 *  always has a readable type label on the other. */
const SAA_JOB_TYPE_LABELS = {
  new_install: "New Installation",
  replacement: "Complete System Replacement",
  condenser_change: "Condenser Replacement",
  coil_change: "Coil Replacement",
  furnace_change: "Furnace Replacement",
  plenum_change: "Plenum Change",
  drainline_maintenance: "Drainline Maintenance",
  duct_cleaning: "Duct Cleaning",
  inspection: "Inspection",
  maintenance_visit: "Preventive Maintenance",
  custom: "Other",
  electrical_repair: "Electrical Repair",
  service_call: "Service Call",
  repair: "Repair",
  diagnostic: "Diagnostic / Repair",
  tune_up: "Tune-Up",
  estimate: "Estimate",
  manual_j: "Manual J",
  installation: "Installation",
  follow_up: "Follow-Up",
  return_visit: "Return Visit",
  emergency: "Emergency",
};

/** The curated set offered on the Jobs List's own "Job Type" field —
 *  matches Vijayan's spec exactly, each mapped to an existing job_type key. */
const SAA_JOBS_TYPE_OPTIONS_CURATED = [
  ["diagnostic", "Diagnostic / Repair"],
  ["maintenance_visit", "Preventive Maintenance"],
  ["condenser_change", "Condenser Replacement"],
  ["coil_change", "Coil Replacement"],
  ["furnace_change", "Furnace Replacement"],
  ["replacement", "Complete System Replacement"],
  ["drainline_maintenance", "Drainline Maintenance"],
  ["electrical_repair", "Electrical Repair"],
  ["custom", "Other"],
];

/** Full type list (curated set first, then every other job_type key) —
 *  used everywhere a job's *actual* type has to reliably round-trip:
 *  the Job Card's own Job Type field, the filter dropdown, and the New
 *  Job form when it's pre-filled by converting a saved quote (a quote's
 *  quote_type is one of the New Install/Replacement/etc. worksheet keys,
 *  which are already in the curated 9 — but a job created from the
 *  Dispatch Calendar can carry one of the calendar's own quick-dispatch
 *  types, like "service_call" or "tune_up", that aren't in the curated
 *  list. Without this fallback, opening that job's Job Card would show
 *  the select defaulting to its first option and silently rewrite the
 *  job's type on save. */
const SAA_JOBS_TYPE_OPTIONS = SAA_JOBS_TYPE_OPTIONS_CURATED.concat(
  Object.keys(SAA_JOB_TYPE_LABELS)
    .filter((k) => !SAA_JOBS_TYPE_OPTIONS_CURATED.some(([v]) => v === k))
    .map((k) => [k, SAA_JOB_TYPE_LABELS[k]])
);

const SAA_JOBS_STATUS_OPTIONS = [
  ["new", "New"],
  ["assigned", "Assigned"],
  ["scheduled", "Scheduled"],
  ["in_progress", "In Progress"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

const SAA_JOBS_PRIORITY_OPTIONS = [
  ["low", "Low"],
  ["normal", "Normal"],
  ["high", "High"],
  ["emergency", "Emergency"],
];

/** Invoice document status (separate from Payment Status, which is
 *  derived from money actually received — see saaJobsPaymentStatus). */
const SAA_INVOICE_STATUS_OPTIONS = [
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["paid", "Paid"],
  ["void", "Void"],
];

function saaJobTypeLabel(key) {
  return SAA_JOB_TYPE_LABELS[key] || key || "—";
}

async function saaJobsFetchTechnicians() {
  const { data, error } = await _saaClient
    .from("technicians")
    .select("id,name,active")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data || [];
}

/** Fast customer search for the New Job form — matches any one of
 *  first name / last name / phone (partial, case-insensitive). */
async function saaJobsSearchCustomers(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];
  const { data, error } = await _saaClient
    .from("customers")
    .select("id,first_name,last_name,phone,email,billing_address,billing_city,billing_zip")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(8);
  if (error) throw error;
  return data || [];
}

/** Find-or-create a customer by exact first+last+phone — same rule
 *  quotes-db.js and calendar-db.js use, so a customer created from any
 *  of the three pages lands as one row. Duplicated here rather than
 *  shared since jobs.html doesn't load those files. */
async function saaJobsFindOrCreateCustomer({ firstName, lastName, phone, email, address, city, zip }) {
  const { data: existing, error: findErr } = await _saaClient
    .from("customers")
    .select("id")
    .eq("first_name", firstName || "")
    .eq("last_name", lastName || "")
    .eq("phone", phone || "")
    .limit(1);
  if (findErr) throw findErr;
  if (existing && existing.length) return existing[0].id;

  const { data: created, error: createErr } = await _saaClient
    .from("customers")
    .insert({
      first_name: firstName || null,
      last_name: lastName || null,
      phone: phone || null,
      email: email || null,
      billing_address: address || null,
      billing_city: city || null,
      billing_zip: zip || null,
    })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return created.id;
}

/** Loads every job, hydrated with customer, technician, linked quote,
 *  most recent invoice, and that invoice's payments — everything the
 *  Jobs List table and its filters need in one round trip. */
async function saaJobsFetchAll() {
  const [{ data: jobs, error: e1 }, { data: customers, error: e2 }, { data: technicians, error: e3 }] =
    await Promise.all([
      _saaClient.from("jobs").select("*").order("created_at", { ascending: false }),
      _saaClient.from("customers").select("id,first_name,last_name,phone,email,billing_address,billing_city,billing_zip"),
      _saaClient.from("technicians").select("id,name"),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const jobIds = (jobs || []).map((j) => j.id);
  const quoteIds = [...new Set((jobs || []).map((j) => j.linked_quote_id).filter(Boolean))];

  const [{ data: invoices, error: e4 }, { data: quotes, error: e5 }] = await Promise.all([
    jobIds.length
      ? _saaClient.from("invoices").select("*").in("job_id", jobIds).order("created_at", { ascending: false })
      : { data: [], error: null },
    quoteIds.length
      ? _saaClient.from("quotes").select("id,quote_number,quote_type,total").in("id", quoteIds)
      : { data: [], error: null },
  ]);
  if (e4) throw e4;
  if (e5) throw e5;

  const invoiceIds = (invoices || []).map((i) => i.id);
  const { data: payments, error: e6 } = invoiceIds.length
    ? await _saaClient.from("payments").select("invoice_id,amount").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  if (e6) throw e6;

  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));
  const quoteById = Object.fromEntries((quotes || []).map((q) => [q.id, q]));
  const paidByInvoice = {};
  (payments || []).forEach((p) => { paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount || 0); });

  // most-recent invoice per job (invoices already ordered desc by created_at)
  const invoiceByJob = {};
  (invoices || []).forEach((inv) => { if (!invoiceByJob[inv.job_id]) invoiceByJob[inv.job_id] = inv; });

  return (jobs || []).map((j) => {
    const invoice = invoiceByJob[j.id] || null;
    const paid = invoice ? paidByInvoice[invoice.id] || 0 : 0;
    return Object.assign({}, j, {
      customer: custById[j.customer_id] || null,
      technician: techById[j.assigned_technician_id] || null,
      linkedQuote: j.linked_quote_id ? quoteById[j.linked_quote_id] || null : null,
      invoice,
      amountPaid: paid,
      paymentStatus: saaJobsPaymentStatus(invoice, paid),
    });
  });
}

/** Unpaid / Partially Paid / Paid — derived from money actually
 *  received against the job's invoice, independent of the invoice
 *  document's own Draft/Sent/Paid/Void lifecycle. */
function saaJobsPaymentStatus(invoice, amountPaid) {
  const total = invoice ? Number(invoice.amount_total || 0) : 0;
  if (!invoice || total <= 0) return amountPaid > 0 ? "partial" : "unpaid";
  if (amountPaid >= total) return "paid";
  if (amountPaid > 0) return "partial";
  return "unpaid";
}

/** Every appointment type's default duration, used to size the block a
 *  job takes up on the Dispatch Calendar grid when it's scheduled
 *  straight from the Jobs List (duplicated from calendar-db.js's own
 *  fetch — see file header on why these data-layer files don't share
 *  code). Falls back to 60 minutes for a job_type with no matching
 *  appointment_types row (most of the Jobs List's own curated types
 *  are worksheet/quote categories, not quick-dispatch ones). */
async function saaJobsFetchAppointmentTypes() {
  const { data, error } = await _saaClient.from("appointment_types").select("key,default_duration_minutes");
  if (error) throw error;
  return Object.fromEntries((data || []).map((t) => [t.key, t.default_duration_minutes]));
}

/* ---- naive wall-clock time strings, same convention calendar.js uses:
   build "<date>T<HH>:<MM>:00" directly, never round-trip through
   new Date().toISOString(), so what the office picks is exactly what
   redisplays with no timezone-conversion surprises. ---- */
function _saaJobsTimeStr(dateStr, hhmm) {
  return `${dateStr}T${hhmm}:00`;
}
function _saaJobsAddMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  const total = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Keeps a job's calendar appointment in sync with its Scheduled Date /
 *  Scheduled Time / Technician fields, whichever page last changed them.
 *  Called after every save on the Jobs List's Job Card (the Dispatch
 *  Calendar's own drag-and-drop already updates the appointment directly
 *  — see saaCalUpdateAppointmentSchedule in calendar-db.js, which now
 *  also writes these same fields back onto the job). A job with a
 *  technician AND a scheduled date gets placed on the calendar grid at
 *  that date/time (defaulting to 9:00 AM and the type's usual duration,
 *  or 60 minutes, if no time was entered); otherwise its appointment is
 *  cleared back to no start time, which is exactly what puts it back in
 *  the Unscheduled Jobs queue. */
async function saaJobsSyncAppointmentSchedule(jobId, { technicianId, scheduledDate, scheduledTime, jobType }) {
  try {
    let start = null, end = null;
    if (technicianId && scheduledDate) {
      const time = scheduledTime || "09:00";
      const durations = await saaJobsFetchAppointmentTypes();
      const duration = durations[jobType] || 60;
      start = _saaJobsTimeStr(scheduledDate, time);
      end = _saaJobsTimeStr(scheduledDate, _saaJobsAddMinutes(time, duration));
    }
    const { error } = await _saaClient
      .from("appointments")
      .update({ technician_id: technicianId || null, start_datetime: start, end_datetime: end })
      .eq("job_id", jobId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Global quote search for the New Job popup's "Start from a Quote"
 *  flow — unlike saaJobsFetchCustomerQuotes (scoped to one already-
 *  selected customer), this searches every saved quote by quote number
 *  or by the customer's name/phone, since at this point in the New Job
 *  flow no customer has been picked yet. */
async function saaJobsSearchQuotes(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];

  const [{ data: byNumber, error: e1 }, { data: matchedCust, error: e2 }] = await Promise.all([
    _saaClient.from("quotes").select("id,quote_number,quote_type,total,customer_id,job_address,created_at").or(`quote_number.ilike.%${q}%`),
    _saaClient.from("customers").select("id,first_name,last_name,phone,billing_city,billing_zip").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const custIds = (matchedCust || []).map((c) => c.id);
  const { data: byCust, error: e3 } = custIds.length
    ? await _saaClient.from("quotes").select("id,quote_number,quote_type,total,customer_id,job_address,created_at").in("customer_id", custIds)
    : { data: [], error: null };
  if (e3) throw e3;

  const merged = {};
  [].concat(byNumber || [], byCust || []).forEach((qt) => { merged[qt.id] = qt; });
  const quotes = Object.values(merged);
  if (!quotes.length) return [];

  const allCustIds = [...new Set(quotes.map((qt) => qt.customer_id))];
  const { data: customers, error: e4 } = await _saaClient
    .from("customers")
    .select("id,first_name,last_name,phone,billing_address,billing_city,billing_zip")
    .in("id", allCustIds);
  if (e4) throw e4;
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));

  return quotes
    .map((qt) => Object.assign({}, qt, { customer: custById[qt.customer_id] || null }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);
}

/** Creates a job directly from the Jobs List "+ New Job" form. If a
 *  technician and scheduled date (and, usually, time) are set, the job's
 *  appointment is placed directly on that slot on the Dispatch Calendar
 *  grid; otherwise it's created with no start time, which is exactly
 *  what puts a job in the calendar's Unscheduled Jobs queue — no extra
 *  plumbing needed, it falls out of the existing schema. When the job is
 *  being created from a saved quote (payload.linkedQuoteId), the two
 *  rows are linked both ways: the new job's linked_quote_id points at
 *  the quote, and the quote's job_id points back at the new job. */
async function saaJobsCreateJob(payload) {
  try {
    let customerId = payload.customerId || null;
    if (!customerId && payload.newCustomer) {
      const nc = payload.newCustomer;
      if (!nc.firstName && !nc.lastName && !nc.phone) {
        return { ok: false, error: "Enter a first name, last name, or phone number for the customer." };
      }
      customerId = await saaJobsFindOrCreateCustomer(nc);
    }
    if (!customerId) return { ok: false, error: "Select or add a customer first." };

    let status = "new";
    if (payload.technicianId && payload.scheduledDate) status = "scheduled";
    else if (payload.technicianId) status = "assigned";

    const jobNumber = await _saaJobsNextJobNumber();

    const { data: job, error: jErr } = await _saaClient
      .from("jobs")
      .insert({
        job_number: jobNumber,
        customer_id: customerId,
        job_type: payload.jobType,
        priority: payload.priority || "normal",
        status,
        title: payload.title || "",
        job_address: payload.jobAddress || null,
        job_city: payload.jobCity || null,
        job_state: payload.jobState || "TX",
        job_zip: payload.jobZip || null,
        assigned_technician_id: payload.technicianId || null,
        scheduled_date: payload.scheduledDate || null,
        scheduled_time: payload.scheduledTime || null,
        linked_quote_id: payload.linkedQuoteId || null,
        quoted_amount: payload.quotedAmount || null,
        notes: payload.notes || null,
      })
      .select("id")
      .single();
    if (jErr) throw jErr;

    let start = null, end = null;
    if (payload.technicianId && payload.scheduledDate) {
      const time = payload.scheduledTime || "09:00";
      const durations = await saaJobsFetchAppointmentTypes();
      const duration = durations[payload.jobType] || 60;
      start = _saaJobsTimeStr(payload.scheduledDate, time);
      end = _saaJobsTimeStr(payload.scheduledDate, _saaJobsAddMinutes(time, duration));
    }

    const { error: aErr } = await _saaClient.from("appointments").insert({
      job_id: job.id,
      technician_id: payload.technicianId || null,
      start_datetime: start,
      end_datetime: end,
      status: "scheduled",
    });
    if (aErr) throw aErr;

    if (payload.linkedQuoteId) {
      const { error: qErr } = await _saaClient.from("quotes").update({ job_id: job.id }).eq("id", payload.linkedQuoteId);
      if (qErr) throw qErr;
    }

    return { ok: true, jobId: job.id };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Generic partial update used by every section of the Job Card
 *  (job info, diagnosis, cost fields, signature, notes). Auto-stamps
 *  completed_date the first time status flips to Completed, same
 *  behavior as the Dispatch Calendar drawer. */
async function saaJobsUpdateJob(jobId, fields) {
  try {
    const patch = Object.assign({}, fields, { updated_at: new Date().toISOString() });
    if (patch.status === "completed" && !patch.completed_date) {
      patch.completed_date = new Date().toISOString().slice(0, 10);
    }
    const { error } = await _saaClient.from("jobs").update(patch).eq("id", jobId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** That customer's saved quotes, for the Job Card's "link a saved
 *  quote" search (auto-fills Quoted Amount once one is picked). */
async function saaJobsFetchCustomerQuotes(customerId) {
  const { data, error } = await _saaClient
    .from("quotes")
    .select("id,quote_number,quote_type,total,updated_at")
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saaJobsLinkQuote(jobId, quoteId) {
  try {
    const { data: quote, error: qErr } = await _saaClient.from("quotes").select("total").eq("id", quoteId).single();
    if (qErr) throw qErr;
    const { error } = await _saaClient
      .from("jobs")
      .update({ linked_quote_id: quoteId, quoted_amount: quote.total || 0, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw error;
    // Keep the link two-way, same as a quote-to-job conversion from the New Job popup.
    await _saaClient.from("quotes").update({ job_id: jobId }).eq("id", quoteId);
    return { ok: true, quotedAmount: quote.total || 0 };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaJobsFetchLatestEquipment(customerId) {
  const { data, error } = await _saaClient
    .from("equipment")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/** The Job Card's three equipment buttons (Condenser / Coil / Furnace) —
 *  each is its own row on the `equipment` table, distinguished by the new
 *  equipment_type column, so a customer can have one current record per
 *  system component instead of a single generic "equipment" blob. Returns
 *  the most recent row of each type (or null if that type hasn't been
 *  added for this customer yet). */
const SAA_EQUIPMENT_TYPES = [["condenser", "Condenser"], ["coil", "Coil"], ["furnace", "Furnace"]];

async function saaJobsFetchEquipmentByType(customerId) {
  const { data, error } = await _saaClient
    .from("equipment")
    .select("*")
    .eq("customer_id", customerId)
    .in("equipment_type", ["condenser", "coil", "furnace"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  const byType = { condenser: null, coil: null, furnace: null };
  (data || []).forEach((row) => { if (!byType[row.equipment_type]) byType[row.equipment_type] = row; });
  return byType;
}

/** Creates or updates that customer's current row for one equipment type.
 *  Does nothing to the other two types' rows. */
async function saaJobsSaveEquipmentByType(customerId, equipmentType, fields) {
  try {
    const { data: existing, error: findErr } = await _saaClient
      .from("equipment")
      .select("id")
      .eq("customer_id", customerId)
      .eq("equipment_type", equipmentType)
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) throw findErr;
    const row = {
      brand: fields.brand || null,
      model: fields.model || null,
      serial_number: fields.serialNumber || null,
      refrigerant_type: fields.refrigerantType || null,
      tonnage: fields.tonnage || null,
      install_year: fields.installYear || null,
      warranty_status: fields.warrantyStatus || "unknown",
      updated_at: new Date().toISOString(),
    };
    if (existing && existing.length) {
      const { error } = await _saaClient.from("equipment").update(row).eq("id", existing[0].id);
      if (error) throw error;
      return { ok: true, id: existing[0].id };
    } else {
      const { data: created, error } = await _saaClient
        .from("equipment")
        .insert(Object.assign({ customer_id: customerId, equipment_type: equipmentType }, row))
        .select("id")
        .single();
      if (error) throw error;
      return { ok: true, id: created.id };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Locks or unlocks one equipment record so its fields can't be edited
 *  from the Job Card by accident until someone deliberately unlocks it. */
async function saaJobsToggleEquipmentLock(equipmentId, locked) {
  try {
    const { error } = await _saaClient.from("equipment").update({ locked }).eq("id", equipmentId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Sequential, human-readable job number (J-2026-0001) assigned once at
 *  creation — same count-based pattern _saaJobsNextInvoiceNumber already
 *  uses for invoices. Replaces the old "JOB-<uuid8>" display, which was
 *  a random UUID fragment, not sequential or trackable at all. */
async function _saaJobsNextJobNumber() {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("job_number", `J-${year}-%`);
  if (error) throw error;
  return `J-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

async function _saaJobsNextInvoiceNumber() {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .like("invoice_number", `INV-${year}-%`);
  if (error) throw error;
  return `INV-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

/** Fetches the job's most recent invoice, or creates a Draft one if
 *  none exists yet — amount defaults to Approved Amount, falling back
 *  to Quoted Amount, so "Generate Invoice" works with one click. */
async function saaJobsGetOrCreateInvoice(job) {
  try {
    const { data: existing, error: findErr } = await _saaClient
      .from("invoices")
      .select("*")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) throw findErr;
    if (existing && existing.length) return { ok: true, invoice: existing[0], created: false };

    const amount = Number(job.approved_amount || job.quoted_amount || 0);
    const invoiceNumber = await _saaJobsNextInvoiceNumber();
    const { data: created, error: createErr } = await _saaClient
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        job_id: job.id,
        quote_id: job.linked_quote_id || null,
        customer_id: job.customer_id,
        amount_total: amount,
        status: "draft",
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      })
      .select("*")
      .single();
    if (createErr) throw createErr;
    return { ok: true, invoice: created, created: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaJobsUpdateInvoice(invoiceId, fields) {
  try {
    const { error } = await _saaClient
      .from("invoices")
      .update(Object.assign({}, fields, { updated_at: new Date().toISOString() }))
      .eq("id", invoiceId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaJobsFetchPayments(invoiceId) {
  const { data, error } = await _saaClient
    .from("payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("payment_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Records a payment, then bumps the invoice's own status to Paid once
 *  payments cover the total (a Draft/Sent invoice with money in hand is
 *  as good as paid; Void is left alone either way). */
async function saaJobsRecordPayment(payload) {
  try {
    if (!(payload.amount > 0)) return { ok: false, error: "Enter a payment amount greater than $0." };
    const { error: payErr } = await _saaClient.from("payments").insert({
      invoice_id: payload.invoiceId,
      customer_id: payload.customerId,
      amount: payload.amount,
      payment_date: payload.paymentDate || new Date().toISOString().slice(0, 10),
      method: payload.method || null,
      reference_number: payload.referenceNumber || null,
      notes: payload.notes || null,
    });
    if (payErr) throw payErr;

    const { data: invoice, error: invErr } = await _saaClient.from("invoices").select("*").eq("id", payload.invoiceId).single();
    if (invErr) throw invErr;
    const payments = await saaJobsFetchPayments(payload.invoiceId);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    if (invoice.status !== "void" && totalPaid >= Number(invoice.amount_total || 0) && Number(invoice.amount_total || 0) > 0) {
      await _saaClient.from("invoices").update({ status: "paid" }).eq("id", payload.invoiceId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
