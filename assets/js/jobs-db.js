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

/** Digits-only comparison key for phone numbers -- "248-494-0509" and
 *  "2484940509" are the same customer. Matching on the raw string used to
 *  silently create a second customer row whenever the same person's number
 *  was typed with different punctuation (round 12 follow-up, 2026-09-13 --
 *  confirmed to have bitten a real customer). Same helper duplicated in
 *  quotes-db.js/calendar-db.js since none of these files are shared/loaded
 *  together. */
function _saaJobsPhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** Find-or-create a customer by first+last name plus a normalized-phone
 *  match — same rule quotes-db.js and calendar-db.js use, so a customer
 *  created from any of the three pages lands as one row. Duplicated here
 *  rather than shared since jobs.html doesn't load those files.
 *  Backfills an existing matched customer's blank address/city/zip fields
 *  when new values are provided, same as the other two copies. */
async function saaJobsFindOrCreateCustomer({ firstName, lastName, phone, email, address, city, zip }) {
  const { data: candidates, error: findErr } = await _saaClient
    .from("customers")
    .select("id,phone,email,billing_address,billing_city,billing_zip")
    .eq("first_name", firstName || "")
    .eq("last_name", lastName || "");
  if (findErr) throw findErr;
  const phoneKey = _saaJobsPhoneKey(phone);
  const existing = (candidates || []).find((c) => _saaJobsPhoneKey(c.phone) === phoneKey);
  if (existing) {
    const patch = {};
    if (email && !existing.email) patch.email = email;
    if (address && !existing.billing_address) patch.billing_address = address;
    if (city && !existing.billing_city) patch.billing_city = city;
    if (zip && !existing.billing_zip) patch.billing_zip = zip;
    if (Object.keys(patch).length) {
      await _saaClient.from("customers").update(patch).eq("id", existing.id);
    }
    return existing.id;
  }

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
  // Round 31: tracked separately from the $ sum above -- a recorded $0
  // payment contributes nothing to paidByInvoice but still needs to count
  // as "reviewed, nothing due" for saaJobsPaymentStatus below.
  const hasPaymentByInvoice = {};
  (payments || []).forEach((p) => {
    paidByInvoice[p.invoice_id] = (paidByInvoice[p.invoice_id] || 0) + Number(p.amount || 0);
    hasPaymentByInvoice[p.invoice_id] = true;
  });

  // most-recent invoice per job (invoices already ordered desc by created_at)
  const invoiceByJob = {};
  (invoices || []).forEach((inv) => { if (!invoiceByJob[inv.job_id]) invoiceByJob[inv.job_id] = inv; });

  return (jobs || []).map((j) => {
    const invoice = invoiceByJob[j.id] || null;
    const paid = invoice ? paidByInvoice[invoice.id] || 0 : 0;
    const hasPayment = invoice ? !!hasPaymentByInvoice[invoice.id] : false;
    return Object.assign({}, j, {
      customer: custById[j.customer_id] || null,
      technician: techById[j.assigned_technician_id] || null,
      // Round 25 (2026-09-14) multi-technician support: technician2/technician3
      // mirror `technician` for the optional 2nd/3rd crew slots. `select("*")`
      // above already brings back assigned_technician_id_2/_3 on the raw row.
      technician2: j.assigned_technician_id_2 ? techById[j.assigned_technician_id_2] || null : null,
      technician3: j.assigned_technician_id_3 ? techById[j.assigned_technician_id_3] || null : null,
      linkedQuote: j.linked_quote_id ? quoteById[j.linked_quote_id] || null : null,
      invoice,
      amountPaid: paid,
      paymentStatus: saaJobsPaymentStatus(invoice, paid, hasPayment),
    });
  });
}

/** The actual amount owed on an invoice, after an optional Discount and
 *  optional Other Costs/Additional Charges (round 6 follow-up,
 *  2026-09-13) -- `amount_total` alone is just the base charge (what the
 *  quote/approved amount put there); this is what payment status and the
 *  printed invoice's "Total Due" should be measured against. */
function saaJobsInvoiceTotalDue(invoice) {
  if (!invoice) return 0;
  return Number(invoice.amount_total || 0) - Number(invoice.discount || 0) + Number(invoice.additional_charges || 0);
}

/** Unpaid / Partially Paid / Paid — derived from money actually
 *  received against the job's invoice, independent of the invoice
 *  document's own Draft/Sent/Paid/Void lifecycle.
 *
 *  Round 31 (2026-09-15), per Vijayan: a job with nothing owed (no
 *  invoice, or an invoice totalling $0 -- e.g. a free follow-up check)
 *  used to be stuck showing "Unpaid" forever, since there was no way to
 *  reach "Paid" when there's no positive total to be paid in full
 *  against. `hasPayment` (true once at least one payment ROW exists for
 *  this invoice, even a $0.00 one -- see saaJobsRecordPayment, which now
 *  accepts $0) is the office's explicit "reviewed, nothing due" signal:
 *  recording a $0 payment on a no-charge job now flips it to Paid, while
 *  a job that simply hasn't been billed/reviewed yet still reads Unpaid. */
function saaJobsPaymentStatus(invoice, amountPaid, hasPayment) {
  const total = saaJobsInvoiceTotalDue(invoice);
  if (!invoice || total <= 0) return hasPayment ? "paid" : "unpaid";
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

/**
 * Best-available "completed time" for a job (Round 6 item 6), shown next
 * to Completed Date on the Job Card:
 *  1) status_history.completed — set automatically the moment the status
 *     is changed to Completed (see saaJobsUpdateJob), or manually edited —
 *     shown as the confirmed local HH:MM.
 *  2) otherwise, for ANY job with a Scheduled Time (regardless of current
 *     status — new/scheduled/in_progress and a Completed job from before
 *     this tracking existed all land here), an ESTIMATE of when the job
 *     card should end: Scheduled Time plus that job type's usual
 *     appointment length — flagged so the UI can label it "(estimated)"
 *     until the tech confirms/edits it or the job is actually completed.
 * returns { time: "HH:MM"|"", isEstimate: bool }
 */
async function saaJobsGetCompletedTime(job) {
  if (job && job.status_history && job.status_history.completed) {
    const d = new Date(job.status_history.completed);
    if (!isNaN(d.getTime())) {
      return { time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, isEstimate: false };
    }
  }
  if (job && job.scheduled_time) {
    const durations = await saaJobsFetchAppointmentTypes();
    const duration = durations[job.job_type] || 60;
    return { time: _saaJobsAddMinutes(job.scheduled_time, duration), isEstimate: true };
  }
  return { time: "", isEstimate: false };
}

/**
 * Manually set/override a job's recorded completed time (Round 6 item 6's
 * "allow provision to update status time if required"). Writes straight
 * into status_history.completed as a same-day timestamp built from the
 * given HH:MM, replacing whatever was there (an auto-set time from the
 * status change, a prior manual edit, or nothing at all).
 * returns { ok: true } | { ok: false, error }
 */
async function saaJobsSetCompletedTime(jobId, hhmm) {
  try {
    const { data: current, error: curErr } = await _saaClient
      .from("jobs")
      .select("status_history,completed_date")
      .eq("id", jobId)
      .single();
    if (curErr) throw curErr;
    const day = current.completed_date || new Date().toISOString().slice(0, 10);
    const iso = new Date(`${day}T${hhmm}:00`).toISOString();
    const status_history = Object.assign({}, current.status_history || {}, { completed: iso });
    const { error } = await _saaClient.from("jobs").update({ status_history }).eq("id", jobId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
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
 *  the Unscheduled Jobs queue.
 *
 *  If the start time being saved is the SAME one already on the
 *  appointment, the existing end_datetime is kept as-is instead of being
 *  recomputed from the job type's default duration — otherwise saving
 *  the Job Card for an unrelated reason (a note, a status change) after
 *  a dispatcher had dragged the appointment's right edge on the calendar
 *  to lengthen/shorten it would silently snap the duration back to
 *  default every time. Duration only resets to default when the start
 *  time actually changes (a real reschedule) or there was no existing
 *  appointment time to begin with.
 *
 *  Round 28 (2026-09-15) fix: that comparison used to be a plain
 *  `existing.start_datetime === start` string check against the naive
 *  "<date>T<HH>:<MM>:00" string this function builds locally. `start` and
 *  `end` on `appointments` are `timestamp with time zone` columns, though
 *  — so the value PostgREST hands back always carries an explicit offset
 *  (e.g. "2026-09-14T07:30:00+00:00", confirmed directly against the live
 *  database), which can never equal the offset-less string built here.
 *  That meant this "keep the existing duration" check *never actually
 *  matched against the real database* (it looked like it worked because
 *  `sitetest8`'s mock Supabase client stores/returns whatever string is
 *  inserted completely unchanged, with no timezone formatting at all) —
 *  every single Job Card save, including just opening and closing the
 *  card with zero edits (Close always saves) or the Round 26 autosave
 *  firing on any field, silently snapped a dispatcher-resized appointment
 *  back to its job type's default duration. Fixed by comparing the two
 *  timestamps on their date+hour+minute only (via
 *  `_saaJobsDateTimeMinuteKey`, tolerant of a "T" or " " separator and
 *  any trailing seconds/offset), not on exact string equality. */
function _saaJobsDateTimeMinuteKey(s) {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[1]}T${m[2]}:${m[3]}` : null;
}
// Round 25 (2026-09-14), per Vijayan: "multiple technician drive the
// calendar" -- technicianId2/technicianId3 (optional) are carried onto the
// same appointment row as technician_id_2/technician_id_3 so the Dispatch
// Calendar can place this appointment on all assigned technicians' tracks,
// not just the primary's. Only the primary technicianId still drives
// start/end time and appointment status the way it always has.
async function saaJobsSyncAppointmentSchedule(jobId, { technicianId, technicianId2, technicianId3, scheduledDate, scheduledTime, jobType }) {
  try {
    let start = null, end = null;
    if (technicianId && scheduledDate) {
      const time = scheduledTime || "09:00";
      start = _saaJobsTimeStr(scheduledDate, time);

      const { data: existing, error: exErr } = await _saaClient
        .from("appointments")
        .select("start_datetime,end_datetime")
        .eq("job_id", jobId)
        .maybeSingle();
      if (exErr) throw exErr;

      if (existing && existing.end_datetime && _saaJobsDateTimeMinuteKey(existing.start_datetime) === _saaJobsDateTimeMinuteKey(start)) {
        end = existing.end_datetime;
      } else {
        const durations = await saaJobsFetchAppointmentTypes();
        const duration = durations[jobType] || 60;
        end = _saaJobsTimeStr(scheduledDate, _saaJobsAddMinutes(time, duration));
      }
    }
    const { error } = await _saaClient
      .from("appointments")
      .update({
        technician_id: technicianId || null,
        technician_id_2: technicianId2 || null,
        technician_id_3: technicianId3 || null,
        start_datetime: start,
        end_datetime: end,
      })
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

/** DEPRECATED as of Round 42 Task 118 — no longer called (jobs.js's
 *  jbSaveNewJob now calls saaSystemsCreateWithJob + saaEventsCreateForJob
 *  instead, same as the Calendar's own New Job flow). Left in place
 *  rather than deleted, same "old code stays, just unused" convention as
 *  the appointments/follow_ups tables it wrote to. Do not wire this back
 *  up: it predates Systems/Events entirely, so a job created through it
 *  gets no System (empty System section on the Job Card) and no Event
 *  (empty Event History, AND invisible on the Dispatch Calendar, which
 *  reads from `events` now, not `jobs`/`appointments`) — that's the exact
 *  bug fixed by switching jbSaveNewJob away from this function.
 *
 *  Original doc: creates a job directly from the Jobs List "+ New Job"
 *  form. If a technician and scheduled date (and, usually, time) are
 *  set, the job's appointment is placed directly on that slot on the
 *  Dispatch Calendar grid; otherwise it's created with no start time,
 *  which is exactly what puts a job in the calendar's Unscheduled Jobs
 *  queue — no extra plumbing needed, it falls out of the existing
 *  schema. When the job is being created from a saved quote
 *  (payload.linkedQuoteId), the two rows are linked both ways: the new
 *  job's linked_quote_id points at the quote, and the quote's job_id
 *  points back at the new job. */
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

    const firstNameForNumber = (payload.newCustomer && payload.newCustomer.firstName) || (await _saaCustomerFirstName(customerId));
    const jobNumber = await _saaJobsNextJobNumber(firstNameForNumber);

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
        // Round 25 (2026-09-14): optional 2nd/3rd technician, same as the
        // Job Card's own Technician 2/3 selects.
        assigned_technician_id_2: payload.technicianId2 || null,
        assigned_technician_id_3: payload.technicianId3 || null,
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
      technician_id_2: payload.technicianId2 || null,
      technician_id_3: payload.technicianId3 || null,
      start_datetime: start,
      end_datetime: end,
      status: "scheduled",
    });
    if (aErr) throw aErr;

    if (payload.linkedQuoteId) {
      const { error: qErr } = await _saaClient.from("quotes").update({ job_id: job.id }).eq("id", payload.linkedQuoteId);
      if (qErr) throw qErr;
    }

    // Round 11 follow-up (2026-09-13): "save miles for every job" -- a job
    // created with a technician/date/address already set (e.g. scheduled
    // right away from the New Job popup) gets its first mileage leg
    // calculated immediately, same as a reschedule does. Fire-and-forget:
    // this never blocks or fails job creation, and jobs-db.js is loaded
    // everywhere mileage-db.js is (jobs.html, calendar.html).
    if (typeof saaMileageEnsureForJob === "function") {
      saaMileageEnsureForJob({
        id: job.id,
        assigned_technician_id: payload.technicianId || null,
        scheduled_date: payload.scheduledDate || null,
        scheduled_time: payload.scheduledTime || null,
        job_address: payload.jobAddress || null,
        job_city: payload.jobCity || null,
        job_state: payload.jobState || "TX",
        job_zip: payload.jobZip || null,
      });
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
    // Round 6: record the date/time the job entered each status, so
    // technician timing can be reconstructed later. Each status keeps only
    // its MOST RECENT timestamp — re-entering a status overwrites rather
    // than piling up duplicates. Skipped entirely when this save doesn't
    // touch status, and a no-op when the status isn't actually changing.
    // Keep this in sync with saaCalUpdateAppointmentStatus's copy of the
    // same logic in calendar-db.js.
    if (patch.status) {
      const { data: current, error: curErr } = await _saaClient
        .from("jobs")
        .select("status,status_history")
        .eq("id", jobId)
        .single();
      if (curErr) throw curErr;
      if (current && patch.status !== current.status) {
        patch.status_history = Object.assign({}, current.status_history || {}, { [patch.status]: new Date().toISOString() });
      }
    }
    const { error } = await _saaClient.from("jobs").update(patch).eq("id", jobId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaJobsFriendlyDbError(e) };
  }
}

/** Turns a raw Postgres/PostgREST error into something an office user can
 *  act on, instead of leaking constraint/column internals verbatim (Round
 *  13: "clearly say what is causing the error"). Same idea as calendar-db.js's
 *  copy — kept separate since these files aren't always loaded together. */
function _saaJobsFriendlyDbError(e) {
  const raw = (e && e.message) || String(e);
  if (/violates check constraint "jobs_status_check"/.test(raw)) {
    return "That status isn't valid for a job record. Please try again — if this keeps happening, let the office know.";
  }
  if (/violates check constraint/.test(raw)) {
    return "That value isn't allowed for this field: " + raw.replace(/^.*constraint "/, "").replace(/".*$/, "").replace(/_/g, " ") + ".";
  }
  if (/violates foreign key constraint/.test(raw)) {
    return "That record is linked to other data and can't be changed that way.";
  }
  return raw;
}

/** That customer's saved quotes, for the Job Card's "link a saved
 *  quote" search (auto-fills Quoted Amount once one is picked).
 *
 *  A job's customer and a quote's customer are matched/created
 *  separately (saaJobsFindOrCreateCustomer here vs.
 *  saaFindOrCreateCustomer in quotes-db.js), both by exact
 *  first+last+phone — so the same real person typed slightly
 *  differently (name capitalization, a trailing space) on the
 *  Quotation page vs. the New Job popup ends up as two different
 *  customer rows, and a plain customer_id match here finds nothing
 *  even though a saved quote exists. When the direct customer_id
 *  lookup comes up empty and a phone number is available, also pull
 *  quotes for any OTHER customer row sharing that same phone number.
 *
 *  Found live (2026-09-13, Sriram Ranganathan): this fallback used to
 *  compare phone numbers as exact strings, on the assumption that
 *  saaAttachPhoneMask formats every phone the same way everywhere --
 *  but a customer row created before the mask existed, or via a path
 *  that doesn't apply it, can have digits-only ("8327037680") sitting
 *  right next to a masked duplicate ("832-703-7680") for the same real
 *  person, and an exact string match treats those as different phone
 *  numbers, silently missing the other row's quotes. Now compares
 *  DIGITS ONLY, so formatting differences can't hide a match. The
 *  customers table is small (one HVAC office's clientele), so pulling
 *  every phone to compare client-side is cheap. */
async function saaJobsFetchCustomerQuotes(customerId, phone) {
  const { data, error } = await _saaClient
    .from("quotes")
    .select("id,quote_number,quote_type,total,material_cost,labor_cost,other_cost,updated_at,customer_id,job_address")
    .eq("customer_id", customerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  if ((data || []).length || !phone) return data || [];

  const digitsOnly = (p) => (p || "").replace(/\D/g, "");
  const targetDigits = digitsOnly(phone);
  if (!targetDigits) return [];

  const { data: allCust, error: custErr } = await _saaClient
    .from("customers")
    .select("id,phone");
  if (custErr) throw custErr;
  const otherIds = (allCust || [])
    .filter((c) => c.id !== customerId && digitsOnly(c.phone) === targetDigits)
    .map((c) => c.id);
  if (!otherIds.length) return [];

  const { data: byPhone, error: phoneErr } = await _saaClient
    .from("quotes")
    .select("id,quote_number,quote_type,total,material_cost,labor_cost,other_cost,updated_at,customer_id,job_address")
    .in("customer_id", otherIds)
    .order("updated_at", { ascending: false });
  if (phoneErr) throw phoneErr;
  return byPhone || [];
}

/** Same customer-then-phone-fallback matching as saaJobsFetchCustomerQuotes,
 *  used to warn a dispatcher before they create a second job for a customer
 *  that already has an open job of the same type. "Open" excludes
 *  completed/cancelled jobs — a repeat repair call after a job is closed
 *  out is a legitimate new job, not a duplicate. */
async function saaJobsFindDuplicateJobs({ customerId, phone, jobType, excludeId }) {
  try {
    if (!customerId) return { ok: true, jobs: [] };
    const openStatuses = ["new", "assigned", "scheduled", "in_progress"];
    const { data: direct, error: dErr } = await _saaClient
      .from("jobs")
      .select("id,job_number,job_type,status,scheduled_date")
      .eq("customer_id", customerId)
      .eq("job_type", jobType || "");
    if (dErr) throw dErr;
    let rows = direct || [];
    if (!rows.length && phone) {
      const { data: sameCust, error: cErr } = await _saaClient.from("customers").select("id").eq("phone", phone);
      if (cErr) throw cErr;
      const otherIds = (sameCust || []).map((c) => c.id).filter((id) => id !== customerId);
      if (otherIds.length) {
        const { data: byPhone, error: pErr } = await _saaClient
          .from("jobs")
          .select("id,job_number,job_type,status,scheduled_date")
          .in("customer_id", otherIds)
          .eq("job_type", jobType || "");
        if (pErr) throw pErr;
        rows = byPhone || [];
      }
    }
    const openJobs = rows.filter((j) => j.id !== excludeId && openStatuses.includes(j.status));
    return { ok: true, jobs: openJobs };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Deletes a job and everything that hangs off it — its payments, invoice,
 *  photos, and calendar appointment — and clears the job_id back-link on
 *  any quote that had been converted into it. Used by the "remove a
 *  duplicate job" flow (New Job popup warning, and a Delete Job button on
 *  the Job Card itself). */
async function saaJobsDeleteJob(jobId) {
  try {
    const { data: invoices, error: invErr } = await _saaClient.from("invoices").select("id").eq("job_id", jobId);
    if (invErr) throw invErr;
    for (const inv of invoices || []) {
      const { error: payErr } = await _saaClient.from("payments").delete().eq("invoice_id", inv.id);
      if (payErr) throw payErr;
    }
    if ((invoices || []).length) {
      const { error: delInvErr } = await _saaClient.from("invoices").delete().eq("job_id", jobId);
      if (delInvErr) throw delInvErr;
    }
    const { error: photoErr } = await _saaClient.from("job_photos").delete().eq("job_id", jobId);
    if (photoErr) throw photoErr;
    const { error: apptErr } = await _saaClient.from("appointments").delete().eq("job_id", jobId);
    if (apptErr) throw apptErr;
    const { error: quoteErr } = await _saaClient.from("quotes").update({ job_id: null }).eq("job_id", jobId);
    if (quoteErr) throw quoteErr;
    const { error: jobErr } = await _saaClient.from("jobs").delete().eq("id", jobId);
    if (jobErr) throw jobErr;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaJobsLinkQuote(jobId, quoteId) {
  try {
    const { data: quote, error: qErr } = await _saaClient
      .from("quotes")
      .select("total,material_cost,labor_cost,other_cost")
      .eq("id", quoteId)
      .single();
    if (qErr) throw qErr;
    const { error } = await _saaClient
      .from("jobs")
      .update({ linked_quote_id: quoteId, quoted_amount: quote.total || 0, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw error;
    // Keep the link two-way, same as a quote-to-job conversion from the New Job popup.
    await _saaClient.from("quotes").update({ job_id: jobId }).eq("id", quoteId);
    // material_cost/labor_cost/other_cost are null on quotes saved before
    // this column existed -- callers should treat a null here as "no
    // breakdown available" rather than a real $0 (round 6 follow-up,
    // 2026-09-13).
    return {
      ok: true,
      quotedAmount: quote.total || 0,
      materialCost: quote.material_cost,
      laborCost: quote.labor_cost,
      otherCost: quote.other_cost,
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Round 33 (2026-09-16): the reverse of saaJobsLinkQuote -- clears the
 *  job's link to a Quote without touching Quoted Amount (that's a
 *  separately-editable field the office may have already adjusted) and
 *  without deleting the quote itself. Frees the quote's own job_id back to
 *  null too (mirroring the delete-job cleanup below) so it's available to
 *  link to a different job, or this same one again, later. */
async function saaJobsUnlinkQuote(jobId, quoteId) {
  try {
    const { error } = await _saaClient
      .from("jobs")
      .update({ linked_quote_id: null, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) throw error;
    if (quoteId) {
      await _saaClient.from("quotes").update({ job_id: null }).eq("id", quoteId).eq("job_id", jobId);
    }
    return { ok: true };
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
async function _saaJobsNextJobNumber(firstName) {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("job_number", `J-${year}-%`);
  if (error) throw error;
  const base = `J-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

async function _saaJobsNextInvoiceNumber(firstName) {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .like("invoice_number", `INV-${year}-%`);
  if (error) throw error;
  const base = `INV-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

/** Looks up a customer's first name by id for the number-suffix schemes
 *  above, for the (fairly common) case where a job/invoice is being
 *  created for an EXISTING customer picked from search rather than typed
 *  in fresh — so payload.newCustomer.firstName isn't available. */
async function _saaCustomerFirstName(customerId) {
  if (!customerId) return null;
  const { data } = await _saaClient.from("customers").select("first_name").eq("id", customerId).maybeSingle();
  return data ? data.first_name : null;
}

/* ============================== Bill of Material (job_materials) ==============================
 * Round 12 (2026-09-13): "Add BOM button to create and print bill of
 * material to order. Add order button in bill of material page. Order
 * button will create order form with order number showing related
 * quotation number and job number. Save bill of material details in
 * database against each job." job_materials already existed in the
 * schema (scaffolded, unused) as the natural per-job itemized-materials
 * table, so the Job Card's Bill of Material section reads/writes it
 * directly rather than a new table. BOM-level metadata (its own number,
 * and the Order raised against it) lives on the jobs row itself, the same
 * way inspection_results and linked_quote_id already do — a Bill of
 * Material only ever belongs to one job. */

/** Fetches this job's Bill of Material line items, in display order. */
async function saaBomFetchItems(jobId) {
  const { data, error } = await _saaClient
    .from("job_materials")
    .select("*")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Replaces a job's entire Bill of Material item list. The list has no
 *  durable ids on the client side (rows are freely added/edited/removed
 *  in the Job Card), so "delete everything for this job, then reinsert
 *  what's currently on screen" is the simplest correct way to save it —
 *  same shape as re-saving the Inspection checklist's whole array, just
 *  against a real child table instead of a jsonb column. Returns the
 *  freshly-inserted rows (with their DB-generated actual_ext_cost) so
 *  callers can print/display exact totals without a second round-trip.
 *  Rows with no description are dropped (a blank trailing row from
 *  "+ Add Item" that was never filled in). */
async function saaBomSaveItems(jobId, items) {
  try {
    const { error: delErr } = await _saaClient.from("job_materials").delete().eq("job_id", jobId);
    if (delErr) throw delErr;
    const clean = (items || [])
      .map((it) => ({
        description: (it.description || "").trim(),
        qty: Number(it.quantity != null ? it.quantity : it.qty) || 1,
        unit: (it.unit || "ea").trim() || "ea",
        actual_unit_cost: it.unit_cost != null && it.unit_cost !== "" ? Number(it.unit_cost) : 0,
        notes: it.notes || null,
      }))
      .filter((it) => it.description);
    if (!clean.length) return { ok: true, items: [] };
    // Round 42 Task 118: auto-attaches every line item to the Job's
    // current Event (see saaEventsGetDefaultEventId in events-db.js).
    const eventId = typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(jobId) : null;
    const rows = clean.map((it, i) => Object.assign({ job_id: jobId, event_id: eventId, sort_order: i }, it));
    const { data, error: insErr } = await _saaClient
      .from("job_materials")
      .insert(rows)
      .select("*")
      .order("sort_order", { ascending: true });
    if (insErr) throw insErr;
    return { ok: true, items: data || [] };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Round 42 Task 122: BOM numbers are now a single global sequence shared
 *  by both jobs.bom_number and events.bom_number (the Job Card's own BOM
 *  section, and the new per-Event Bill of Material introduced this round)
 *  -- counts across both tables so a job and an event can never mint the
 *  same BOM-YYYY-#### number. */
async function _saaBomNextNumber(firstName) {
  const year = new Date().getFullYear();
  const [{ count: jobCount, error: jErr }, { count: eventCount, error: eErr }] = await Promise.all([
    _saaClient.from("jobs").select("id", { count: "exact", head: true }).like("bom_number", `BOM-${year}-%`),
    _saaClient.from("events").select("id", { count: "exact", head: true }).like("bom_number", `BOM-${year}-%`),
  ]);
  if (jErr) throw jErr;
  if (eErr) throw eErr;
  const base = `BOM-${year}-${String((jobCount || 0) + (eventCount || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

/** Same global-sequence treatment as _saaBomNextNumber, for Order numbers. */
async function _saaBomNextOrderNumber(firstName) {
  const year = new Date().getFullYear();
  const [{ count: jobCount, error: jErr }, { count: eventCount, error: eErr }] = await Promise.all([
    _saaClient.from("jobs").select("id", { count: "exact", head: true }).like("bom_order_number", `PO-${year}-%`),
    _saaClient.from("events").select("id", { count: "exact", head: true }).like("bom_order_number", `PO-${year}-%`),
  ]);
  if (jErr) throw jErr;
  if (eErr) throw eErr;
  const base = `PO-${year}-${String((jobCount || 0) + (eventCount || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

/** Assigns this job's Bill of Material its sequential number the first
 *  time it's needed — printing the BOM, or creating an Order against it.
 *  A no-op (no DB write) if it already has one. Same lazy-numbering shape
 *  as saaJobsGetOrCreateInvoice. */
async function saaBomEnsureNumber(job) {
  try {
    if (job.bom_number) return { ok: true, bomNumber: job.bom_number };
    const firstName = job.customer ? job.customer.first_name : await _saaCustomerFirstName(job.customer_id);
    const bomNumber = await _saaBomNextNumber(firstName);
    const res = await saaJobsUpdateJob(job.id, { bom_number: bomNumber });
    if (!res.ok) return res;
    job.bom_number = bomNumber;
    return { ok: true, bomNumber };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Raises the Order against a job's current Bill of Material — mints a
 *  sequential Order Number/date the first time (re-clicking "Create
 *  Order"/"Print Order Form" once one already exists just updates the
 *  Supplier and re-prints the same order rather than minting a new number
 *  every time). Always makes sure the Bill of Material itself is numbered
 *  first, since an Order needs a BOM number to point back to. */
async function saaBomCreateOrder(job, supplier) {
  try {
    const numRes = await saaBomEnsureNumber(job);
    if (!numRes.ok) return numRes;
    const patch = { bom_supplier: supplier || null };
    if (!job.bom_order_number) {
      const firstName = job.customer ? job.customer.first_name : await _saaCustomerFirstName(job.customer_id);
      patch.bom_order_number = await _saaBomNextOrderNumber(firstName);
      patch.bom_order_date = new Date().toISOString().slice(0, 10);
      patch.bom_status = "ordered";
    }
    const res = await saaJobsUpdateJob(job.id, patch);
    if (!res.ok) return res;
    Object.assign(job, patch);
    return { ok: true, orderNumber: job.bom_order_number, orderDate: job.bom_order_date, bomNumber: job.bom_number };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
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
    const firstNameForNumber = job.customer ? job.customer.first_name : await _saaCustomerFirstName(job.customer_id);
    const invoiceNumber = await _saaJobsNextInvoiceNumber(firstNameForNumber);
    // Round 42 Task 118: auto-attaches to the Job's current Event (see
    // saaEventsGetDefaultEventId's own comment in events-db.js for the
    // "auto-pick, no new UI" rule) -- guarded since not every page that
    // creates an invoice also loads events-db.js.
    const eventId = typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(job.id) : null;
    const { data: created, error: createErr } = await _saaClient
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        job_id: job.id,
        event_id: eventId,
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

/** Round 22 (2026-09-14): "Add provision to change customer name and
 *  phone number" -- edits the underlying customers row directly (not
 *  just this one job's copy of it), so the change is visible everywhere
 *  else this customer shows up (other jobs, quotes, the Jobs list). */
async function saaCustomersUpdateContact(customerId, fields) {
  try {
    const firstName = (fields.first_name || "").trim();
    if (!firstName) throw new Error("First name is required.");
    const patch = {
      first_name: firstName,
      last_name: (fields.last_name || "").trim() || null,
      phone: (fields.phone || "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await _saaClient
      .from("customers")
      .update(patch)
      .eq("id", customerId)
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, customer: data };
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
 *  as good as paid; Void is left alone either way).
 *
 *  Round 31 (2026-09-15), per Vijayan: a no-charge job (e.g. a free
 *  follow-up check) had no way to be marked settled -- $0 was rejected
 *  outright here, and even if it hadn't been, a $0 total could never
 *  reach "paid" below (see the totalDue>0 guard this round removed for
 *  that case). Now $0 is a valid, explicit "nothing owed, confirmed" entry
 *  -- only a genuinely negative amount is rejected. */
async function saaJobsRecordPayment(payload) {
  try {
    if (!(payload.amount >= 0)) return { ok: false, error: "Enter a payment amount of $0 or more." };
    // Round 42 Task 118: a payment attaches to the SAME Event as the
    // invoice it's paying (not re-picked independently) -- that's the one
    // unambiguous choice for a payment, and keeps a payment from ever
    // landing on a different Event than its own invoice.
    const { data: payInvoice } = await _saaClient.from("invoices").select("event_id").eq("id", payload.invoiceId).maybeSingle();
    const { error: payErr } = await _saaClient.from("payments").insert({
      invoice_id: payload.invoiceId,
      event_id: payInvoice ? payInvoice.event_id : null,
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
    const totalDue = saaJobsInvoiceTotalDue(invoice);
    // Nothing owed (totalDue <= 0): the payment record itself -- even the
    // $0 one that was just inserted -- IS the "settled" signal, since
    // there's no positive total for totalPaid to catch up to.
    const settled = totalDue > 0 ? totalPaid >= totalDue : payments.length > 0;
    if (invoice.status !== "void" && settled) {
      await _saaClient.from("invoices").update({ status: "paid" }).eq("id", payload.invoiceId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
