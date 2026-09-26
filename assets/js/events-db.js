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

/** Round 54 (2026-09-26): maps an Event's own event_status onto the best-fit
 *  Job status (SAA_JOBS_STATUS_OPTIONS in jobs-db.js), so a Job's status
 *  always reads as a read-through from whichever Event is "current" for it
 *  (see _saaEventsSyncJobFromCurrentEvent below) instead of the two ever
 *  drifting apart, as reported by Vijayan ("Disconnect in status between
 *  different view in job card"): a Job Card's own "Job Info" status showed
 *  stale "New" for a Job whose current Event was already "Completed"
 *  elsewhere (the Calendar drawer). scheduled/confirmed/rescheduled/no_show
 *  all still mean "hasn't happened yet" from the Job's point of view, so
 *  they all map to the Job's own "scheduled". */
const SAA_EVENTSTATUS_TO_JOBSTATUS = {
  scheduled: "scheduled",
  confirmed: "scheduled",
  rescheduled: "scheduled",
  no_show: "scheduled",
  en_route: "in_progress",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

// Rough default durations per Event Type — moved here from calendar.js's
// own SAA_CAL_EVENTTYPE_DURATION (Task 120) so jobs.js's Event modal (Job
// Card field-parity, per Vijayan: "include all fields and logic in event
// cards similar to job cards") can estimate a Completed Time the same way
// saaJobsGetCompletedTime does for the Job Card, without duplicating the
// map a third time. calendar.js keeps its own same-named constant as an
// alias to this one — see the comment there — so nothing else in that
// file needed to change.
/** Round 58 (2026-09-26): events.scheduled_start/scheduled_end hold NAIVE
 *  wall-clock times (see calendar-db.js's header note) -- the app always
 *  writes "YYYY-MM-DDTHH:MM:00" with no timezone, Postgres stores that as
 *  if it were UTC, and Supabase hands it back as "...T07:30:00+00:00". The
 *  Calendar, Job read-through sync and Mileage all read it back by slicing
 *  the string, so "07:30" stays "07:30". A few Jobs-page spots instead ran
 *  it through `new Date(...)`, which honours that "+00:00" and converts to
 *  the browser's local time (Houston = UTC-5) -- so the Event card showed
 *  7:30 AM as 2:30 AM, and saving the card without touching the field wrote
 *  2:30 back, moving the Event 5 hours earlier on every Save. Every read of
 *  scheduled_start/scheduled_end outside the Calendar now goes through this.
 *  Returns { date: "YYYY-MM-DD", time: "HH:MM", local: Date } or null. */
function saaEventsWallClock(ts) {
  const m = String(ts || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    local: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]),
  };
}

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
 *  to display, it's just in the past).
 *
 *  Round 55 follow-up, per Vijayan's screenshot editing an In Progress
 *  Event's Scheduled/Completed times and finding the Job/Jobs List didn't
 *  reflect it: on a Job with several Events, an Event actually being
 *  worked (In Progress) now outranks a merely-Scheduled Event even if
 *  that other one happens to be dated further in the future -- "current"
 *  should mean "what's happening right now," not "whichever open Event
 *  has the latest date." Only breaks a tie in Vijayan's favor when an
 *  In Progress Event actually exists; with none, behavior is unchanged
 *  (latest-scheduled still-open Event, same as before). */
async function saaEventsFetchCurrentForJob(jobId) {
  const all = await saaEventsFetchForJob(jobId);
  if (!all.length) return null;
  const open = all.filter((e) => !["completed", "cancelled"].includes(e.event_status));
  if (!open.length) return all[0];
  const inProgress = open.find((e) => e.event_status === "in_progress");
  return inProgress || open[0];
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
 *  Event is now "current" for it, keeps the Job's own `status` in sync with
 *  that Event's `event_status` (Round 54 — see SAA_EVENTSTATUS_TO_JOBSTATUS
 *  above), and re-runs mileage for whichever technician slot(s) that Event
 *  has assigned.
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
    // Round 55 follow-up: the Job's "before" status/history used to be
    // fetched in a SEPARATE, later lookup -- done only when a mapped
    // status needed it, and only AFTER already committing to write
    // scheduled_date/scheduled_time/technician below. If that second
    // lookup ever came back empty or errored, the function still went
    // ahead and applied the schedule half of the patch alone, leaving the
    // Job's status stuck out of sync with its own schedule/technician --
    // exactly the "Jobs and Events" mismatch Vijayan reported (a Job
    // whose Scheduled Date matched one Event but whose Status never
    // moved off "New"). Fetching it up front, in parallel with the
    // current Event, means status and schedule/technician always move
    // together: if this fails, the whole sync bails out below instead of
    // applying half of it.
    const [current, beforeJobRes] = await Promise.all([
      saaEventsFetchCurrentForJob(jobId),
      _saaClient.from("jobs").select("status,status_history,completed_date").eq("id", jobId).single(),
    ]);
    if (!current) return;
    const { data: beforeJob, error: beforeErr } = beforeJobRes;
    if (beforeErr || !beforeJob) return;

    const patch = {
      assigned_technician_id: current.assigned_technician_id || null,
      assigned_technician_id_2: current.assigned_technician_id_2 || null,
      assigned_technician_id_3: current.assigned_technician_id_3 || null,
      scheduled_date: current.scheduled_start ? String(current.scheduled_start).slice(0, 10) : null,
      scheduled_time: current.scheduled_start ? String(current.scheduled_start).slice(11, 16) : null,
      updated_at: new Date().toISOString(),
    };

    // Round 54: fold the mapped status into the same patch, and mirror
    // saaJobsUpdateJob's own status_history/completed_date auto-stamping
    // (jobs-db.js) so a status change arriving through an Event still
    // behaves exactly like one made directly on the Job Card -- same
    // "Completed Time" tracking (see saaJobsGetCompletedTime), same
    // first-time-only completed_date stamp.
    const mappedStatus = SAA_EVENTSTATUS_TO_JOBSTATUS[current.event_status];
    if (mappedStatus) {
      patch.status = mappedStatus;
      if (mappedStatus !== beforeJob.status) {
        patch.status_history = Object.assign({}, beforeJob.status_history || {}, { [mappedStatus]: new Date().toISOString() });
      }
      if (mappedStatus === "completed" && !beforeJob.completed_date) {
        patch.completed_date = new Date().toISOString().slice(0, 10);
      }
    }

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
  const wc = event ? saaEventsWallClock(event.scheduled_start) : null;
  if (wc) {
    const start = wc.local;
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

/** Round 55: "add a separate true hard-delete option alongside Cancel" --
 *  Vijayan's explicit pick among three options offered after "allow
 *  provisions to delete events" (the existing Cancel-based soft delete,
 *  jbeDeleteCurrentEvent -> saaEventsUpdate(..., {event_status:'cancelled'}),
 *  is left completely untouched by this). This is for an Event created by
 *  outright mistake that should be gone entirely, not just hidden. Two
 *  guards protect data the rest of the app depends on:
 *   1. An Event that some Job's converted_to_event_id points at is the
 *      historical record of a real prior Job (Round 43's "one current Job
 *      per Customer+System" conversion) -- not a mistake, so it's blocked.
 *   2. A Job's only remaining Event is blocked too -- every Job needs at
 *      least one Event for _saaEventsSyncJobFromCurrentEvent and the rest
 *      of the app (Job Card, Event History, Calendar) to read a current
 *      status/schedule from. Delete the Job itself if that's really the
 *      intent.
 *  Every foreign key referencing events(id) -- invoices, job_materials,
 *  job_photos, jobs.converted_to_event_id, mileage_logs, payments, quotes,
 *  receipt_line_items -- is ON DELETE NO ACTION, so a raw DELETE would fail
 *  outright with real customer data still attached. Rather than losing that
 *  data, every dependent row is re-scoped back to the Job level (its own
 *  event_id cleared, job_id left alone) before the Event row itself is
 *  removed -- nothing but the Event's own timeline entry actually goes
 *  away. Returns { ok:true } | { ok:false, error }. */
async function saaEventsHardDelete(eventId) {
  try {
    const { data: event, error: evErr } = await _saaClient
      .from("events")
      .select("id,job_id,event_number")
      .eq("id", eventId)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return { ok: false, error: "That event no longer exists." };

    const { data: convertedFrom } = await _saaClient
      .from("jobs")
      .select("id,job_number")
      .eq("converted_to_event_id", eventId)
      .maybeSingle();
    if (convertedFrom) {
      return {
        ok: false,
        error: `This event is the historical record of job ${convertedFrom.job_number} (created when that job was converted) and can't be permanently deleted -- use Cancel instead if it needs to be hidden.`,
      };
    }

    const { data: siblingEvents, error: sibErr } = await _saaClient
      .from("events")
      .select("id")
      .eq("job_id", event.job_id);
    if (sibErr) throw sibErr;
    if ((siblingEvents || []).length <= 1) {
      return {
        ok: false,
        error: "This is the only event on this job, so it can't be permanently deleted. Delete the whole job instead, or use Cancel to hide this event.",
      };
    }

    await Promise.all([
      _saaClient.from("invoices").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("job_materials").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("job_photos").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("mileage_logs").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("payments").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("quotes").update({ event_id: null }).eq("event_id", eventId),
      _saaClient.from("receipt_line_items").update({ event_id: null }).eq("event_id", eventId),
    ]);

    const { error: delErr } = await _saaClient.from("events").delete().eq("id", eventId);
    if (delErr) throw delErr;

    await _saaEventsSyncJobFromCurrentEvent(event.job_id);
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
    // Compare wall-clock values, not raw strings -- the stored value comes
    // back as "...T07:30:00+00:00" while the new one is "...T07:30:00", so a
    // raw !== flagged every call as a reschedule even when nothing moved.
    const curWc = current ? saaEventsWallClock(current.scheduled_start) : null;
    const newWc = saaEventsWallClock(scheduledStart);
    const curKey = curWc ? `${curWc.date}T${curWc.time}` : null;
    const newKey = newWc ? `${newWc.date}T${newWc.time}` : null;
    if (current && curKey !== newKey) {
      patch.event_status = "rescheduled";
      const fromStr = curWc ? curWc.local.toLocaleString() : "unscheduled";
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

/* ============================== Round 43: "one current Job per
 * Customer+System" ==============================
 * Per Vijayan's spec: for a given Customer+System there is at most ONE
 * current Job at a time (jobs.is_current). Creating a new Job for a
 * Customer+System that already has one automatically converts the old
 * current Job into a historical Event under the brand-new Job -- every
 * field the old Job carried (financials, mileage, invoices, payments,
 * photos, BOM, quote link, inspection checklist) moves onto that Event
 * (re-pointing whichever of those were still attached directly to the
 * old Job, via its own event_id column), nothing is deleted or renamed,
 * and the old Job row itself is kept (flagged is_current=false, status
 * 'converted_to_event') for audit/history. This retires the old
 * "+ Schedule Follow-Up / + Schedule New Event" behavior of adding a
 * second/third Event under the SAME still-open Job (per Vijayan's
 * "Replace it" answer, Round 43) -- a Job is now effectively a single
 * visit, and "another visit" always means a brand-new Job. See
 * claude/round42-jobs-events-systems-phase1-schema.md (Round 43
 * section) for the full design writeup, including the
 * saa_create_job_with_conversion() Postgres function (one atomic
 * transaction, per spec item 13) that this wraps. */

/** jobs.status -> events.event_status, used only when a Job is being
 *  converted into an Event on this path -- mirrors SAA_JOBTYPE_TO_EVENTTYPE
 *  above but for status instead of type. Falls back to "completed" for
 *  anything unmapped, since a Job being converted almost always means its
 *  own work already wrapped up (a brand-new visit is starting specifically
 *  because the last one is done, not because it's still open). */
const SAA_JOBSTATUS_TO_EVENTSTATUS = {
  new: "scheduled", lead: "scheduled", quoted: "scheduled", assigned: "scheduled",
  scheduled: "scheduled", open: "scheduled", waiting_customer: "scheduled",
  waiting_parts: "scheduled", estimate_sent: "scheduled", approved: "scheduled",
  in_progress: "in_progress", completed: "completed", closed: "completed",
  cancelled: "cancelled",
};

/** Is there already a CURRENT Job (is_current=true) for this exact
 *  Customer+System? This is the Round 43 check that gates every
 *  "+ New Job" entry point's confirmation ("Creating this new Job will
 *  convert the current Job into a historical Event. Continue?") --
 *  distinct from the older saaSystemsFindOpenJobForSystem above (which
 *  only warns and lets a second OPEN job be created side-by-side; this
 *  one is the actual business rule enforcement, keyed on is_current
 *  rather than a heuristic list of "open" statuses). Returns
 *  { ok:true, job: {...} | null } | { ok:false, error }. */
async function saaSystemsFindCurrentJobForSystem(customerId, systemId) {
  try {
    if (!systemId) return { ok: true, job: null };
    const { data, error } = await _saaClient
      .from("jobs")
      .select("id,job_number,status,job_type,scheduled_date,created_at")
      .eq("customer_id", customerId)
      .eq("system_id", systemId)
      .eq("is_current", true)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, job: data || null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** The Round 43 "+ New Job" entry point for an ALREADY-EXISTING System --
 *  used by the Calendar's "+ Schedule -> New Job" tab (when an existing
 *  System is picked, not "+ Add New System") and by the Job Card's own
 *  "Start Next Job" action (Customer+System pre-filled from the Job
 *  that's about to become historical). If this Customer+System has no
 *  current Job yet (a brand-new System, or one whose only prior Job was
 *  already converted/closed out some other way), this is exactly
 *  equivalent to a plain Job insert -- the conversion only fires when one
 *  is actually found, all inside the one saa_create_job_with_conversion()
 *  transaction (never a partial "new job exists but old one wasn't
 *  converted" state). jobFields takes the same shape saaSystemsCreateWithJob's
 *  jobFields does. Also creates the new Job's own starter Event
 *  (saaEventsCreateForJob), same as every other Job-creation path in the
 *  app, so it shows up on the Dispatch Calendar immediately. Returns
 *  { ok:true, jobId, hadCurrentJob, convertedFromJobNumber,
 *  convertedToEventId, convertedToEventNumber } | { ok:false, error }. */
async function saaJobsCreateForExistingSystem(customerId, systemId, jobFields) {
  try {
    if (!customerId) return { ok: false, error: "A customer is required." };
    if (!systemId) return { ok: false, error: "A system is required." };
    const f = jobFields || {};

    const firstName = f.customerFirstName || (await _saaCustomerFirstName(customerId));
    const jobNumber = await _saaJobsNextJobNumber(firstName);

    // The old current Job's own type/status decide the mapped Event
    // Type/Status it gets converted into (resolved here in JS, reusing
    // the existing maps, rather than duplicating them a third time inside
    // the Postgres function).
    const currentRes = await saaSystemsFindCurrentJobForSystem(customerId, systemId);
    if (!currentRes.ok) return { ok: false, error: currentRes.error };
    const oldJob = currentRes.job;
    const eventNumber = oldJob ? await _saaEventsNextEventNumber() : null;
    const eventType = oldJob ? (SAA_JOBTYPE_TO_EVENTTYPE[oldJob.job_type] || "other") : null;
    const eventStatus = oldJob ? (SAA_JOBSTATUS_TO_EVENTSTATUS[oldJob.status] || "completed") : null;

    const { data: rpcData, error: rpcErr } = await _saaClient.rpc("saa_create_job_with_conversion", {
      p_customer_id: customerId,
      p_system_id: systemId,
      p_new_job: {
        job_number: jobNumber,
        job_type: f.jobType || "service_call",
        status: f.status || "new",
        title: f.title || "",
        job_address: f.jobAddress || null,
        job_city: f.jobCity || null,
        job_state: f.jobState || "TX",
        job_zip: f.jobZip || null,
        priority: f.priority || "normal",
        assigned_technician_id: f.technicianId || null,
        assigned_technician_id_2: f.technicianId2 || null,
        assigned_technician_id_3: f.technicianId3 || null,
        scheduled_date: f.scheduledDate || null,
        scheduled_time: f.scheduledTime || null,
        notes: f.notes || null,
        linked_quote_id: f.linkedQuoteId || null,
        quoted_amount: f.quotedAmount != null ? f.quotedAmount : null,
      },
      p_event_number: eventNumber,
      p_event_type: eventType,
      p_event_status: eventStatus,
    });
    if (rpcErr) throw rpcErr;

    const evRes = await saaEventsCreateForJob(rpcData.newJobId, {
      eventType: SAA_JOBTYPE_TO_EVENTTYPE[f.jobType] || "service_call",
      eventStatus: "scheduled",
      scheduledStart: f.startDatetime || null,
      scheduledEnd: f.endDatetime || null,
      technicianId: f.technicianId || null,
      technicianId2: f.technicianId2 || null,
      technicianId3: f.technicianId3 || null,
      reason: f.title || null,
    });
    if (!evRes.ok) {
      return {
        ok: true, jobId: rpcData.newJobId, hadCurrentJob: rpcData.hadCurrentJob,
        convertedFromJobId: rpcData.convertedFromJobId, convertedFromJobNumber: rpcData.convertedFromJobNumber,
        convertedToEventId: rpcData.convertedToEventId,
        warning: "Job created, but its own starter Event couldn't be scheduled: " + evRes.error,
      };
    }
    return {
      ok: true,
      jobId: rpcData.newJobId,
      starterEventId: evRes.eventId,
      hadCurrentJob: rpcData.hadCurrentJob,
      convertedFromJobId: rpcData.convertedFromJobId,
      convertedFromJobNumber: rpcData.convertedFromJobNumber,
      convertedToEventId: rpcData.convertedToEventId,
      convertedToEventNumber: eventNumber,
    };
  } catch (e) {
    return { ok: false, error: _saaEventsFriendlyDbError(e) };
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
