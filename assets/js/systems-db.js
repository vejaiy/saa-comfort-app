/* ============================================================
   SAA Comfort Air LLC — HVAC Systems data layer (Round 42)
   Backs the "Customer -> System -> Job -> Event" architecture:
   a System is one physical piece of HVAC equipment (or matched
   condenser/coil/furnace set) installed at a customer's property.
   Every System has its own permanent Job (see jobs-db.js /
   events-db.js), which in turn holds unlimited Events (visits).

   Design notes:
   - Same flat-fetch-then-stitch-in-JS pattern as jobs-db.js /
     calendar-db.js (easier to unit-test/mock than nested selects).
   - A customer can have multiple Systems (e.g. an upstairs and a
     downstairs unit) — each gets its own row here and its own Job,
     never shared. Two Systems for the same customer are never the
     same Job, even if created back-to-back (see the 7 acceptance
     scenarios in the Round 42 spec).
   - The historical 20 jobs were migrated 1 System-per-Job (see
     phase1_backfill_systems_events / round42_consolidate_multivisit_jobs
     in claude/round42-jobs-events-systems-phase1-schema.md) — most
     migrated Systems are still just named "System" with no other
     details filled in. Filling those in is optional office cleanup,
     not required for the app to work.
   ============================================================ */

/** Curated System Type list — the spec's own field list (type,
 *  manufacturer, model, serial, tonnage, refrigerant, install date,
 *  location, orientation, indoor/outdoor unit, coil, furnace/air
 *  handler, warranty info) doesn't pin down an exact vocabulary, so
 *  this is a reasonable residential-HVAC default set. Stored as free
 *  text on systems.system_type (no DB CHECK constraint), so picking
 *  "Other" and typing a custom value is always safe. */
const SAA_SYSTEM_TYPE_OPTIONS = [
  "Split System (Condenser + Coil + Furnace/Air Handler)",
  "Heat Pump Split System",
  "Package Unit",
  "Package Heat Pump",
  "Mini-Split / Ductless",
  "Furnace + Coil Only (no outdoor unit yet)",
  "Other",
];

const SAA_SYSTEM_ORIENTATION_OPTIONS = ["Upflow", "Downflow", "Horizontal"];

/** Every System on file for one customer, newest first — backs the
 *  Customer page's "Systems" section (each row shows its own Job #
 *  and latest Event date, per the spec) and the New Job / +Schedule
 *  flow's "pick an existing System, or + Add New System" step. */
async function saaSystemsFetchByCustomer(customerId) {
  const { data, error } = await _saaClient
    .from("systems")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function saaSystemsFetchById(systemId) {
  if (!systemId) return null;
  const { data, error } = await _saaClient.from("systems").select("*").eq("id", systemId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Every System for a customer, each hydrated with its Job (id, number,
 *  status) and that Job's most recent Event date — exactly the "Job # /
 *  latest Event date" pair the spec's Customer page calls for. A System
 *  created but never given a Job yet (shouldn't normally happen — see
 *  saaSystemsCreateWithJob below, which always creates both together)
 *  comes back with job: null. */
async function saaSystemsFetchByCustomerWithJobs(customerId) {
  const systems = await saaSystemsFetchByCustomer(customerId);
  if (!systems.length) return [];
  const systemIds = systems.map((s) => s.id);
  const { data: jobs, error: jErr } = await _saaClient
    .from("jobs")
    .select("id,job_number,status,job_type,system_id")
    .in("system_id", systemIds);
  if (jErr) throw jErr;
  const jobBySystem = Object.fromEntries((jobs || []).map((j) => [j.system_id, j]));
  const jobIds = (jobs || []).map((j) => j.id);
  const { data: events, error: eErr } = jobIds.length
    ? await _saaClient.from("events").select("job_id,scheduled_start").in("job_id", jobIds).order("scheduled_start", { ascending: false })
    : { data: [], error: null };
  if (eErr) throw eErr;
  const latestEventByJob = {};
  (events || []).forEach((e) => { if (!latestEventByJob[e.job_id]) latestEventByJob[e.job_id] = e.scheduled_start; });
  return systems.map((s) => {
    const job = jobBySystem[s.id] || null;
    return Object.assign({}, s, { job, latestEventDate: job ? latestEventByJob[job.id] || null : null });
  });
}

/** Creates a brand-new System AND its one permanent Job together in one
 *  call — per the spec, a System is never created without a Job, and a
 *  Job is never created without picking (or just having created) a
 *  System first. This is the "+ Add New System" step of the New Job /
 *  +Schedule flow, AND (Round 42 Task 118) the Jobs List's own "+ New
 *  Job" button (jbSaveNewJob in jobs.js) — that flow used to call the
 *  older saaJobsCreateJob directly, which never created a System or an
 *  Event at all, so a job made that way had an empty System section, an
 *  empty Event History, and — since the Calendar reads from `events`,
 *  not `jobs`/`appointments` — was invisible on the Dispatch Calendar
 *  entirely, forever. jobFields accepts the full set of fields either
 *  caller needs on the new Job (job_type/title/address/priority/
 *  technician assignment/schedule/notes/linked quote); the Job itself
 *  still needs its own sequential job_number, generated the same way
 *  saaJobsCreateJob does. Returns { ok:true, systemId, jobId } |
 *  { ok:false, error }. */
async function saaSystemsCreateWithJob(customerId, systemFields, jobFields) {
  try {
    if (!customerId) return { ok: false, error: "A customer is required before a System can be created." };
    const { data: system, error: sErr } = await _saaClient
      .from("systems")
      .insert({
        customer_id: customerId,
        system_name: (systemFields && systemFields.systemName) || "System",
        system_type: (systemFields && systemFields.systemType) || null,
        manufacturer: (systemFields && systemFields.manufacturer) || null,
        model_number: (systemFields && systemFields.modelNumber) || null,
        serial_number: (systemFields && systemFields.serialNumber) || null,
        tonnage: (systemFields && systemFields.tonnage) || null,
        refrigerant: (systemFields && systemFields.refrigerant) || null,
        install_date: (systemFields && systemFields.installDate) || null,
        system_location: (systemFields && systemFields.systemLocation) || null,
        system_orientation: (systemFields && systemFields.systemOrientation) || null,
        indoor_unit: (systemFields && systemFields.indoorUnit) || null,
        outdoor_unit: (systemFields && systemFields.outdoorUnit) || null,
        coil: (systemFields && systemFields.coil) || null,
        furnace_air_handler: (systemFields && systemFields.furnaceAirHandler) || null,
        warranty_info: (systemFields && systemFields.warrantyInfo) || null,
        notes: (systemFields && systemFields.notes) || null,
      })
      .select("id")
      .single();
    if (sErr) throw sErr;

    // jobs-db.js's _saaJobsNextJobNumber/_saaCustomerFirstName are loaded
    // on every page systems-db.js is (jobs.html, calendar.html) — reused
    // rather than duplicated a third time.
    const firstName = (jobFields && jobFields.customerFirstName) || (await _saaCustomerFirstName(customerId));
    const jobNumber = await _saaJobsNextJobNumber(firstName);
    const { data: job, error: jErr } = await _saaClient
      .from("jobs")
      .insert({
        job_number: jobNumber,
        customer_id: customerId,
        system_id: system.id,
        job_type: (jobFields && jobFields.jobType) || "service_call",
        status: (jobFields && jobFields.status) || "new",
        title: (jobFields && jobFields.title) || "",
        job_address: (jobFields && jobFields.jobAddress) || null,
        job_city: (jobFields && jobFields.jobCity) || null,
        job_state: (jobFields && jobFields.jobState) || "TX",
        job_zip: (jobFields && jobFields.jobZip) || null,
        priority: (jobFields && jobFields.priority) || "normal",
        // These four are the legacy per-job schedule/technician columns
        // (see _saaEventsSyncJobFromCurrentEvent in events-db.js) —
        // accepted here so a caller building its own Event right after
        // (see saaEventsCreateForJob) has them already in sync from the
        // start, same as the Calendar's own New Job flow.
        assigned_technician_id: (jobFields && jobFields.technicianId) || null,
        assigned_technician_id_2: (jobFields && jobFields.technicianId2) || null,
        assigned_technician_id_3: (jobFields && jobFields.technicianId3) || null,
        scheduled_date: (jobFields && jobFields.scheduledDate) || null,
        scheduled_time: (jobFields && jobFields.scheduledTime) || null,
        notes: (jobFields && jobFields.notes) || null,
        linked_quote_id: (jobFields && jobFields.linkedQuoteId) || null,
        quoted_amount: (jobFields && jobFields.quotedAmount) || null,
      })
      .select("id")
      .single();
    if (jErr) throw jErr;

    return { ok: true, systemId: system.id, jobId: job.id };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Generic partial update for a System's own details (the office filling
 *  in manufacturer/model/serial/tonnage/etc. after the fact, or editing
 *  system_location/orientation). Never touches the System's Job. */
async function saaSystemsUpdate(systemId, fields) {
  try {
    const patch = Object.assign({}, fields, { updated_at: new Date().toISOString() });
    const { error } = await _saaClient.from("systems").update(patch).eq("id", systemId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Search across model/serial/manufacturer/system name — one piece of
 *  the spec's global "search by ... system, model, serial" requirement.
 *  Returns each match hydrated with its customer and Job, since a System
 *  is only ever useful in the scheduling/search flows alongside those. */
async function saaSystemsSearch(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];
  const { data: systems, error } = await _saaClient
    .from("systems")
    .select("*")
    .or(`system_name.ilike.%${q}%,manufacturer.ilike.%${q}%,model_number.ilike.%${q}%,serial_number.ilike.%${q}%`)
    .limit(10);
  if (error) throw error;
  if (!systems || !systems.length) return [];

  const custIds = [...new Set(systems.map((s) => s.customer_id))];
  const systemIds = systems.map((s) => s.id);
  const [{ data: customers, error: cErr }, { data: jobs, error: jErr }] = await Promise.all([
    _saaClient.from("customers").select("id,first_name,last_name,phone,billing_address,billing_city").in("id", custIds),
    _saaClient.from("jobs").select("id,job_number,status,system_id").in("system_id", systemIds),
  ]);
  if (cErr) throw cErr;
  if (jErr) throw jErr;
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const jobBySystem = Object.fromEntries((jobs || []).map((j) => [j.system_id, j]));
  return systems.map((s) => Object.assign({}, s, { customer: custById[s.customer_id] || null, job: jobBySystem[s.id] || null }));
}
