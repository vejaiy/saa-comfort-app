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
 *  Returns null if there's not even a street address to work with.
 *  Round 16 follow-up (2026-09-13): some jobs have the city/state/zip
 *  typed directly into the Service Address field itself (in addition to
 *  their own City/State/Zip fields), which used to make this function
 *  glue the same city/state/zip onto the end a second time — showing up
 *  as a garbled, duplicated "Trip: ... Pearland, TX , 77584, Pearland,
 *  TX 77584" line. Now each city/state/zip piece is only appended if it
 *  isn't already present somewhere in the address text. */
function saaMileageJobAddress(job) {
  if (!job || !job.job_address) return null;
  const addr = job.job_address.trim();
  const lower = addr.toLowerCase();
  const present = (v) => !!v && lower.includes(String(v).trim().toLowerCase());
  const parts = [];
  if (job.job_city && !present(job.job_city)) parts.push(job.job_city);
  const stateMissing = job.job_state && !present(job.job_state);
  const zipMissing = job.job_zip && !present(job.job_zip);
  if (stateMissing && zipMissing) parts.push([job.job_state, job.job_zip].join(" "));
  else {
    if (stateMissing) parts.push(job.job_state);
    if (zipMissing) parts.push(job.job_zip);
  }
  return [addr, parts.join(", ")].filter(Boolean).join(", ");
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

// "STREET, CITY, STATE ZIP" is the format every address in this app is
// SUPPOSED to be built in (see saaMileageJobAddress above and
// SAA_COMPANY_ADDRESS in maps-config.js), but in practice a tech
// sometimes types the whole thing into one field by hand (Round 16/17
// both ran into this) and drops the comma between city and state --
// "9435 Sparrow creek ct, Katy TX 77494" instead of "..., Katy, TX
// 77494". The original strict two-comma regex simply didn't match that,
// which meant parts came back null and every fallback tier past the
// first got skipped entirely -- exactly the class of address most likely
// to need those tiers. Round 20 (2026-09-13) rewrite: pull "STATE ZIP"
// off the end regardless of what (if anything) separates it from the
// rest, then split whatever's left on the LAST comma, if there is one,
// to get street vs. city. A missing city is fine -- it just means the
// city-centroid tier has nothing to try, but ZIP-centroid still works.
function _saaParseAddressParts(address) {
  const s = String(address || "").trim();
  const tail = s.match(/^(.*?),?\s*([A-Za-z]{2})\s*,?\s*(\d{5})(?:-\d{4})?\s*$/);
  if (!tail) return null;
  const before = tail[1].trim();
  const state = tail[2].trim();
  const zip = tail[3].trim();
  if (!before) return null;
  const lastComma = before.lastIndexOf(",");
  const street = (lastComma === -1 ? before : before.slice(0, lastComma)).trim();
  const city = (lastComma === -1 ? "" : before.slice(lastComma + 1)).trim();
  if (!street) return null;
  return { street, city, state, zip };
}

/** One Nominatim call -- {lat, lon} on a match, null on a clean zero-result
 *  response (NOT an error; the caller decides whether to retry a different
 *  way or give up). Still throws on a real network/HTTP failure. */
async function _saaGeocodeQuery(url) {
  let resp;
  try {
    resp = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(_saaFreeRouteUnavailableMsg);
  }
  if (!resp.ok) throw new Error(_saaFreeRouteUnavailableMsg);
  const rows = await resp.json();
  if (!rows || !rows.length) return null;
  return { lat: parseFloat(rows[0].lat), lon: parseFloat(rows[0].lon) };
}

/** Address string -> {lat, lon} via Nominatim (OpenStreetMap's free
 *  geocoder). Cached indefinitely per exact address string.
 *
 *  Round 15 (2026-09-13) reliability fix: a single freeform "house number
 *  + street + city + state + zip" query sometimes comes back with ZERO
 *  results from Nominatim even for a perfectly real, deliverable address
 *  (new-construction house numbers in particular can lag behind in
 *  OpenStreetMap's data even though the street itself is mapped) --
 *  including, in practice, SAA's own office address, which is used as the
 *  "from" point for every technician's first leg of every single day. A
 *  hard failure there would break mileage calculation constantly. So on a
 *  zero-result freeform lookup, this now retries several more ways before
 *  giving up: Nominatim's *structured* query params (street/city/state/
 *  postalcode split out, rather than one string it has to parse itself --
 *  documented to succeed in cases a freeform query misses), then a
 *  freeform retry with the house number stripped off (street-level
 *  accuracy is plenty for a mileage estimate). Round 17 (2026-09-13):
 *  confirmed in production that some brand-new-subdivision streets aren't
 *  in OpenStreetMap's data AT ALL yet (not just the house number), so the
 *  first three tiers still came up empty for SAA's own office address --
 *  added a ZIP-centroid tier and, below that, a city-centroid tier, since
 *  those are essentially always present even when a specific street isn't.
 *  Round 20 (2026-09-13): those later tiers depend on _saaParseAddressParts
 *  successfully splitting the address, which used to require an exact
 *  "STREET, CITY, STATE ZIP" comma pattern -- an address typed as "STREET,
 *  CITY STATE ZIP" (no comma before the state) failed to parse at all, so
 *  it fell straight through to the plain error with none of tiers 2-5 ever
 *  attempted. _saaParseAddressParts is now tolerant of that. Each retry
 *  still respects the 1-request/sec throttle Nominatim's usage policy
 *  requires. */
async function _saaGeocodeAddress(address) {
  const key = String(address || "").trim().toLowerCase();
  if (!key) throw new Error("No address to look up.");
  if (_saaGeocodeCache[key]) return _saaGeocodeCache[key];

  await _saaFreeRouteThrottle();
  let loc = await _saaGeocodeQuery("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" + encodeURIComponent(address));

  const parts = !loc ? _saaParseAddressParts(address) : null;
  if (!loc && parts) {
    await _saaFreeRouteThrottle();
    let structuredUrl = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us" +
      "&street=" + encodeURIComponent(parts.street) +
      "&state=" + encodeURIComponent(parts.state) +
      "&postalcode=" + encodeURIComponent(parts.zip);
    if (parts.city) structuredUrl += "&city=" + encodeURIComponent(parts.city);
    loc = await _saaGeocodeQuery(structuredUrl);
  }
  if (!loc && parts) {
    const streetNoNumber = parts.street.replace(/^\s*\d+[a-zA-Z-]*\s+/, "").trim();
    if (streetNoNumber && streetNoNumber !== parts.street) {
      await _saaFreeRouteThrottle();
      const cityBit = parts.city ? `${parts.city}, ` : "";
      loc = await _saaGeocodeQuery("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=" +
        encodeURIComponent(`${streetNoNumber}, ${cityBit}${parts.state} ${parts.zip}`));
    }
  }

  // Round 17 (2026-09-13) reliability fix: Tiers 1-3 above all assume the
  // *street* itself is in OpenStreetMap's data somewhere, just maybe not
  // this exact house number. That assumption turned out to be wrong for
  // some brand-new subdivisions (confirmed in production against SAA's own
  // office address) -- the street name itself isn't mapped yet, so every
  // prior tier comes back empty. ZIP codes and city/state, unlike a brand
  // new street, are essentially always present in OpenStreetMap (they come
  // from the US Census TIGER dataset), so falling back to the ZIP's -- or
  // failing that, the city's -- approximate center still gets a usable
  // mileage estimate instead of forcing a manual entry every time a job is
  // in a newer development. This is a few miles less precise than a real
  // street-level match, which is an acceptable trade-off for an expense
  // estimate; a console note is left for anyone debugging a mileage number
  // that looks off.
  if (!loc && parts && parts.zip) {
    await _saaFreeRouteThrottle();
    loc = await _saaGeocodeQuery("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&postalcode=" + encodeURIComponent(parts.zip));
    if (loc) console.warn(`Mileage: "${address}" isn't in OpenStreetMap's data yet — used the approximate center of ZIP ${parts.zip} instead. Distance may be off by a few miles.`);
  }
  if (!loc && parts && parts.city && parts.state) {
    await _saaFreeRouteThrottle();
    loc = await _saaGeocodeQuery("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&city=" + encodeURIComponent(parts.city) + "&state=" + encodeURIComponent(parts.state));
    if (loc) console.warn(`Mileage: "${address}" isn't in OpenStreetMap's data yet — used the approximate center of ${parts.city}, ${parts.state} instead. Distance may be off by several miles.`);
  }

  if (!loc) throw new Error(`Couldn't find the address "${address}" — double check it, or type the mileage in by hand.`);
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

/** Round 25 (2026-09-14) multi-technician support: a job can now have more
 *  than one mileage_logs row (one per technician slot that's logged a
 *  leg), so this takes an optional technicianId to fetch a SPECIFIC slot's
 *  row. Every existing call site keeps working unchanged by simply not
 *  passing one -- it then returns whichever row comes back first, which in
 *  practice is the only row that exists for a job that still has just the
 *  one (primary) technician driving mileage, exactly like before this
 *  round. New technician-2/3 mileage call sites pass technicianId
 *  explicitly to reach their own leg. */
async function saaMileageFetchForJob(jobId, technicianId) {
  // leg_type: "trip" excludes a possible return_to_shop row for the same
  // job (Round 35) -- without this, a job that also happens to be its
  // technician's last stop of the day could return either row here
  // arbitrarily, since both share the same job_id/technician_id.
  let query = _saaClient.from("mileage_logs").select("*").eq("job_id", jobId).eq("leg_type", "trip");
  if (technicianId) query = query.eq("technician_id", technicianId);
  const { data, error } = await query;
  if (error || !data || !data.length) return null;
  return data[0];
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
/** technicianId defaults to job.assigned_technician_id (the primary slot,
 *  same as before Round 25) -- pass it explicitly to get technician 2/3's
 *  own leg-chain context instead, since each technician slot drives its
 *  own separate day's chain of stops. */
async function saaMileageLegContext(job, technicianId) {
  const techId = technicianId || (job && job.assigned_technician_id);
  if (!job || !techId || !job.scheduled_date) return null;
  const others = await _saaMileageTechJobsForDate(techId, job.scheduled_date, job.id);
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
/** technicianId defaults to job.assigned_technician_id (primary slot) --
 *  every pre-Round-25 call site that doesn't pass one keeps calculating
 *  exactly the automatic primary-tech leg it always has. Passing an
 *  explicit technicianId (technician 2 or 3's id) calculates THAT
 *  technician's own separate leg for the same job instead, upserted as
 *  its own mileage_logs row (job_id, technician_id) now that the unique
 *  constraint allows one row per job PER technician rather than one per
 *  job total. */
async function saaMileageRecalcForJob(job, force, technicianId) {
  try {
    const techId = technicianId || job.assigned_technician_id;
    if (!techId) throw new Error("Assign a technician before calculating mileage.");
    const toAddress = saaMileageJobAddress(job);
    if (!toAddress) throw new Error("This job needs a Service Address before mileage can be calculated.");
    if (!job.scheduled_date) throw new Error("This job needs a Scheduled Date before mileage can be calculated.");

    const existing = await saaMileageFetchForJob(job.id, techId);
    if (existing && existing.source === "manual" && !force) {
      return { ok: false, error: "This leg was set manually — recalculating would overwrite it.", manual: true };
    }

    const ctx = await saaMileageLegContext(job, techId);
    const miles = await saaMileageComputeDistance(ctx.fromAddress, toAddress);
    // Round 42 Task 118: stamps this leg with the Job's current Event for
    // traceability (event_id lives alongside job_id now, same as
    // invoices/payments/BOM/photos) — leg-chaining itself (from/to/order)
    // stays keyed on job_id/technician_id/date, unchanged; only pages that
    // also load events-db.js can resolve this (the standalone Mileage page
    // doesn't), hence the guard.
    const eventId = typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(job.id) : null;

    const { data, error } = await _saaClient
      .from("mileage_logs")
      .upsert(
        {
          technician_id: techId,
          job_id: job.id,
          event_id: eventId,
          log_date: job.scheduled_date,
          leg_order: ctx.legOrder,
          leg_type: "trip",
          from_address: ctx.fromAddress,
          to_address: toAddress,
          miles,
          source: "auto",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id,technician_id,leg_type" }
      )
      .select("*")
      .single();
    if (error) throw error;
    // Round 35 ("update miles to include to and from"): whichever job is
    // now this technician's last stop of the day gets an extra leg back to
    // the shop -- a save/recalc anywhere in the day's chain can change who
    // that is, so resync every time rather than only when the last job
    // itself is touched.
    await saaMileageSyncReturnLeg(techId, job.scheduled_date);
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
async function saaMileageEnsureForJob(job, technicianId) {
  try {
    return await saaMileageRecalcForJob(job, undefined, technicianId);
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Manual override for the leg ending at this job — same from/to/leg-
 *  order context as the auto path (so the row still reads sensibly on
 *  the Mileage page), but the mile figure is whatever the office/tech
 *  typed in, and source is stamped 'manual' so a later recalc won't
 *  silently clobber it. */
async function saaMileageSetManualForJob(job, miles, technicianId) {
  try {
    const techId = technicianId || job.assigned_technician_id;
    if (!techId) throw new Error("Assign a technician before logging mileage.");
    const toAddress = saaMileageJobAddress(job) || "(no address on file)";
    if (!job.scheduled_date) throw new Error("This job needs a Scheduled Date before mileage can be logged.");
    const ctx = await saaMileageLegContext(job, techId);
    const eventId = typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(job.id) : null;
    const { data, error } = await _saaClient
      .from("mileage_logs")
      .upsert(
        {
          technician_id: techId,
          job_id: job.id,
          event_id: eventId,
          log_date: job.scheduled_date,
          leg_order: ctx.legOrder,
          leg_type: "trip",
          from_address: ctx.fromAddress,
          to_address: toAddress,
          miles: miles == null ? null : Number(miles),
          source: "manual",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id,technician_id,leg_type" }
      )
      .select("*")
      .single();
    if (error) throw error;
    await saaMileageSyncReturnLeg(techId, job.scheduled_date);
    return { ok: true, log: data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Keeps the "drive back to the shop" leg in sync with whichever job is
 *  actually this technician's LAST scheduled stop on this date (Round 35:
 *  "update miles to include to and from" -- the office wants a full
 *  shop -> job -> job -> ... -> shop day captured, not just the drive
 *  between stops, so each day's last job gets an extra leg_type
 *  'return_to_shop' row back to SAA_COMPANY_ADDRESS). Called after every
 *  write/delete that could change who that last job is, so the return
 *  leg follows the schedule automatically instead of needing a manual
 *  fix every time a job is added, rescheduled, or removed. A
 *  manually-corrected return leg (source: 'manual') is left alone as
 *  long as it still points at the real last job, same guarantee the
 *  trip-leg upserts give a manually-set Miles Driven value. Never
 *  throws -- this is best-effort background sync, same as
 *  saaMileageEnsureForJob. */
async function saaMileageSyncReturnLeg(technicianId, dateStr) {
  try {
    if (!technicianId || !dateStr) return;
    const jobs = await _saaMileageTechJobsForDate(technicianId, dateStr, null);

    const { data: existingRows } = await _saaClient
      .from("mileage_logs")
      .select("*")
      .eq("technician_id", technicianId)
      .eq("log_date", dateStr)
      .eq("leg_type", "return_to_shop");
    const existing = (existingRows || [])[0] || null;

    if (!jobs.length) {
      // No scheduled stops left this day for this technician -- nothing to
      // return from, so clear any stale return leg.
      if (existing) await _saaClient.from("mileage_logs").delete().eq("id", existing.id);
      return;
    }

    const lastJob = jobs[jobs.length - 1];
    if (existing && existing.job_id === lastJob.id) {
      if (existing.source === "manual") return; // already correct, and hand-corrected -- leave it
    } else if (existing) {
      // The last job of the day changed (reschedule, new later job added,
      // earlier job removed) -- the old return leg no longer belongs here.
      if (existing.source === "manual") return; // a manual override stays until someone clears it themselves
      await _saaClient.from("mileage_logs").delete().eq("id", existing.id);
    }

    const fromAddress = saaMileageJobAddress(lastJob) || SAA_COMPANY_ADDRESS;
    const miles = await saaMileageComputeDistance(fromAddress, SAA_COMPANY_ADDRESS);
    await _saaClient.from("mileage_logs").upsert(
      {
        technician_id: technicianId,
        job_id: lastJob.id,
        log_date: dateStr,
        leg_order: 999,
        leg_type: "return_to_shop",
        from_address: fromAddress,
        to_address: SAA_COMPANY_ADDRESS,
        miles,
        source: "auto",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,technician_id,leg_type" }
    );
  } catch (e) {
    // Best-effort: a return leg that fails to compute (bad address, the
    // free routing service briefly down) just stays as it was until the
    // next successful sync -- never let it block whatever save triggered it.
  }
}

/** technicianId scopes the delete to just that technician's leg for the
 *  job -- pass it (Round 25) so clearing technician 2/3's own Miles
 *  Driven field can't accidentally wipe the primary technician's leg, or
 *  vice versa. Omitting it deletes every leg on file for the job (all
 *  technicians), same as the original one-row-per-job behavior.
 *  legType (Round 35) defaults to 'trip' -- clearing a job's Miles Driven
 *  field should only ever remove that job's own arrival leg, never an
 *  unrelated return_to_shop leg that happens to share the same job_id
 *  because this job is (or was) the day's last stop. After deleting, the
 *  affected technician/date's return leg is resynced in case this job's
 *  removal changes who the day's actual last stop is. */
async function saaMileageDeleteForJob(jobId, technicianId, legType) {
  const lt = legType || "trip";
  let selQuery = _saaClient.from("mileage_logs").select("technician_id,log_date").eq("job_id", jobId).eq("leg_type", lt);
  if (technicianId) selQuery = selQuery.eq("technician_id", technicianId);
  const { data: affected } = await selQuery;

  let query = _saaClient.from("mileage_logs").delete().eq("job_id", jobId).eq("leg_type", lt);
  if (technicianId) query = query.eq("technician_id", technicianId);
  const { error } = await query;
  if (error) return { ok: false, error: error.message };

  for (const row of affected || []) {
    await saaMileageSyncReturnLeg(row.technician_id, row.log_date);
  }
  return { ok: true };
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
