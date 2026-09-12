/* ============================================================
   SAA Comfort Air LLC — Dispatch Calendar data layer
   Talks to: technicians, appointment_types, jobs, customers,
   equipment, appointments, follow_ups (see database/README.md).
   Requires auth.js to have already created the shared _saaClient.

   Design note: rather than relying on supabase-js nested-select
   joins (harder to unit-test and to mock), every function here
   fetches flat rows and stitches them together in JS by id — the
   same pattern quotes-db.js already uses for Save/Retrieve Quote.
   ============================================================ */

async function saaCalFetchTechnicians() {
  const { data, error } = await _saaClient
    .from("technicians")
    .select("id,name,active")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data || [];
}

async function saaCalFetchAppointmentTypes() {
  const { data, error } = await _saaClient
    .from("appointment_types")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

function _saaCalDayBounds(dateStr) {
  const start = `${dateStr}T00:00:00`;
  const next = new Date(`${dateStr}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const y = next.getFullYear(), m = String(next.getMonth() + 1).padStart(2, "0"), d = String(next.getDate()).padStart(2, "0");
  return { start, end: `${y}-${m}-${d}T00:00:00` };
}

/**
 * Loads everything the day-dispatch view needs for one calendar date:
 * active technicians, that day's scheduled appointments, and the
 * unscheduled-jobs queue (appointments with no start_datetime yet),
 * each appointment hydrated with its job + customer + technician.
 */
async function saaCalFetchDayData(dateStr) {
  const { start, end } = _saaCalDayBounds(dateStr);

  const [{ data: scheduled, error: e1 }, { data: unscheduled, error: e2 }, technicians] = await Promise.all([
    _saaClient.from("appointments").select("*").gte("start_datetime", start).lt("start_datetime", end),
    _saaClient.from("appointments").select("*").is("start_datetime", null),
    saaCalFetchTechnicians(),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const allAppts = [].concat(scheduled || [], unscheduled || []);
  const jobIds = [...new Set(allAppts.map((a) => a.job_id).filter(Boolean))];
  const { data: jobs, error: e4 } = jobIds.length
    ? await _saaClient.from("jobs").select("*").in("id", jobIds)
    : { data: [], error: null };
  if (e4) throw e4;

  const custIds = [...new Set((jobs || []).map((j) => j.customer_id).filter(Boolean))];
  const { data: customers, error: e5 } = custIds.length
    ? await _saaClient.from("customers").select("id,first_name,last_name,phone,billing_address").in("id", custIds)
    : { data: [], error: null };
  if (e5) throw e5;

  const jobsById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const techById = Object.fromEntries((technicians || []).map((t) => [t.id, t]));

  function hydrate(a) {
    const job = jobsById[a.job_id] || {};
    const customer = custById[job.customer_id] || {};
    return Object.assign({}, a, { job, customer, technician: techById[a.technician_id] || null });
  }

  return {
    technicians: technicians || [],
    scheduled: (scheduled || []).map(hydrate),
    unscheduled: (unscheduled || []).map(hydrate),
  };
}

/**
 * Fast customer search for the New Service popup. Matches any one of
 * first name / last name / phone (partial, case-insensitive) and
 * attaches each match's most recent job + most recent equipment row
 * so the result preview can show "Last Service / Equipment / Warranty"
 * without a second round trip per click.
 */
async function saaCalSearchCustomers(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];

  const { data: customers, error } = await _saaClient
    .from("customers")
    .select("id,first_name,last_name,phone,billing_address")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(6);
  if (error) throw error;
  if (!customers || !customers.length) return [];

  const ids = customers.map((c) => c.id);
  const [{ data: jobs, error: e1 }, { data: equip, error: e2 }] = await Promise.all([
    _saaClient.from("jobs").select("id,customer_id,title,job_type,completed_date,created_at").in("customer_id", ids).order("created_at", { ascending: false }),
    _saaClient.from("equipment").select("*").in("customer_id", ids).order("created_at", { ascending: false }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const lastJobByCust = {};
  (jobs || []).forEach((j) => { if (!lastJobByCust[j.customer_id]) lastJobByCust[j.customer_id] = j; });
  const equipByCust = {};
  (equip || []).forEach((e) => { if (!equipByCust[e.customer_id]) equipByCust[e.customer_id] = e; });

  return customers.map((c) => ({ customer: c, lastJob: lastJobByCust[c.id] || null, equipment: equipByCust[c.id] || null }));
}

/**
 * Find-or-create a customer by exact first name + last name + phone —
 * same matching rule quotes-db.js uses for Save Quote, so a customer
 * created from either the calendar or a quote worksheet lands as one
 * row either way. Only used when the New Service popup's search found
 * no match and the dispatcher filled in the "new customer" mini-form.
 */
async function saaCalFindOrCreateCustomer(firstName, lastName, phone, address) {
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
    .insert({ first_name: firstName || null, last_name: lastName || null, phone: phone || null, billing_address: address || null })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return created.id;
}

/**
 * New Service popup save: creates the job and its first appointment
 * together. technicianId/startDatetime/endDatetime may be null (the
 * job lands in the Unscheduled queue). Pass either `customerId` (an
 * existing customer picked from search) or `newCustomer: {firstName,
 * lastName, phone, address}` (search found nobody, so find-or-create one).
 */
/** Pulls the plain date and HH:MM back out of one of our naive
 *  "<date>T<HH>:<MM>:00" timestamp strings (see saaCalTimeStr in
 *  calendar.js) so they can also be written onto jobs.scheduled_date /
 *  jobs.scheduled_time — that's what makes a job scheduled from the
 *  calendar show its correct Scheduled Date/Time on the Jobs List too. */
function _saaCalSplitDatetime(dtStr) {
  const m = String(dtStr || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : { date: null, time: null };
}

/** Same sequential job-number scheme as jobs-db.js's _saaJobsNextJobNumber
 *  (duplicated for the same reason every other cross-file helper here is —
 *  calendar.html doesn't load jobs-db.js) — a job created from the New
 *  Service popup gets a real J-2026-0001-style number too, not just one
 *  created from the Jobs List. */
async function _saaCalNextJobNumber() {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("job_number", `J-${year}-%`);
  if (error) throw error;
  return `J-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

async function saaCalCreateJobWithAppointment(payload) {
  try {
    let customerId = payload.customerId || null;
    if (!customerId && payload.newCustomer) {
      const nc = payload.newCustomer;
      if (!nc.firstName && !nc.lastName && !nc.phone) {
        return { ok: false, error: "Enter a first name, last name, or phone number for the new customer." };
      }
      customerId = await saaCalFindOrCreateCustomer(nc.firstName, nc.lastName, nc.phone, nc.address);
    }
    if (!customerId) return { ok: false, error: "Select or add a customer first." };

    let status = "new";
    if (payload.technicianId && payload.startDatetime) status = "scheduled";
    else if (payload.technicianId) status = "assigned";

    const { date: schedDate, time: schedTime } = _saaCalSplitDatetime(payload.startDatetime);
    const jobNumber = await _saaCalNextJobNumber();

    const { data: job, error: jErr } = await _saaClient
      .from("jobs")
      .insert({
        job_number: jobNumber,
        customer_id: customerId,
        job_type: payload.appointmentTypeKey,
        status,
        title: payload.title || "",
        priority: payload.priority || "normal",
        job_address: payload.jobAddress || null,
        assigned_technician_id: payload.technicianId || null,
        scheduled_date: schedDate,
        scheduled_time: schedTime,
        notes: payload.notes || null,
      })
      .select("id")
      .single();
    if (jErr) throw jErr;

    const { data: appt, error: aErr } = await _saaClient
      .from("appointments")
      .insert({
        job_id: job.id,
        technician_id: payload.technicianId || null,
        start_datetime: payload.startDatetime || null,
        end_datetime: payload.endDatetime || null,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (aErr) throw aErr;

    return { ok: true, jobId: job.id, appointmentId: appt.id };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Drag-and-drop reschedule: change technician, time, or both in one call. */
async function saaCalUpdateAppointmentSchedule({ appointmentId, jobId, technicianId, startDatetime, endDatetime }) {
  try {
    const { error: aErr } = await _saaClient
      .from("appointments")
      .update({
        technician_id: technicianId || null,
        start_datetime: startDatetime || null,
        end_datetime: endDatetime || null,
      })
      .eq("id", appointmentId);
    if (aErr) throw aErr;

    if (jobId) {
      const { date: schedDate, time: schedTime } = _saaCalSplitDatetime(startDatetime);
      const { error: jErr } = await _saaClient
        .from("jobs")
        .update({ assigned_technician_id: technicianId || null, status: "scheduled", scheduled_date: schedDate, scheduled_time: schedTime })
        .eq("id", jobId);
      if (jErr) throw jErr;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Status change from the Job Details drawer (drives the appointment card color). */
async function saaCalUpdateAppointmentStatus({ appointmentId, jobId, status }) {
  try {
    const { error: aErr } = await _saaClient.from("appointments").update({ status }).eq("id", appointmentId);
    if (aErr) throw aErr;

    if (jobId && (status === "completed" || status === "cancelled")) {
      const { error: jErr } = await _saaClient
        .from("jobs")
        .update({ status, completed_date: status === "completed" ? new Date().toISOString().slice(0, 10) : null })
        .eq("id", jobId);
      if (jErr) throw jErr;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Most recent equipment row on file for a customer (Job Details drawer). */
async function saaCalFetchLatestEquipment(customerId) {
  const { data, error } = await _saaClient
    .from("equipment")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/** The "extremely easy" post-job follow-up scheduling flow. */
async function saaCalCreateFollowUp(payload) {
  try {
    const { error } = await _saaClient.from("follow_ups").insert({
      job_id: payload.jobId,
      appointment_id: payload.appointmentId || null,
      follow_up_type: payload.followUpType,
      due_date: payload.dueDate || null,
      due_time: payload.dueTime || null,
      assigned_to: payload.assignedTo || "Office",
      notes: payload.notes || null,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
