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
   - "auto" rows are computed via the Google Maps Distance Matrix API when
     a key is configured (see _saaMapsEnsureLoaded/_saaMileageComputeDistanceGoogle
     below), or otherwise via a free, no-signup OpenStreetMap-based route
     (Nominatim for geocoding + the public OSRM demo server for driving
     distance — see _saaMileageComputeDistanceFree). saaMileageComputeDistance
     picks whichever is available. "manual" rows are typed in directly,
     either overriding an auto-computed leg (same row, same job_id, source
     flips to 'manual') or as a standalone entry with no job_id at all. A
     manual override is never silently recomputed back to auto —
     recalculating again requires an explicit action, so a corrected
     number sticks.
   - Round 11 follow-up (2026-09-13): every job that has enough info
     (technician + scheduled date + service address) now gets an actual
     mileage number on file automatically via saaMileageEnsureForJob,
     called from job creation/reschedule/save everywhere those happen —
     not just when someone clicks "Calculate Miles" by hand.
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
 *  strings, via the Google Distance Matrix API. Throws with a readable
 *  message on any failure (no key configured, no route found, address
 *  not recognized, etc.) — callers should catch and toast this directly. */
async function _saaMileageComputeDistanceGoogle(originAddress, destAddress) {
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

/* ---- Free driving-distance routing (no API key required) ----
   Round 11 follow-up (2026-09-13): until a Google Maps key is set up,
   mileage is calculated via free public OpenStreetMap services instead
   of leaving Miles Driven blank — Nominatim geocodes each address to
   lat/lng, then the OSRM public demo server returns driving distance
   between the two points. Both are shared, rate-limited public services
   (not run by SAA Comfort Air or Anthropic), so lookups are throttled to
   a polite ~1/second and results are cached (in-memory + localStorage)
   so the same address is never looked up twice. They can occasionally be
   slow or briefly unavailable — every failure here surfaces a readable
   message and Miles Driven can always be typed in by hand as a fallback. */

const _saaGeocodeCache = (() => {
  try { return JSON.parse(localStorage.getItem("saaGeocodeCacheV1") || "{}"); }
  catch (e) { return {}; }
})();

function _saaGeocodeCacheSave() {
  try { localStorage.setItem("saaGeocodeCacheV1", JSON.stringify(_saaGeocodeCache)); }
  catch (e) { /* private browsing / storage full — cache just won't persist across loads */ }
}

let _saaFreeRouteLastCall = 0;
async function _saaFreeRouteThrottle() {
  const wait = 1100 - (Date.now() - _saaFreeRouteLastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  _saaFreeRouteLastCall = Date.now();
}

const _saaFreeRouteUnavailableMsg = "Couldn't reach the free mileage-lookup service right now (it's a shared public service that's occasionally slow or unavailable) — try again in a moment, or type the mileage in by hand.";

/** Address string -> {lat, lon} via Nominatim (OpenStreetMap's free
 *  geocoder). Cached indefinitely per exact address string. */
async function _saaGeocodeAddress(address) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) throw new Error("No address to look up.");
  if (_saaGeocodeCache[key]) return _saaGeocodeCache[key];
  await _saaFreeRouteThrottle();
  let resp;
  try {
    resp = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(address), {
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    throw new Error(_saaFreeRouteUnavailableMsg);
  }
  if (!resp.ok) throw new Error(_saaFreeRouteUnavailableMsg);
  const rows = await resp.json();
  if (!rows || !rows.length) throw new Error(`Couldn't find the address "${address}" — double check it, or type the mileage in by hand.`);
  const loc = { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon) };
  _saaGeocodeCache[key] = loc;
  _saaGeocodeCacheSave();
  return loc;
}

/** Driving distance in miles (rounded to 1 decimal) between two address
 *  strings, using free OpenStreetMap geocoding + routing — no API key,
 *  no cost, no signup. See the block comment above for the tradeoffs. */
async function _saaMileageComputeDistanceFree(originAddress, destAddress) {
  const origin = await _saaGeocodeAddress(originAddress);
  const dest = await _saaGeocodeAddress(destAddress);
  await _saaFreeRouteThrottle();
  let resp;
  try {
    resp = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=false`);
  } catch (e) {
    throw new Error(_saaFreeRouteUnavailableMsg);
  }
  if (!resp.ok) throw new Error(_saaFreeRouteUnavailableMsg);
  const json = await resp.json();
  if (json.code !== "Ok" || !json.routes || !json.routes.length) {
    throw new Error("Couldn't find a driving route between those two addresses.");
  }
  return Math.round((json.routes[0].distance / 1609.344) * 10) / 10; // meters -> miles
}

/** Driving distance in miles between two address strings — uses Google's
 *  Distance Matrix API when a key is configured in maps-config.js (most
 *  accurate/reliable), or the free OpenStreetMap route otherwise. This is
 *  the one function the rest of this file/app calls; which service
 *  actually answers is an implementation detail. */
async function saaMileageComputeDistance(originAddress, destAddress) {
  if (SAA_MAPS_API_KEY) return _saaMileageComputeDistanceGoogle(originAddress, destAddress);
  return _saaMileageComputeDistanceFree(originAddress, destAddress);
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
 *  name and (when tied to one) the job's number/title/customer — same
 *  flat-fetch-then-stitch-in-JS pattern the rest of this app's data
 *  layers use. Ordered technician, then date, then leg.
 *
 *  jobQuery (round 11 follow-up, 2026-09-13: "retrievable by job") does a
 *  free-text, case-insensitive match against the job number, job title,
 *  and customer name — or, for a standalone entry with no job, the
 *  destination address/notes — so the office can find every trip tied to
 *  one job, or every trip for one customer, without having to know a
 *  date range first. */
async function saaMileageFetchAll({ technicianId, dateFrom, dateTo, jobQuery } = {}) {
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
    jobIds.length ? _saaClient.from("jobs").select("id,job_number,title,customer_id").in("id", jobIds) : { data: [] },
  ]);
  const techById = Object.fromEntries((techRes.data || []).map((t) => [t.id, t]));
  const jobs = jobRes.data || [];

  const custIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const custRes = custIds.length
    ? await _saaClient.from("customers").select("id,first_name,last_name").in("id", custIds)
    : { data: [] };
  const custById = Object.fromEntries((custRes.data || []).map((c) => [c.id, c]));
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, Object.assign({}, j, { customer: custById[j.customer_id] || null })]));

  let rows = logs.map((l) => Object.assign({}, l, {
    technician: techById[l.technician_id] || null,
    job: l.job_id ? jobById[l.job_id] || null : null,
  }));

  const q = (jobQuery || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      if (r.job) {
        const cust = r.job.customer ? `${r.job.customer.first_name || ""} ${r.job.customer.last_name || ""}` : "";
        return [r.job.job_number, r.job.title, cust].some((s) => (s || "").toLowerCase().includes(q));
      }
      return [r.to_address, r.notes].some((s) => (s || "").toLowerCase().includes(q));
    });
  }

  return rows.sort((a, b) =>
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

/** Best-effort, silent version of saaMileageRecalcForJob for automatic
 *  use: called from job creation, drag-and-drop rescheduling, and Job
 *  Card saves so that EVERY job with enough info on file (technician +
 *  scheduled date + service address) ends up with a real mileage number
 *  recorded — not just the ones where someone happens to click
 *  "Calculate Miles" (round 11 follow-up, 2026-09-13: "Save miles for
 *  every job"). Never throws and never blocks whatever save triggered
 *  it — a missing technician/date/address, an address the routing
 *  service can't find, or the free routing service being briefly down
 *  all just mean this job's mileage stays as it was (fixable by hand
 *  from the Job Card or the Mileage page). A manually-set leg is always
 *  left alone, same guarantee as the "Calculate Miles" button. */
async function saaMileageEnsureForJob(job) {
  try {
    return await saaMileageRecalcForJob(job);
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
