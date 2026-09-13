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

/** Attaches job + customer + technician to a flat list of appointment
 *  rows — shared by the day/week/month/unscheduled fetchers below so
 *  the join-in-JS logic lives in exactly one place. */
async function _saaCalHydrateAppts(rawAppts, technicians) {
  const jobIds = [...new Set((rawAppts || []).map((a) => a.job_id).filter(Boolean))];
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

  return (rawAppts || []).map((a) => {
    const job = jobsById[a.job_id] || {};
    const customer = custById[job.customer_id] || {};
    return Object.assign({}, a, { job, customer, technician: techById[a.technician_id] || null });
  });
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

  const hydrated = await _saaCalHydrateAppts([].concat(scheduled || [], unscheduled || []), technicians);
  const schedIds = new Set((scheduled || []).map((a) => a.id));
  return {
    technicians: technicians || [],
    scheduled: hydrated.filter((a) => schedIds.has(a.id)),
    unscheduled: hydrated.filter((a) => !schedIds.has(a.id)),
  };
}

/**
 * Loads scheduled appointments for an arbitrary date range
 * [startDateStr, endDateStrExclusive) — backs the Week and Month views,
 * which show many days at once instead of one day's technician tracks.
 * Doesn't include the Unscheduled queue (those have no date to place them
 * in a range) — see saaCalFetchUnscheduled for that.
 */
async function saaCalFetchRangeData(startDateStr, endDateStrExclusive) {
  const start = `${startDateStr}T00:00:00`;
  const end = `${endDateStrExclusive}T00:00:00`;
  const [{ data: scheduled, error: e1 }, technicians] = await Promise.all([
    _saaClient.from("appointments").select("*").gte("start_datetime", start).lt("start_datetime", end),
    saaCalFetchTechnicians(),
  ]);
  if (e1) throw e1;
  return { technicians: technicians || [], scheduled: await _saaCalHydrateAppts(scheduled || [], technicians) };
}

/** Just the Unscheduled Jobs queue, hydrated — used by Week/Month views
 *  (which fetch scheduled appointments a different way than Day view's
 *  saaCalFetchDayData) so the queue still shows regardless of view. */
async function saaCalFetchUnscheduled() {
  const [{ data: unscheduled, error: e2 }, technicians] = await Promise.all([
    _saaClient.from("appointments").select("*").is("start_datetime", null),
    saaCalFetchTechnicians(),
  ]);
  if (e2) throw e2;
  return await _saaCalHydrateAppts(unscheduled || [], technicians);
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
    .select("id,first_name,last_name,phone,billing_address,billing_city,billing_zip")
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

/** Digits-only comparison key for phone numbers -- see the identical helper
 *  in quotes-db.js/jobs-db.js for why this replaced exact-string matching
 *  (round 12 follow-up, 2026-09-13). */
function _saaCalPhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Find-or-create a customer by first name + last name plus a
 * normalized-phone match — same matching rule quotes-db.js uses for Save
 * Quote, so a customer created from either the calendar or a quote
 * worksheet lands as one row either way. Only used when the New Service
 * popup's search found no match and the dispatcher filled in the "new
 * customer" mini-form. Backfills an existing matched customer's blank
 * address/city/zip when new values are provided.
 */
async function saaCalFindOrCreateCustomer(firstName, lastName, phone, address, city, zip) {
  const { data: candidates, error: findErr } = await _saaClient
    .from("customers")
    .select("id,phone,billing_address,billing_city,billing_zip")
    .eq("first_name", firstName || "")
    .eq("last_name", lastName || "");
  if (findErr) throw findErr;
  const phoneKey = _saaCalPhoneKey(phone);
  const existing = (candidates || []).find((c) => _saaCalPhoneKey(c.phone) === phoneKey);
  if (existing) {
    const patch = {};
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
    .insert({ first_name: firstName || null, last_name: lastName || null, phone: phone || null, billing_address: address || null, billing_city: city || null, billing_zip: zip || null })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return created.id;
}

/** Update an existing customer's own record — used by the New Service
 *  popup's inline "Edit" action on a search result (round 12 follow-up,
 *  2026-09-13: "Add edit button to edit customer information").
 *  returns: { ok: true } | { ok: false, error } */
async function saaCalUpdateCustomer(customerId, { firstName, lastName, phone, address, city, zip }) {
  try {
    const { error } = await _saaClient
      .from("customers")
      .update({
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        billing_address: address || null,
        billing_city: city || null,
        billing_zip: zip || null,
      })
      .eq("id", customerId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Delete a customer record outright — used by the New Service popup's
 *  inline "Delete" action, explicitly so the office can clean up duplicate
 *  customer rows ("delete option to delete customer or duplicate customers
 *  no more" — round 12 follow-up, 2026-09-13). A customer with any jobs,
 *  quotes, invoices, equipment, payments, or memberships on file can't be
 *  deleted outright (would orphan real records) — the caller should offer
 *  "Merge into another customer" for that case instead of a bare delete.
 *  returns: { ok: true } | { ok: false, error, blocked: true, counts } */
async function saaCalDeleteCustomer(customerId) {
  try {
    const [{ count: jobCt }, { count: quoteCt }, { count: invCt }, { count: eqCt }] = await Promise.all([
      _saaClient.from("jobs").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
      _saaClient.from("quotes").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
      _saaClient.from("invoices").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
      _saaClient.from("equipment").select("id", { count: "exact", head: true }).eq("customer_id", customerId),
    ]);
    const total = (jobCt || 0) + (quoteCt || 0) + (invCt || 0) + (eqCt || 0);
    if (total > 0) {
      return { ok: false, blocked: true, counts: { jobs: jobCt || 0, quotes: quoteCt || 0, invoices: invCt || 0, equipment: eqCt || 0 },
        error: `This customer has ${jobCt || 0} job(s), ${quoteCt || 0} quote(s), ${invCt || 0} invoice(s), and ${eqCt || 0} equipment record(s) on file — delete or reassign those first.` };
    }
    const { error } = await _saaClient.from("customers").delete().eq("id", customerId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Merge one customer record into another — repoints every job, quote,
 *  invoice, equipment, payment, and membership row from `fromId` to
 *  `toId`, then deletes the now-empty `fromId` row. Used by the New
 *  Service popup's duplicate-cleanup flow when Delete is blocked because
 *  the "duplicate" actually has records on file (the real fix for
 *  "duplicate customers no more" — deleting a duplicate with real jobs on
 *  it would orphan them, so those get folded into the kept record instead).
 *  returns: { ok: true } | { ok: false, error } */
async function saaCalMergeCustomers(fromId, toId) {
  try {
    if (fromId === toId) return { ok: false, error: "Can't merge a customer into itself." };
    const tables = ["jobs", "quotes", "invoices", "equipment", "payments", "customer_memberships"];
    for (const t of tables) {
      const { error } = await _saaClient.from(t).update({ customer_id: toId }).eq("customer_id", fromId);
      if (error) throw error;
    }
    const { error: delErr } = await _saaClient.from("customers").delete().eq("id", fromId);
    if (delErr) throw delErr;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
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
async function _saaCalNextJobNumber(firstName) {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .like("job_number", `J-${year}-%`);
  if (error) throw error;
  const base = `J-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

async function saaCalCreateJobWithAppointment(payload) {
  try {
    let customerId = payload.customerId || null;
    if (!customerId && payload.newCustomer) {
      const nc = payload.newCustomer;
      if (!nc.firstName && !nc.lastName && !nc.phone) {
        return { ok: false, error: "Enter a first name, last name, or phone number for the new customer." };
      }
      customerId = await saaCalFindOrCreateCustomer(nc.firstName, nc.lastName, nc.phone, nc.address, nc.city, nc.zip);
    }
    if (!customerId) return { ok: false, error: "Select or add a customer first." };

    let status = "new";
    if (payload.technicianId && payload.startDatetime) status = "scheduled";
    else if (payload.technicianId) status = "assigned";

    const { date: schedDate, time: schedTime } = _saaCalSplitDatetime(payload.startDatetime);
    // jobs-db.js is loaded on every page calendar-db.js is (see gen_calendar.py),
    // so its _saaCustomerFirstName lookup helper is reused here rather than
    // duplicated, unlike _saaCalNextJobNumber above.
    const firstNameForNumber = (payload.newCustomer && payload.newCustomer.firstName) || (await _saaCustomerFirstName(customerId));
    const jobNumber = await _saaCalNextJobNumber(firstNameForNumber);

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
        // Round 7: the New Service popup only ever collects one freeform
        // Address field, but the Job Card shows City/State/ZIP as
        // separate fields -- without these, City/ZIP always came up
        // blank on a calendar-created job even when the office had typed
        // a full address, since there was nowhere for that to land.
        job_city: payload.jobCity || null,
        job_state: "TX",
        job_zip: payload.jobZip || null,
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

    // Round 11 follow-up (2026-09-13): "save miles for every job" -- see
    // the matching comment in jobs-db.js's saaJobsCreateJob. Fire-and-forget.
    if (typeof saaMileageEnsureForJob === "function") {
      saaMileageEnsureForJob({
        id: job.id,
        assigned_technician_id: payload.technicianId || null,
        scheduled_date: schedDate,
        scheduled_time: schedTime,
        job_address: payload.jobAddress || null,
        job_city: payload.jobCity || null,
        job_state: "TX",
        job_zip: payload.jobZip || null,
      });
    }

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

      // Round 11 follow-up (2026-09-13): a drag-and-drop reschedule changes
      // which day/technician/leg-order a job's mileage belongs under, so
      // its auto leg (never a manually-set one -- saaMileageRecalcForJob's
      // own guard handles that) is refreshed to match right away rather
      // than being left pointing at the old day. Needs the job's address,
      // which isn't part of this payload, so it's re-fetched fresh.
      if (typeof saaMileageEnsureForJob === "function") {
        const { data: freshJob } = await _saaClient
          .from("jobs")
          .select("id,assigned_technician_id,scheduled_date,scheduled_time,job_address,job_city,job_state,job_zip")
          .eq("id", jobId)
          .maybeSingle();
        if (freshJob) saaMileageEnsureForJob(freshJob);
      }
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

    if (jobId) {
      // Round 6: keep the job's own status (and its per-status timestamp
      // history, for technician-timing reporting) in sync with EVERY
      // calendar status change, not just Completed/Cancelled — the Jobs
      // page reads jobs.status directly, so a status set only here would
      // otherwise drift from what the calendar shows. Fetch-then-merge
      // because a jsonb merge isn't expressible through the query builder's
      // .update() — keep this in sync with saaJobsUpdateJob's copy of the
      // same logic in jobs-db.js.
      const { data: current, error: curErr } = await _saaClient
        .from("jobs")
        .select("status,status_history")
        .eq("id", jobId)
        .single();
      if (curErr) throw curErr;
      const patch = { status };
      if (status === "completed") patch.completed_date = new Date().toISOString().slice(0, 10);
      if (status === "cancelled") patch.completed_date = null;
      if (current && status !== current.status) {
        patch.status_history = Object.assign({}, current.status_history || {}, { [status]: new Date().toISOString() });
      }
      const { error: jErr } = await _saaClient.from("jobs").update(patch).eq("id", jobId);
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
