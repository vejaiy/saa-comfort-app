/* ============================================================
   SAA Comfort Air LLC — Technician Mileage data layer
   Backs the Job Card's "Mileage" section and the standalone
   employee/mileage.html reporting page. Requires auth.js to have
   already created the shared _saaClient, and maps-config.js to have
   defined SAA_MAPS_API_KEY / SAA_COMPANY_ADDRESS.

   Design notes:
   - One `mileage_logs` row = one driving LEG for one technician on one
     day, ending at one job (job_id) or, for a manual non-job entry
     (a parts run, a supply-house trip), no job at all. A technician's
     first leg of any given day always starts from SAA_COMPANY_ADDRESS
     — every later leg that same day starts from the previous leg's
     destination, chained by scheduled_time. This mirrors how a
     technician's actual day works: leave the shop, drive job to job,
     not back to the shop between every stop.
   - leg_order is derived from where this job falls, by scheduled_time,
     among that technician's OTHER jobs on the same scheduled_date — not
     stored as a separate manual sequence number the office has to
     maintain. Re-running saaMileageRecalcForJob after a schedule change
     (different day, different tech, reordered stops) naturally produces
     the right chain again.
   - "auto" rows are computed via the Google Maps Distance Matrix API
     (see _saaMapsEnsureLoaded/saaMileageComputeDistance below); "manual"
     rows are typed in directly, either overriding an auto-computed leg
     (same row, same job_id, source flips to 'manual') or as a standalone
     entry with no job_id at all. A manual override is never silently
     recomputed back to auto — recalculating again requires an explicit
     action, so a corrected number sticks.
   ============================================================ */

/** Builds a full postal address string from a job's own address fields,
 *  the same four columns the Job Card's Service Address fields write to.
 *  Returns null if there's not even a street address to work with. */
function saaMileageJobAddress(job) {
  if (!job || !job.job_address) return null;
  const cityStateZip = [job.job_city, [job.job_state, job.job_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [job.job_address, cityStateZip].filter(Boolean).join(", ");
}

/* ---- Google Maps loading + distance lookup ---- */

let _saaMapsLoadPromise = null;

function _saaMapsEnsureLoaded() {
  if (!SAA_MAPS_API_KEY) {
    return Promise.reject(new Error("Google Maps isn't set up yet — add an API key to assets/js/maps-config.js to enable automatic mileage calculation (Miles Driven can still be typed in by hand)."));
  }
  if (window.google && window.google.maps && window.google.maps.DistanceMatrixService) return Promise.resolve();
  if (_saaMapsLoadPromise) return _saaMapsLoadPromise;
  _saaMapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(SAA_MAPS_API_KEY)}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps — double check the API key in maps-config.js and that the Maps JavaScript API is enabled for it."));
    document.head.appendChild(script);
  });
  return _saaMapsLoadPromise;
}

/** Driving distance in miles (rounded to 1 decimal) between two address
 *  strings, via the Distance Matrix API. Throws with a readable message
 *  on any failure (no key configured, no route found, address not
 *  recognized, etc.) — callers should catch and toast this directly. */
async function saaMileageComputeDistance(originAddress, destAddress) {
  await _saaMapsEnsureLoaded();
  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: [originAddress],
        destinations: [destAddress],
        travelMode: google.maps.TravelMode.DRIVING,
        unitSystem: google.maps.UnitSystem.IMPERIAL,
      },
      (response, status) => {
        if (status !== "OK") { reject(new Error("Distance lookup failed (" + status + ").")); return; }
        const el = response && response.rows[0] && response.rows[0].elements[0];
        if (!el || el.status !== "OK") { reject(new Error("Couldn't find a driving route between those two addresses.")); return; }
        resolve(Math.round((el.distance.value / 1609.344) * 10) / 10); // meters -> miles
      }
    );
  });
}

/* ---- Reads ---- */

async function saaMileageFetchForJob(jobId) {
  const { data, error } = await _saaClient.from("mileage_logs").select("*").eq("job_id", jobId).maybeSingle();
  if (error) return null;
  return data;
}

/** This technician's OTHER scheduled jobs the same day, oldest-first —
 *  used to work out where a leg chain starts and what "leg_order" a job
 *  falls at. Excludes the job itself when excludeJobId is given. */
async function _saaMileageTechJobsForDate(technicianId, dateStr, excludeJobId) {
  const { data, error } = await _saaClient
    .from("jobs")
    .select("id,job_address,job_city,job_state,job_zip,scheduled_time")
    .eq("assigned_technician_id", technicianId)
    .eq("scheduled_date", dateStr)
    .not("scheduled_time", "is", null);
  if (error || !data) return [];
  return data
    .filter((j) => j.id !== excludeJobId)
    .sort((a, b) => (a.scheduled_time || "").localeCompare(b.scheduled_time || ""));
}

/** Works out this job's leg position (1-based) among its technician's
 *  stops that day, and the address the leg before it ends at (the
 *  company address for leg 1). Used both to auto-calculate and to show
 *  "From: ..." context even before a distance has been computed. */
async function saaMileageLegContext(job) {
  if (!job || !job.assigned_technician_id || !job.scheduled_date) return null;
  const others = await _saaMileageTechJobsForDate(job.assigned_technician_id, job.scheduled_date, job.id);
  const thisTime = job.scheduled_time || "";
  const before = others.filter((j) => (j.scheduled_time || "").localeCompare(thisTime) < 0);
  const legOrder = before.length + 1;
  const fromAddress = legOrder === 1 ? SAA_COMPANY_ADDRESS : saaMileageJobAddress(before[before.length - 1]);
  return { legOrder, fromAddress: fromAddress || SAA_COMPANY_ADDRESS };
}

/** Every mileage_logs row in range, each stitched with its technician's
 *  name and (when tied to one) the job's number/customer — same
 *  flat-fetch-then-stitch-in-JS pattern the rest of this app's data
 *  layers use. Ordered technician, then date, then leg. */
async function saaMileageFetchAll({ technicianId, dateFrom, dateTo } = {}) {
  let query = _saaClient.from("mileage_logs").select("*");
  if (technicianId) query = query.eq("technician_id", technicianId);
  if (dateFrom) query = query.gte("log_date", dateFrom);
  if (dateTo) query = query.lte("log_date", dateTo);
  const { data: logs, error } = await query;
  if (error) return [];

  const techIds = [...new Set(logs.map((l) => l.technician_id).filter(Boolean))];
  const jobIds = [...new Set(logs.map((l) => l.job_id).filter(Boolean))];
  const [techRes, jobRes] = await Promise.all([
    techIds.length ? _saaClient.from("technicians").select("id,name").in("id", techIds) : { data: [] },
    jobIds.length ? _saaClient.from("jobs").select("id,job_number,title").in("id", jobIds) : { data: [] },
  ]);
  const techById = Object.fromEntries((techRes.data || []).map((t) => [t.id, t]));
  const jobById = Object.fromEntries((jobRes.data || []).map((j) => [j.id, j]));

  return logs
    .map((l) => Object.assign({}, l, {
      technician: techById[l.technician_id] || null,
      job: l.job_id ? jobById[l.job_id] || null : null,
    }))
    .sort((a, b) =>
      (a.technician ? a.technician.name : "").localeCompare(b.technician ? b.technician.name : "") ||
      a.log_date.localeCompare(b.log_date) ||
      a.leg_order - b.leg_order
    );
}

/* ---- Writes ---- */

/** Auto-calculates (or re-calculates) the leg ending at this job: works
 *  out from/to + leg order, calls the Distance Matrix API, and upserts
 *  the result keyed on job_id (one leg per job). Returns {ok, log} or
 *  {ok:false, error}. Never overwrites a row that was last set manually
 *  unless force is true — recalculating a manual entry is an explicit
 *  choice, not something a routine refresh should do quietly. */
async function saaMileageRecalcForJob(job, force) {
  try {
    if (!job.assigned_technician_id) throw new Error("Assign a technician before calculating mileage.");
    const toAddress = saaMileageJobAddress(job);
    if (!toAddress) throw new Error("This job needs a Service Address before mileage can be calculated.");
    if (!job.scheduled_date) throw new Error("This job needs a Scheduled Date before mileage can be calculated.");

    const existing = await saaMileageFetchForJob(job.id);
    if (existing && existing.source === "manual" && !force) {
      return { ok: false, error: "This leg was set manually — recalculating would overwrite it.", manual: true };
    }

    const ctx = await saaMileageLegContext(job);
    const miles = await saaMileageComputeDistance(ctx.fromAddress, toAddress);

    const { data, error } = await _saaClient
      .from("mileage_logs")
      .upsert(
        {
          technician_id: job.assigned_technician_id,
          job_id: job.id,
          log_date: job.scheduled_date,
          leg_order: ctx.legOrder,
          from_address: ctx.fromAddress,
          to_address: toAddress,
          miles,
          source: "auto",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" }
      )
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, log: data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Manual override for the leg ending at this job — same from/to/leg-
 *  order context as the auto path (so the row still reads sensibly on
 *  the Mileage page), but the mile figure is whatever the office/tech
 *  typed in, and source is stamped 'manual' so a later recalc won't
 *  silently clobber it. */
async function saaMileageSetManualForJob(job, miles) {
  try {
    if (!job.assigned_technician_id) throw new Error("Assign a technician before logging mileage.");
    const toAddress = saaMileageJobAddress(job) || "(no address on file)";
    if (!job.scheduled_date) throw new Error("This job needs a Scheduled Date before mileage can be logged.");
    const ctx = await saaMileageLegContext(job);
    const { data, error } = await _saaClient
      .from("mileage_logs")
      .upsert(
        {
          technician_id: job.assigned_technician_id,
          job_id: job.id,
          log_date: job.scheduled_date,
          leg_order: ctx.legOrder,
          from_address: ctx.fromAddress,
          to_address: toAddress,
          miles: miles == null ? null : Number(miles),
          source: "manual",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" }
      )
      .select("*")
      .single();
    if (error) throw error;
    return { ok: true, log: data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaMileageDeleteForJob(jobId) {
  const { error } = await _saaClient.from("mileage_logs").delete().eq("job_id", jobId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** A standalone entry with no job behind it — a parts-house run, a trip
 *  back to the shop, etc. Added directly from the Mileage page. */
async function saaMileageAddManualEntry({ technicianId, logDate, fromAddress, toAddress, miles, notes }) {
  const { data, error } = await _saaClient
    .from("mileage_logs")
    .insert({
      technician_id: technicianId,
      job_id: null,
      log_date: logDate,
      leg_order: 99, // manual standalone entries sort after the day's real job legs
      from_address: fromAddress || SAA_COMPANY_ADDRESS,
      to_address: toAddress,
      miles: miles == null ? null : Number(miles),
      source: "manual",
      notes: notes || null,
    })
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, log: data };
}

async function saaMileageUpdateEntry(id, patch) {
  const { data, error } = await _saaClient
    .from("mileage_logs")
    .update(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
    .eq("id", id)
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, log: data };
}

async function saaMileageDeleteEntry(id) {
  const { error } = await _saaClient.from("mileage_logs").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
