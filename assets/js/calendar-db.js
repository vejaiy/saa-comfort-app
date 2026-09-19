/* ============================================================
   SAA Comfort Air LLC — Dispatch Calendar data layer
   Talks to: technicians, appointment_types, jobs, systems, events,
   customers, equipment (see database/README.md).
   Requires auth.js to have already created the shared _saaClient.

   Round 42 (2026-09-19), Task 117: the Calendar now schedules/
   displays/drags EVENTS, not the old `appointments` table — see
   events-db.js for saaEventsFetchForCalendarRange (day/week/month +
   unscheduled queue, replacing this file's old saaCalFetchDayData/
   RangeData/Unscheduled), saaEventsUpdateAssignment (drag-and-drop,
   replacing saaCalUpdateAppointmentSchedule), and saaEventsUpdate
   (status changes, replacing saaCalUpdateAppointmentStatus). The
   `appointments` table itself is left alone/deprecated, same as
   Phase 1's other tables — nothing here writes to it anymore.

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

/** Same sequential job-number scheme as jobs-db.js's _saaJobsNextJobNumber
 *  (duplicated for the same reason every other cross-file helper here is —
 *  calendar.html doesn't load jobs-db.js) — a job created from the "+
 *  Schedule" popup gets a real J-2026-0001-style number too, not just one
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

/**
 * "+ Schedule" popup save, New Job tab: resolves/creates the Customer,
 * then either attaches a brand-new Job to an EXISTING System
 * (payload.systemId set — no new System row) or creates a new System AND
 * its Job together via saaSystemsCreateWithJob (systems-db.js), then
 * creates that Job's first Event via saaEventsCreateForJob (events-db.js).
 * technicianId/startDatetime/endDatetime may be null (the Event lands in
 * the Unscheduled queue). Pass either `customerId` (an existing customer
 * picked from search) or `newCustomer: {firstName, lastName, phone,
 * address, city, zip}` (search found nobody, so find-or-create one).
 */
async function saaCalScheduleNewJob(payload) {
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

    const firstNameForNumber = (payload.newCustomer && payload.newCustomer.firstName) || (await _saaCustomerFirstName(customerId));
    let jobId, systemId;

    if (payload.systemId) {
      // Existing System picked -- a new Job attaches to it directly (no
      // second System row for the same physical equipment).
      const jobNumber = await _saaCalNextJobNumber(firstNameForNumber);
      const { data: job, error: jErr } = await _saaClient
        .from("jobs")
        .insert({
          job_number: jobNumber,
          customer_id: customerId,
          system_id: payload.systemId,
          job_type: payload.jobType,
          status: "new",
          title: payload.title || "",
          priority: payload.priority || "normal",
          job_address: payload.jobAddress || null,
          job_city: payload.jobCity || null,
          job_state: "TX",
          job_zip: payload.jobZip || null,
        })
        .select("id")
        .single();
      if (jErr) throw jErr;
      jobId = job.id;
      systemId = payload.systemId;
    } else {
      // New System (an office-typed name, or just "System" as a
      // placeholder to fill in later from the Job Card) -- created
      // together with its one permanent Job, per spec.
      const sysRes = await saaSystemsCreateWithJob(
        customerId,
        { systemName: payload.systemName || "System", systemType: payload.systemType || null, manufacturer: payload.manufacturer || null, tonnage: payload.tonnage || null },
        {
          jobType: payload.jobType, title: payload.title || "", priority: payload.priority || "normal",
          jobAddress: payload.jobAddress || null, jobCity: payload.jobCity || null, jobZip: payload.jobZip || null,
          customerFirstName: firstNameForNumber,
        }
      );
      if (!sysRes.ok) return sysRes;
      jobId = sysRes.jobId;
      systemId = sysRes.systemId;
    }

    const evRes = await saaEventsCreateForJob(jobId, {
      eventType: payload.eventType || "service_call",
      eventStatus: "scheduled",
      scheduledStart: payload.startDatetime || null,
      scheduledEnd: payload.endDatetime || null,
      technicianId: payload.technicianId || null,
      reason: payload.title || null,
    });
    if (!evRes.ok) return evRes;

    // Round 42 Task 118: saaEventsCreateForJob (above) now handles both
    // the Job-row schedule/technician sync AND the mileage recalculation
    // itself via _saaEventsSyncJobFromCurrentEvent — this used to be done
    // here as an in-memory-only saaMileageEnsureForJob call (Task 117),
    // which computed a mileage number but never actually wrote
    // scheduled_date/scheduled_time/assigned_technician_id onto the Job
    // row itself, so a Calendar-created job's own Jobs-List "Scheduled"/
    // "Technician" columns stayed blank even though mileage looked right.

    return { ok: true, jobId, systemId, eventId: evRes.eventId };
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
