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
     carry an event_id now, alongside their existing job_id. Task 118
     (done — see saaEventsGetDefaultEventId below) auto-attaches every
     new one of those five to a Job's "current" Event (per Vijayan's
     "auto-pick, no new UI" answer) — jobs-db.js/bom-db.js/
     job-photos-db.js are the actual write sites that call it.
   - The old `appointments` table is left alone/deprecated — this file
     (plus calendar.js/calendar-db.js as of Task 117) supersedes it for
     all scheduling now. jobs-db.js's saaJobsSyncAppointmentSchedule
     (the Job Card's OWN direct Technician/Scheduled Date/Time fields,
     separate from any Event) still exists and still works as its own
     manual path — see _saaEventsSyncJobFromCurrentEvent's comment below
     for how that interacts with the Calendar's Event-driven scheduling.
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

// A Job's own job_type still picks from appointment_types (unchanged since
// before Round 42 — see SAA_JOBS_TYPE_OPTIONS_CURATED in jobs-db.js) so the
// Jobs List's own type filter/icons keep working exactly as before. This
// maps that same pick onto the best-fit Event Type (SAA_EVENT_TYPE_OPTIONS
// above) for a new Job's first Event, since the two vocabularies are close
// but not identical. Shared by both the Calendar's "+ Schedule" New Job tab
// (calendar.js) and the Jobs List's own "+ New Job" button (jobs.js) —
// moved here in Task 118 so both stay in sync from one definition instead
// of two copies drifting apart.
const SAA_JOBTYPE_TO_EVENTTYPE = {
  service_call: "service_call",
  repair: "repair",
  diagnostic: "diagnostic",
  tune_up: "maintenance",
  estimate: "estimate_visit",
  manual_j: "other",
  installation: "installation",
  follow_up: "follow_up",
  return_visit: "follow_up",
  emergency: "service_call",
  inspection: "inspection",
};

function saaEventTypeLabel(key) { return SAA_EVENT_TYPE_LABELS[key] || key || "—"; }
function saaEventStatusLabel(key) { return SAA_EVENT_STATUS_LABELS[key] || key || "—"; }

// Rough default durations per Event Type — moved here from calendar.js's
// own SAA_CAL_EVENTTYPE_DURATION (Task 120) so jobs.js's Event modal (Job
// Card field-parity, per Vijayan: "include all fields and logic in event
// cards similar to job cards") can estimate a Completed Time the same way
// saaJobsGetCompletedTime does for the Job Card, without duplicating the
// map a third time. calendar.js keeps its own same-named constant as an
// alias to this one — see the comment there — so nothing else in that
// file needed to change.
const SAA_EVENT_TYPE_DURATION = {
  service_call: 60, diagnostic: 60, repair: 90, maintenance: 60,
  estimate_visit: 45, installation: 480, follow_up: 15,
  warranty_visit: 60, inspection: 45, customer_callback: 15, other: 60,
};

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

/* ============================== Round 42 Task 118: event-level financial data ==============================
 * Per Vijayan's "auto-pick, no new UI" answer: invoices/payments/BOM/
 * photos/mileage attach to a Job's "current" Event automatically — a
 * single-Event Job (still the common case) is unambiguous, and a
 * multi-Event Job attaches to whichever Event saaEventsFetchCurrentForJob
 * already treats as current (its most recently scheduled still-open
 * Event, or its single most recent Event if every Event is closed out —
 * same definition the Job Detail page's own "current event" concept
 * uses, so there's exactly one notion of "the current event" across the
 * app, not two competing ones). No dropdown, no extra step for the
 * office — if the guess is ever wrong for a multi-Event job, the record
 * can be re-pointed by hand later (Phase 2 territory, not this pass). */

/** Returns just the id, for callers (invoices/payments/BOM/photos) that
 *  only need to stamp event_id onto a new row and don't need the rest of
 *  the Event's fields. null when the Job has no Events at all (shouldn't
 *  normally happen post-migration, but every System/Job is always
 *  created with a first Event — see saaSystemsCreateWithJob /
 *  saaCalScheduleNewJob — so this is just defensive). */
async function saaEventsGetDefaultEventId(jobId) {
  try {
    const current = await saaEventsFetchCurrentForJob(jobId);
    return current ? current.id : null;
  } catch (e) {
    return null;
  }
}

/** Keeps a Job's own (legacy, pre-Round-42) `assigned_technician_id[_2/_3]`
 *  / `scheduled_date` / `scheduled_time` columns in sync with whichever
 *  Event is now "current" for it, and re-runs mileage for whichever
 *  technician slot(s) that Event has assigned.
 *
 *  Why this exists: those Job columns are what the Jobs List's own
 *  Scheduled/Technician columns display, and what mileage-db.js has
 *  always read from (mileage was never actually wired to `appointments`
 *  or `events` directly — see saaMileageRecalcForJob) — before Round 42,
 *  the Calendar's own drag-and-drop wrote straight through to these same
 *  Job columns (the old saaCalUpdateAppointmentSchedule, removed in Task
 *  117). Task 117 deliberately stopped a drag from touching the Job row
 *  at all (per spec: an Event's reassignment only ever changes that
 *  Event), which was correct for Customer/System/history, but as a side
 *  effect silently orphaned these particular columns — a job's Scheduled/
 *  Technician columns on the Jobs List, and its mileage, simply stopped
 *  updating on drag, and a brand-new Calendar-created job never got them
 *  populated on its own row at all. This restores that sync, but as a
 *  read-through from the Event (never the other way — an Event's own
 *  fields are always the source of truth now), and keyed off whichever
 *  Event is "current" (see saaEventsFetchCurrentForJob) so an edit to an
 *  old, no-longer-current Event can't clobber a Job's live schedule.
 *  Best-effort and silent, same philosophy as saaMileageEnsureForJob —
 *  never blocks or throws back into the Calendar/Job Card action that
 *  triggered it. */
async function _saaEventsSyncJobFromCurrentEvent(jobId) {
  try {
    if (!jobId) return;
    const current = await saaEventsFetchCurrentForJob(jobId);
    if (!current) return;

    const patch = {
      assigned_technician_id: current.assigned_technician_id || null,
      assigned_technician_id_2: current.assigned_technician_id_2 || null,
      assigned_technician_id_3: current.assigned_technician_id_3 || null,
      scheduled_date: current.scheduled_start ? String(current.scheduled_start).slice(0, 10) : null,
      scheduled_time: current.scheduled_start ? String(current.scheduled_start).slice(11, 16) : null,
      updated_at: new Date().toISOString(),
    };
    const { data: job, error } = await _saaClient.from("jobs").update(patch).eq("id", jobId).select("*").single();
    if (error || !job) return;

    if (typeof saaMileageEnsureForJob !== "function") return;
    // One technician slot is by far the common case; Round 25's
    // multi-technician support means an Event (like a Job before it) can
    // have up to three, and each gets its own mileage_logs row/leg-chain.
    if (job.assigned_technician_id) saaMileageEnsureForJob(job, job.assigned_technician_id);
    if (job.assigned_technician_id_2) saaMileageEnsureForJob(job, job.assigned_technician_id_2);
    if (job.assigned_technician_id_3) saaMileageEnsureForJob(job, job.assigned_technician_id_3);
  } catch (e) {
    // Best-effort — see function comment above.
  }
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
        // Round 42 Task 120 (Job Card field-parity): Priority reuses the
        // same 4-value vocabulary as jobs.priority (SAA_JOBS_PRIORITY_OPTIONS
        // in jobs-db.js) — the Event modal always sends an explicit value
        // (defaulted from the parent Job at modal-open time, same pattern
        // as its Technician field), so this fallback only matters for any
        // other future caller that omits it.
        priority: fields.priority || "normal",
        service_address: fields.serviceAddress || null,
        service_city: fields.serviceCity || null,
        service_state: fields.serviceState || null,
        service_zip: fields.serviceZip || null,
      })
      .select("id")
      .single();
    if (eErr) throw eErr;
    await _saaEventsSyncJobFromCurrentEvent(job.id);
    return { ok: true, eventId: event.id, eventNumber };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Round 42 Task 120 (Job Card field-parity) — best-available "completed
 *  time" for an Event, same idea as saaJobsGetCompletedTime in jobs-db.js
 *  but simplified for events' single completed_at timestamptz column
 *  (Jobs split this across completed_date + status_history.completed;
 *  Events never had two columns to split, so there's nothing to merge):
 *   1) completed_at, when set — shown as the confirmed local date+time.
 *   2) otherwise, for any Event with a Scheduled Date/Time, an ESTIMATE of
 *      when the visit should wrap up: scheduled_start plus that Event
 *      Type's usual duration (SAA_EVENT_TYPE_DURATION above) — flagged so
 *      the UI can label it "(estimated)" until confirmed/edited or the
 *      Event is actually marked Completed.
 *  Returns { date: "YYYY-MM-DD"|"", time: "HH:MM"|"", isEstimate: bool }. */
async function saaEventsGetCompletedTime(event) {
  const pad = (n) => String(n).padStart(2, "0");
  if (event && event.completed_at) {
    const d = new Date(event.completed_at);
    if (!isNaN(d.getTime())) {
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        isEstimate: false,
      };
    }
  }
  if (event && event.scheduled_start) {
    const start = new Date(event.scheduled_start);
    if (!isNaN(start.getTime())) {
      const duration = SAA_EVENT_TYPE_DURATION[event.event_type] || 60;
      const end = new Date(start.getTime() + duration * 60000);
      return {
        date: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
        time: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        isEstimate: true,
      };
    }
  }
  return { date: "", time: "", isEstimate: false };
}

/** Manually set/override an Event's recorded completed date+time (mirrors
 *  saaJobsSetCompletedTime's "allow provision to update ... if required"),
 *  writing straight into completed_at as a single timestamp built from the
 *  given date+time — simpler than the Job version since there's only one
 *  column here, not a status_history sub-object to merge into.
 *  Returns { ok: true } | { ok: false, error }. */
async function saaEventsSetCompletedTime(eventId, dateStr, hhmm) {
  try {
    if (!dateStr || !hhmm) return { ok: false, error: "Both a completed date and time are required." };
    const iso = new Date(`${dateStr}T${hhmm}:00`).toISOString();
    const { error } = await _saaClient.from("events").update({ completed_at: iso, updated_at: new Date().toISOString() }).eq("id", eventId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Generic partial update, used by the Event detail view for everything
 *  from a status change to filling in technician/customer notes, work
 *  performed, parts used, or a customer signature. Auto-stamps
 *  completed_at the first time event_status flips to Completed — same
 *  convention as saaJobsUpdateJob's completed_date auto-stamp. Never
 *  moves this Event to a different Job/System/Customer (there's no
 *  "reassign to another Job" action — an Event is fixed to the Job it
 *  was created under). A status change that could shift which Event now
 *  counts as this Job's "current" one does read-through to the Job row's
 *  own schedule/technician columns — see _saaEventsSyncJobFromCurrentEvent
 *  below and its call site here. */
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
    // A status change (e.g. marking the current Event Completed) can
    // change which Event now counts as "current" for the Job — only
    // worth the extra round-trip/mileage-recalc when event_status is
    // actually part of this patch, not on every minor detail edit (work
    // performed, notes, signature, etc. don't affect which Event is
    // current, and mileage recalculation hits a rate-limited external
    // geocoding service, so it's not free to run on every keystroke-save).
    if (patch.event_status) {
      const { data: ev } = await _saaClient.from("events").select("job_id").eq("id", eventId).maybeSingle();
      if (ev && ev.job_id) await _saaEventsSyncJobFromCurrentEvent(ev.job_id);
    }
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
    const { data: ev } = await _saaClient.from("events").select("job_id").eq("id", eventId).maybeSingle();
    if (ev && ev.job_id) await _saaEventsSyncJobFromCurrentEvent(ev.job_id);
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
    // Round 42 Task 118: this is a drag/resize/reassign of an EXISTING
    // Event — restores the Job-level schedule/technician sync (and the
    // mileage recalculation that rides on it) that Task 117 intentionally
    // stopped doing directly against the Job row. See
    // _saaEventsSyncJobFromCurrentEvent's own comment for why this is a
    // read-through from the Event rather than the old appointment-era
    // "the drag writes the Job row itself" behavior.
    const { data: ev } = await _saaClient.from("events").select("job_id").eq("id", eventId).maybeSingle();
    if (ev && ev.job_id) await _saaEventsSyncJobFromCurrentEvent(ev.job_id);
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
    ? await _saaClient.from("jobs").select("id,job_number,job_type,job_address,job_city,title,priority").in("id", jobIds)
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

/** Round 42 Task 122: per-Event quote linking -- mirrors saaJobsLinkQuote
 *  (jobs-db.js) but writes events.linked_quote_id instead of the Job's own
 *  linked_quote_id, and stamps the two-way link on quotes.event_id (added
 *  by the Round 42 Task 121 migration) rather than quotes.job_id. Per
 *  Vijayan: "Per-Event quote linking" -- each Event gets its own linked
 *  Quote, separate from (and in addition to) the Job's own Quote link. */
async function saaEventsLinkQuote(eventId, quoteId) {
  try {
    const { data: quote, error: qErr } = await _saaClient
      .from("quotes")
      .select("total,material_cost,labor_cost,other_cost")
      .eq("id", quoteId)
      .single();
    if (qErr) throw qErr;
    const { error } = await _saaClient
      .from("events")
      .update({ linked_quote_id: quoteId, quoted_amount: quote.total || 0, updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    // Keep the link two-way, same pattern as saaJobsLinkQuote's own quotes.job_id stamp.
    await _saaClient.from("quotes").update({ event_id: eventId }).eq("id", quoteId);
    // material_cost/labor_cost/other_cost are null on quotes saved before
    // those columns existed -- callers should treat a null here as "no
    // breakdown available" rather than a real $0 (same caveat as saaJobsLinkQuote).
    return {
      ok: true,
      quotedAmount: quote.total || 0,
      materialCost: quote.material_cost,
      laborCost: quote.labor_cost,
      otherCost: quote.other_cost,
    };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** The reverse of saaEventsLinkQuote -- clears the Event's link to a Quote
 *  without touching its own Quoted Amount (a separately-editable field the
 *  office may have already adjusted) and without deleting the quote
 *  itself. Frees the quote's own event_id back to null (mirrors
 *  saaJobsUnlinkQuote's cleanup of quotes.job_id) so it's available to
 *  link to a different event, or this same one again, later. */
async function saaEventsUnlinkQuote(eventId, quoteId) {
  try {
    const { error } = await _saaClient
      .from("events")
      .update({ linked_quote_id: null, updated_at: new Date().toISOString() })
      .eq("id", eventId);
    if (error) throw error;
    if (quoteId) {
      await _saaClient.from("quotes").update({ event_id: null }).eq("id", quoteId).eq("event_id", eventId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}

/** Fetches the Event's most recent invoice, or creates a Draft one if none
 *  exists yet -- mirrors saaJobsGetOrCreateInvoice (jobs-db.js) but keyed
 *  on event_id, so each Event gets its own Invoice/Payment history rather
 *  than sharing the Job's. amount defaults to the Event's own Approved
 *  Amount, falling back to its own Quoted Amount (both per-Event columns
 *  as of the Round 42 Task 121 migration), so "Generate Invoice" on the
 *  Event modal works with one click, same as the Job Card. Events already
 *  carry their own customer_id (stamped at creation -- see
 *  saaEventsCreateForJob above), so no join back to the parent Job is
 *  needed here. Relies on jobs-db.js's _saaJobsNextInvoiceNumber /
 *  _saaCustomerFirstName (plain global functions, script-order-independent
 *  as long as this isn't called before jobs-db.js has finished loading --
 *  true everywhere this is used, i.e. after the page's initial load). */
async function saaEventsGetOrCreateInvoice(event) {
  try {
    const { data: existing, error: findErr } = await _saaClient
      .from("invoices")
      .select("*")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (findErr) throw findErr;
    if (existing && existing.length) return { ok: true, invoice: existing[0], created: false };

    const amount = Number(event.approved_amount || event.quoted_amount || 0);
    const firstNameForNumber = event.customer ? event.customer.first_name : await _saaCustomerFirstName(event.customer_id);
    const invoiceNumber = await _saaJobsNextInvoiceNumber(firstNameForNumber);
    const { data: created, error: createErr } = await _saaClient
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        job_id: event.job_id || null,
        event_id: event.id,
        quote_id: event.linked_quote_id || null,
        customer_id: event.customer_id,
        amount_total: amount,
        status: "draft",
        due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      })
      .select("*")
      .single();
    if (createErr) throw createErr;
    return { ok: true, invoice: created, created: true };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
  }
}
