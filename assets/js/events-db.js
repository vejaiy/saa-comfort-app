/* ============================================================
   SAA Comfort Air LLC — Events (visits) data layer (Round 42)
   Backs the "Customer -> System -> Job -> Event" architecture: an
   Event is one visit (Service Call, Diagnostic, Repair, Maintenance,
   Estimate Visit, Installation, Follow-Up, Warranty Visit,
   Inspection, Customer Callback, Other) against a Job. A Job can have
   unlimited Events; the Dispatch Calendar schedules/displays/drags
   Events, never Jobs directly (dragging an Event only ever changes
   its own assigned technician/time — never Customer/System/Job).

   Design notes:
   - Same flat-fetch-then-stitch-in-JS pattern as jobs-db.js/
     calendar-db.js/systems-db.js.
   - Per Vijayan's "move financials to Event level" decision (see
     claude/round42-jobs-events-systems-phase1-schema.md), invoices,
     payments, job_materials (BOM), job_photos, and mileage_logs all
     carry an event_id now, alongside their existing job_id (kept in
     sync with the Event's own Job — see saaEventsReassignJob below).
     The actual write-path changes for those five areas are Round 42
     Task 118, not here.
   - The old `appointments` table is left alone/deprecated — this file
     supersedes it for all NEW scheduling. saaJobsSyncAppointmentSchedule
     / saaCalUpdateAppointmentSchedule in jobs-db.js/calendar-db.js still
     exist and still work for now, but Task 117 will point the Dispatch
     Calendar at events instead.
   - "New Events always sort to the top" (spec) means ORDER BY
     scheduled_start DESC at read time — Events are never physically
     reordered, and every fetcher below already sorts that way.
   ============================================================ */

const SAA_EVENT_TYPE_LABELS = {
  service_call: "Service Call",
  diagnostic: "Diagnostic",
  repair: "Repair",
  maintenance: "Maintenance",
  estimate_visit: "Estimate Visit",
  installation: "Installation",
  follow_up: "Follow-Up",
  warranty_visit: "Warranty Visit",
  inspection: "Inspection",
  customer_callback: "Customer Callback",
  other: "Other",
};
const SAA_EVENT_TYPE_OPTIONS = Object.entries(SAA_EVENT_TYPE_LABELS);

const SAA_EVENT_STATUS_LABELS = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  en_route: "En Route",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  no_show: "No Show",
};
const SAA_EVENT_STATUS_OPTIONS = Object.entries(SAA_EVENT_STATUS_LABELS);

function saaEventTypeLabel(key) { return SAA_EVENT_TYPE_LABELS[key] || key || "—"; }
function saaEventStatusLabel(key) { return SAA_EVENT_STATUS_LABELS[key] || key || "—"; }

/** Sequential, human-readable Event number ("EVT-2026-0001"), same
 *  count-based scheme as _saaJobsNextJobNumber/_saaJobsNextInvoiceNumber
 *  in jobs-db.js — no customer-name suffix (unlike Job/Invoice/Quote
 *  numbers), matching the plain "EVT-YYYY-####" format used throughout
 *  the Round 42 migration/backfill. */
async function _saaEventsNextEventNumber() {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("events")
    .select("id", { count: "exact", head: true })
    .like("event_number", `EVT-${year}-%`);
  if (error) throw error;
  return `EVT-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

async function saaEventsFetchTechnicians() {
  const { data, error } = await _saaClient.from("technicians").select("id,name,active").eq("active", true).order("name");
  if (error) throw error;
  return data || [];
}

/** Attaches technician(s) to a flat list of event rows — shared by every
 *  fetcher below, same shape as _saaCalHydrateAppts in calendar-db.js. */
function _saaEventsHydrate(rawEvents, techById) {
  return (rawEvents || []).map((e) =>
    Object.assign({}, e, {
      technician: techById[e.assigned_technician_id] || null,
      technician2: e.assigned_technician_id_2 ? techById[e.assigned_technician_id_2] || null : null,
      technician3: e.assigned_technician_id_3 ? techById[e.assigned_technician_id_3] || null : null,
    })
  );
}

/** A Job's full Event History, newest-first (per spec: "New Events
 *  always sort to the top ... never physically reordered") — backs the
 *  Job Detail page's Event History timeline. */
async function saaEventsFetchForJob(jobId) {
  const [{ data: events, error }, technicians] = await Promise.all([
    _saaClient.from("events").select("*").eq("job_id", jobId).order("scheduled_start", { ascending: false }),
    saaEventsFetchTechnicians(),
  ]);
  if (error) throw error;
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));
  return _saaEventsHydrate(events || [], techById);
}

/** The single "Current Event" for a Job's summary section — the most
 *  recently scheduled Event that isn't Completed/Cancelled, falling
 *  back to the single most recent Event of any status if every Event
 *  is already closed out (a completed Job still has a "current event"
 *  to display, it's just in the past). */
async function saaEventsFetchCurrentForJob(jobId) {
  const all = await saaEventsFetchForJob(jobId);
  if (!all.length) return null;
  const open = all.find((e) => !["completed", "cancelled"].includes(e.event_status));
  return open || all[0];
}

async function saaEventsFetchById(eventId) {
  if (!eventId) return null;
  const [{ data: event, error }, technicians] = await Promise.all([
    _saaClient.from("events").select("*").eq("id", eventId).maybeSingle(),
    saaEventsFetchTechnicians(),
  ]);
  if (error) throw error;
  if (!event) return null;
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));
  return _saaEventsHydrate([event], techById)[0];
}

/** Creates a new Event under an ALREADY-OPEN Job — the "+ Schedule
 *  Follow-Up" / "+ Schedule New Event" action on the Job Detail page.
 *  Auto-associates customer_id/system_id straight from the Job, exactly
 *  per spec ("auto-associates Customer/System/Job, no re-selection").
 *  Mints the Event its own sequential EVT-YYYY-#### number. Returns
 *  { ok:true, eventId } | { ok:false, error }. */
async function saaEventsCreateForJob(jobId, fields) {
  try {
    const { data: job, error: jErr } = await _saaClient
      .from("jobs")
      .select("id,customer_id,system_id")
      .eq("id", jobId)
      .single();
    if (jErr) throw jErr;
    if (!job) return { ok: false, error: "That job no longer exists." };

    const eventNumber = await _saaEventsNextEventNumber();
    const { data: event, error: eErr } = await _saaClient
      .from("events")
      .insert({
        event_number: eventNumber,
        job_id: job.id,
        customer_id: job.customer_id,
        system_id: job.system_id,
        event_type: fields.eventType || "service_call",
        event_status: fields.eventStatus || "scheduled",
        scheduled_start: fields.scheduledStart || null,
        scheduled_end: fields.scheduledEnd || null,
        assigned_technician_id: fields.technicianId || null,
        assigned_technician_id_2: fields.technicianId2 || null,
        assigned_technician_id_3: fields.technicianId3 || null,
        reason: fields.reason || null,
        description: fields.description || null,
      })
      .select("id")
      .single();
    if (eErr) throw eErr;
    return { ok: true, eventId: event.id, eventNumber };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Generic partial update, used by the Event detail view for everything
 *  from a status change to filling in technician/customer notes, work
 *  performed, parts used, or a customer signature. Auto-stamps
 *  completed_at the first time event_status flips to Completed — same
 *  convention as saaJobsUpdateJob's completed_date auto-stamp. Never
 *  touches the Event's Job/System/Customer (see saaEventsReassignJob
 *  for that, which is a deliberate, separate action). */
async function saaEventsUpdate(eventId, fields) {
  try {
    const patch = Object.assign({}, fields, { updated_at: new Date().toISOString() });
    if (patch.event_status === "completed" && !patch.completed_at) {
      patch.completed_at = new Date().toISOString();
    }
    if (patch.event_status && patch.event_status !== "completed") {
      // Leaving Completed (e.g. correcting a mis-click) clears the stamp
      // rather than leaving a stale completed_at behind on a re-opened event.
      patch.completed_at = patch.completed_at || null;
    }
    const { error } = await _saaClient.from("events").update(patch).eq("id", eventId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Reschedule: changes an Event's own time/technician(s) in place — same
 *  Event row, same event_number, no duplicate created. Optional
 *  `reason` is folded into the Event's own description so the "why it
 *  moved" isn't lost, since full before/after audit logging is a Phase 2
 *  item (see the Round 42 project doc). */
async function saaEventsReschedule(eventId, { scheduledStart, scheduledEnd, technicianId, technicianId2, technicianId3, reason }) {
  try {
    const { data: current, error: curErr } = await _saaClient
      .from("events")
      .select("scheduled_start,description")
      .eq("id", eventId)
      .single();
    if (curErr) throw curErr;

    const patch = {
      scheduled_start: scheduledStart || null,
      scheduled_end: scheduledEnd || null,
      updated_at: new Date().toISOString(),
    };
    if (technicianId !== undefined) patch.assigned_technician_id = technicianId || null;
    if (technicianId2 !== undefined) patch.assigned_technician_id_2 = technicianId2 || null;
    if (technicianId3 !== undefined) patch.assigned_technician_id_3 = technicianId3 || null;
    if (current && current.scheduled_start !== scheduledStart) {
      patch.event_status = "rescheduled";
      const fromStr = current.scheduled_start ? new Date(current.scheduled_start).toLocaleString() : "unscheduled";
      const note = `[Rescheduled from ${fromStr}${reason ? ` — ${reason}` : ""}]`;
      patch.description = current.description ? `${current.description}\n${note}` : note;
    }
    const { error } = await _saaClient.from("events").update(patch).eq("id", eventId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Dispatch Calendar drag-and-drop across technician columns — updates
 *  ONLY the dragged Event's own technician assignment (and, if the drop
 *  also changed the time slot, its schedule), per spec: "dragging an
 *  Event across technician columns updates only Event.AssignedEmployee,
 *  never Customer/System/Job/history." */
async function saaEventsUpdateAssignment({ eventId, technicianId, technicianId2, technicianId3, scheduledStart, scheduledEnd }) {
  try {
    const patch = { assigned_technician_id: technicianId || null };
    if (technicianId2 !== undefined) patch.assigned_technician_id_2 = technicianId2 || null;
    if (technicianId3 !== undefined) patch.assigned_technician_id_3 = technicianId3 || null;
    if (scheduledStart !== undefined) patch.scheduled_start = scheduledStart || null;
    if (scheduledEnd !== undefined) patch.scheduled_end = scheduledEnd || null;
    const { error } = await _saaClient.from("events").update(patch).eq("id", eventId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Loads every Event in a date range [startDateStr, endDateStrExclusive)
 *  for the Dispatch Calendar's Day/Week/Month views, plus the
 *  Unscheduled queue (scheduled_start is null) — same two-bucket shape
 *  saaCalFetchDayData/saaCalFetchRangeData use for appointments today,
 *  but reading `events` instead so the calendar can move onto the new
 *  model (Round 42 Task 117 wires this into calendar.js). Each Event is
 *  hydrated with its Job/Customer/System so the calendar card can show
 *  the customer name and job number without a second round trip. */
async function saaEventsFetchForCalendarRange(startDateStr, endDateStrExclusive) {
  const start = `${startDateStr}T00:00:00`;
  const end = `${endDateStrExclusive}T00:00:00`;
  const [{ data: scheduled, error: e1 }, { data: unscheduledRaw, error: e2 }, technicians] = await Promise.all([
    _saaClient.from("events").select("*").gte("scheduled_start", start).lt("scheduled_start", end),
    _saaClient.from("events").select("*").is("scheduled_start", null),
    saaEventsFetchTechnicians(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  // Filtered here in JS rather than with a DB-side "not in (...)" filter —
  // keeps this portable across the real Supabase client and the Playwright
  // mock, which only understands a plain .not(col, "is", val) negation.
  const unscheduled = (unscheduledRaw || []).filter((e) => !["completed", "cancelled"].includes(e.event_status));
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));
  const all = _saaEventsHydrate([].concat(scheduled || [], unscheduled || []), techById);

  const jobIds = [...new Set(all.map((e) => e.job_id).filter(Boolean))];
  const { data: jobs, error: jErr } = jobIds.length
    ? await _saaClient.from("jobs").select("id,job_number,job_type,job_address,job_city").in("id", jobIds)
    : { data: [], error: null };
  if (jErr) throw jErr;
  const custIds = [...new Set(all.map((e) => e.customer_id).filter(Boolean))];
  const { data: customers, error: cErr } = custIds.length
    ? await _saaClient.from("customers").select("id,first_name,last_name,phone,billing_address").in("id", custIds)
    : { data: [], error: null };
  if (cErr) throw cErr;
  const jobById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));

  const hydrated = all.map((e) => Object.assign({}, e, { job: jobById[e.job_id] || null, customer: custById[e.customer_id] || null }));
  const schedIds = new Set((scheduled || []).map((e) => e.id));
  return {
    technicians: technicians || [],
    scheduled: hydrated.filter((e) => schedIds.has(e.id)),
    unscheduled: hydrated.filter((e) => !schedIds.has(e.id)),
  };
}

/* ============================== "+Schedule" flow ==============================
 * Spec: clicking +Schedule asks "Existing Job or New Job?". Existing-job
 * search matches by customer/phone/address/job#/system/model/serial and
 * auto-populates Customer/System/Job. New-job flow selects a Customer,
 * then an existing System (or "+ Add New System" — see
 * saaSystemsCreateWithJob), then an existing open Job for that System (or
 * "+ Create New Job"). Duplicate-job prevention checks Customer+System
 * for an already-open Job before a second one is created for the same
 * System. */

/** One search box covering everything the spec's Existing Job search
 *  calls for: customer name/phone, job number, and System model/serial —
 *  in one merged, deduped result list of Jobs (each hydrated with its
 *  Customer, System, and latest Event) ready to hand straight to
 *  saaEventsCreateForJob once the office picks one. */
async function saaEventsSearchJobsForScheduling(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];

  const [{ data: byJobNumber, error: e1 }, { data: matchedCust, error: e2 }, { data: matchedSystems, error: e3 }] = await Promise.all([
    _saaClient.from("jobs").select("id").or(`job_number.ilike.%${q}%`),
    _saaClient.from("customers").select("id").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,billing_address.ilike.%${q}%`),
    _saaClient.from("systems").select("id").or(`model_number.ilike.%${q}%,serial_number.ilike.%${q}%,system_name.ilike.%${q}%,manufacturer.ilike.%${q}%`),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const custIds = (matchedCust || []).map((c) => c.id);
  const systemIds = (matchedSystems || []).map((s) => s.id);
  const [{ data: byCustomer, error: e4 }, { data: bySystem, error: e5 }] = await Promise.all([
    custIds.length ? _saaClient.from("jobs").select("id").in("customer_id", custIds) : { data: [], error: null },
    systemIds.length ? _saaClient.from("jobs").select("id").in("system_id", systemIds) : { data: [], error: null },
  ]);
  if (e4) throw e4;
  if (e5) throw e5;

  const jobIds = [...new Set([].concat(byJobNumber || [], byCustomer || [], bySystem || []).map((j) => j.id))];
  if (!jobIds.length) return [];

  const { data: jobs, error: jErr } = await _saaClient.from("jobs").select("*").in("id", jobIds);
  if (jErr) throw jErr;

  const allCustIds = [...new Set((jobs || []).map((j) => j.customer_id))];
  const allSystemIds = [...new Set((jobs || []).map((j) => j.system_id).filter(Boolean))];
  const [{ data: customers, error: c2Err }, { data: systems, error: s2Err }, { data: latestEvents, error: leErr }] = await Promise.all([
    _saaClient.from("customers").select("id,first_name,last_name,phone,billing_address,billing_city").in("id", allCustIds),
    allSystemIds.length ? _saaClient.from("systems").select("*").in("id", allSystemIds) : { data: [], error: null },
    _saaClient.from("events").select("job_id,event_number,scheduled_start").in("job_id", jobIds).order("scheduled_start", { ascending: false }),
  ]);
  if (c2Err) throw c2Err;
  if (s2Err) throw s2Err;
  if (leErr) throw leErr;

  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const systemById = Object.fromEntries((systems || []).map((s) => [s.id, s]));
  const latestEventByJob = {};
  (latestEvents || []).forEach((e) => { if (!latestEventByJob[e.job_id]) latestEventByJob[e.job_id] = e; });

  return (jobs || [])
    .map((j) => Object.assign({}, j, {
      customer: custById[j.customer_id] || null,
      system: j.system_id ? systemById[j.system_id] || null : null,
      latestEvent: latestEventByJob[j.id] || null,
    }))
    .slice(0, 15);
}

/** Duplicate-job prevention, scoped to Customer+System (per spec — NOT
 *  by job_type, unlike the older saaJobsFindDuplicateJobs in jobs-db.js
 *  which this supersedes for the new flow): is there already an open/
 *  active Job for this exact System? "Open" mirrors jobs.status's new,
 *  wider vocabulary (Round 42 schema change) — excludes completed/
 *  cancelled/closed, since a repeat visit after a Job is closed out is
 *  legitimately a new Job for that System, not a duplicate. */
const SAA_JOBS_OPEN_STATUSES = [
  "new", "lead", "quoted", "assigned", "scheduled", "in_progress",
  "open", "waiting_customer", "waiting_parts", "estimate_sent", "approved",
];
async function saaSystemsFindOpenJobForSystem(systemId, excludeJobId) {
  try {
    if (!systemId) return { ok: true, jobs: [] };
    const { data, error } = await _saaClient
      .from("jobs")
      .select("id,job_number,status,job_type,created_at")
      .eq("system_id", systemId);
    if (error) throw error;
    const openJobs = (data || []).filter((j) => j.id !== excludeJobId && SAA_JOBS_OPEN_STATUSES.includes(j.status));
    return { ok: true, jobs: openJobs };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

function _saaEventsFriendlyDbError(e) {
  const raw = (e && e.message) || String(e);
  if (/violates check constraint "events_event_type_check"/.test(raw)) {
    return "That event type isn't valid. Please try again — if this keeps happening, let the office know.";
  }
  if (/violates check constraint "events_event_status_check"/.test(raw)) {
    return "That event status isn't valid. Please try again — if this keeps happening, let the office know.";
  }
  if (/violates check constraint/.test(raw)) {
    return "That value isn't allowed for this field: " + raw.replace(/^.*constraint "/, "").replace(/".*$/, "").replace(/_/g, " ") + ".";
  }
  if (/violates foreign key constraint/.test(raw)) {
    return "That record is linked to other data and can't be changed that way.";
  }
  return raw;
}
