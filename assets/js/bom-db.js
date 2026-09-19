/* ============================================================
   SAA Comfort Air LLC — Bill of Material page (round 12 redesign,
   2026-09-13)

   Replaces the previous Job-Card-embedded, freely-typed Bill of
   Material with a dedicated page that:
     - auto-derives the itemized material list from whichever change
       worksheets are toggled ON in the job's linked quote (via
       saaDeriveBomItemsFromFormState in worksheet.js, reading that
       quote's own saved form_state — always in sync with the
       worksheet, nothing to fall out of date)
     - lets the office add an item the quote missed, which is both
       kept on this job (job_materials — same table the previous
       round already scaffolded) AND, when the job has a linked
       quote, folded into that quote's own saved form_state (its
       "_bomExtras" list) so the quotation itself is updated to
       include it — "upon saving Bill of material quotation version
       should be saved to include added item in Bill of material page"
     - prints a Bill of Material and an Order Form showing qty + unit
       only, no cost — "no need to populate cost, just populate qty
       and unit in order form which will be showed to shop to pull
       materials from shelf"
   Requires auth.js (for _saaClient) and worksheet.js (for
   saaDeriveBomItemsFromFormState) to already be loaded.
   ============================================================ */

/** Search jobs by job number, customer name, or phone — same shape as
 *  saaJobsSearchCustomers, just against jobs (joined to customers). Uses
 *  only .or()/.in() (not a standalone .ilike()) to match every other
 *  *_db.js search in this app, since that's what the Playwright mock
 *  Supabase client (sitetest8/assets/js/vendor/supabase.js) implements. */
async function saaBomSearchJobs(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];
  const JOB_COLS = "id,job_number,title,job_type,status,customer_id,linked_quote_id,created_at";
  const [{ data: customers }, { data: jobsByNumber }] = await Promise.all([
    _saaClient.from("customers").select("id,first_name,last_name,phone")
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`),
    _saaClient.from("jobs").select(JOB_COLS).or(`job_number.ilike.%${q}%`),
  ]);
  const custIds = (customers || []).map((c) => c.id);
  const { data: jobsByCust } = custIds.length
    ? await _saaClient.from("jobs").select(JOB_COLS).in("customer_id", custIds)
    : { data: [] };
  const merged = {};
  (jobsByNumber || []).concat(jobsByCust || []).forEach((j) => { merged[j.id] = j; });
  const jobs = Object.values(merged);

  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const missingIds = [...new Set(jobs.map((j) => j.customer_id))].filter((id) => id && !custById[id]);
  if (missingIds.length) {
    const { data: more } = await _saaClient.from("customers").select("id,first_name,last_name,phone").in("id", missingIds);
    (more || []).forEach((c) => { custById[c.id] = c; });
  }
  jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return jobs.slice(0, 12).map((j) => Object.assign({}, j, { customer: custById[j.customer_id] || null }));
}

/** Round 37 (2026-09-17), per Vijayan's annotation on "Find a job": "Once
 *  clicked show job list in newest to oldest, allow to click and pick one
 *  job" -- alongside typing a name/number/phone (saaBomSearchJobs above,
 *  unchanged), clicking into the still-empty field should offer a pick
 *  list too. Same result shape as saaBomSearchJobs so the page can render
 *  either list with one function. */
async function saaBomRecentJobs(limit) {
  const JOB_COLS = "id,job_number,title,job_type,status,customer_id,linked_quote_id,created_at";
  const { data: jobs, error } = await _saaClient.from("jobs").select(JOB_COLS)
    .order("created_at", { ascending: false }).limit(limit || 15);
  if (error || !jobs) return [];
  const custIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))];
  const { data: customers } = custIds.length
    ? await _saaClient.from("customers").select("id,first_name,last_name,phone").in("id", custIds)
    : { data: [] };
  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  return jobs.map((j) => Object.assign({}, j, { customer: custById[j.customer_id] || null }));
}

/** Loads one job's full detail for the Bill of Material page: the job
 *  itself, its customer, its linked quote (WITH form_state — the pieces
 *  saaJobsFetchAll's lighter quote select leaves out), and any
 *  manually-added job_materials rows. */
async function saaBomFetchJob(jobId) {
  const { data: job, error: e1 } = await _saaClient.from("jobs").select("*").eq("id", jobId).single();
  if (e1) throw e1;
  const [{ data: customer }, { data: quote }, manualItems] = await Promise.all([
    job.customer_id ? _saaClient.from("customers").select("*").eq("id", job.customer_id).maybeSingle() : { data: null },
    job.linked_quote_id ? _saaClient.from("quotes").select("*").eq("id", job.linked_quote_id).maybeSingle() : { data: null },
    saaBomFetchItems(jobId),
  ]);
  return Object.assign({}, job, { customer: customer || null, linkedQuote: quote || null, manualItems: manualItems || [] });
}

/** Round 42 Task 122: Event-scoped equivalent of saaBomFetchJob -- loads
 *  one specific Event's own Bill of Material for the dedicated BOM page,
 *  reached via bill-of-material.html?event=<id> (the Event modal's own
 *  "Bill of Material" link -- distinct from, and in addition to, the Job
 *  Card's ?job= link). Per Vijayan: "it will have its own working
 *  control" -- an Event's Bill of Material is its own quote link, its own
 *  manually-added items, and its own numbering (see
 *  saaBomEnsureNumberForEvent/saaBomCreateOrderForEvent below), separate
 *  from the parent Job's. Returns the same shape as saaBomFetchJob
 *  (customer/linkedQuote/manualItems) so the page's existing render
 *  functions (saaBomCombinedItems etc.) work unchanged, plus a light
 *  `job` reference (job_number/title only, for a "back to Job" link) and
 *  an `isEvent: true` flag so saaBomAddItem below knows which id is which. */
async function saaBomFetchEvent(eventId) {
  const { data: event, error: e1 } = await _saaClient.from("events").select("*").eq("id", eventId).single();
  if (e1) throw e1;
  const [{ data: customer }, { data: quote }, { data: job }, manualItems] = await Promise.all([
    event.customer_id ? _saaClient.from("customers").select("*").eq("id", event.customer_id).maybeSingle() : { data: null },
    event.linked_quote_id ? _saaClient.from("quotes").select("*").eq("id", event.linked_quote_id).maybeSingle() : { data: null },
    event.job_id ? _saaClient.from("jobs").select("id,job_number,title").eq("id", event.job_id).maybeSingle() : { data: null },
    saaBomFetchItemsForEvent(eventId),
  ]);
  return Object.assign({}, event, {
    customer: customer || null,
    linkedQuote: quote || null,
    job: job || null,
    manualItems: manualItems || [],
    isEvent: true,
  });
}

/** Event-scoped equivalent of saaBomFetchItems (jobs-db.js). */
async function saaBomFetchItemsForEvent(eventId) {
  const { data, error } = await _saaClient
    .from("job_materials")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Event-scoped equivalents of saaBomEnsureNumber/saaBomCreateOrder
 *  (jobs-db.js), writing to events.bom_number/bom_order_number/
 *  bom_order_date/bom_status/bom_supplier (added by the Round 42 Task 121
 *  migration) via saaEventsUpdate instead of jobs.* via saaJobsUpdateJob.
 *  Both draw from the SAME BOM-YYYY-#### / PO-YYYY-#### sequence as the
 *  Job Card (see _saaBomNextNumber/_saaBomNextOrderNumber in jobs-db.js,
 *  now counting across both jobs and events), so numbers never collide
 *  between a Job's own BOM and one of its Events' BOMs. */
async function saaBomEnsureNumberForEvent(event) {
  try {
    if (event.bom_number) return { ok: true, bomNumber: event.bom_number };
    const firstName = event.customer ? event.customer.first_name : await _saaCustomerFirstName(event.customer_id);
    const bomNumber = await _saaBomNextNumber(firstName);
    const res = await saaEventsUpdate(event.id, { bom_number: bomNumber });
    if (!res.ok) return res;
    event.bom_number = bomNumber;
    return { ok: true, bomNumber };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

async function saaBomCreateOrderForEvent(event, supplier) {
  try {
    const numRes = await saaBomEnsureNumberForEvent(event);
    if (!numRes.ok) return numRes;
    const patch = { bom_supplier: supplier || null };
    if (!event.bom_order_number) {
      const firstName = event.customer ? event.customer.first_name : await _saaCustomerFirstName(event.customer_id);
      patch.bom_order_number = await _saaBomNextOrderNumber(firstName);
      patch.bom_order_date = new Date().toISOString().slice(0, 10);
      patch.bom_status = "ordered";
    }
    const res = await saaEventsUpdate(event.id, patch);
    if (!res.ok) return res;
    Object.assign(event, patch);
    return { ok: true, orderNumber: event.bom_order_number, orderDate: event.bom_order_date, bomNumber: event.bom_number };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Combines the worksheet-derived items (from the linked quote's saved
 *  form_state, if any) with this job's manually-added job_materials rows
 *  into one flat qty+unit list — no cost anywhere, per "no need to
 *  populate cost, just populate qty and unit in order form". */
function saaBomCombinedItems(jobDetail) {
  const derived = jobDetail.linkedQuote
    ? saaDeriveBomItemsFromFormState(jobDetail.linkedQuote.form_state, jobDetail.linkedQuote.quote_type)
    : [];
  const manual = (jobDetail.manualItems || []).map((m) => ({
    description: m.description, unit: m.unit || "ea", qty: Number(m.qty) || 1, manual: true, id: m.id, section: "Added Manually",
  }));
  return derived.map((d) => Object.assign({}, d, { manual: false })).concat(manual);
}

/** Adds one missing item to a job's Bill of Material — always recorded in
 *  job_materials (so it shows up whether or not there's a linked quote),
 *  and, best-effort, ALSO folded into the linked quote's own form_state
 *  under "_bomExtras" so the quotation's saved data is updated to include
 *  it too (only affects future re-derivations of that same quote — the
 *  visible line here already comes from job_materials, so it's not
 *  double-listed). returns: { ok, item } | { ok:false, error } */
async function saaBomAddItem(jobDetail, { description, unit, qty }) {
  try {
    description = (description || "").trim();
    if (!description) return { ok: false, error: "Enter an item description." };
    qty = Number(qty) || 1;
    unit = (unit || "ea").trim() || "ea";
    const existing = jobDetail.manualItems || [];
    // Round 42 Task 122: jobDetail can now be either a Job detail (from
    // saaBomFetchJob, jobDetail.id is the job's own id) or an Event detail
    // (from saaBomFetchEvent, jobDetail.isEvent is true and jobDetail.id is
    // the EVENT's id, with jobDetail.job_id pointing at its parent Job) --
    // this item's row needs the right id in each column either way.
    const isEvent = !!jobDetail.isEvent;
    // Round 42 Task 118: for the Job-scoped page (unchanged), auto-attaches
    // to the Job's current Event (see saaEventsGetDefaultEventId in
    // events-db.js, now loaded on this page). For the Event-scoped page,
    // the item belongs to exactly the Event this BOM page is showing.
    const eventId = isEvent
      ? jobDetail.id
      : (typeof saaEventsGetDefaultEventId === "function" ? await saaEventsGetDefaultEventId(jobDetail.id) : null);
    const insertRow = isEvent
      ? { job_id: jobDetail.job_id || null, event_id: eventId, description, qty, unit, sort_order: existing.length }
      : { job_id: jobDetail.id, event_id: eventId, description, qty, unit, sort_order: existing.length };
    const { data, error } = await _saaClient
      .from("job_materials")
      .insert(insertRow)
      .select("*")
      .single();
    if (error) throw error;
    jobDetail.manualItems = existing.concat([data]);

    if (jobDetail.linked_quote_id && jobDetail.linkedQuote) {
      try {
        const formState = Object.assign({}, jobDetail.linkedQuote.form_state || {});
        const extras = Array.isArray(formState._bomExtras) ? formState._bomExtras.slice() : [];
        extras.push({ description, unit, qty });
        formState._bomExtras = extras;
        await _saaClient.from("quotes").update({ form_state: formState }).eq("id", jobDetail.linked_quote_id);
        jobDetail.linkedQuote.form_state = formState;
      } catch (e) {
        // Best-effort only -- the item is already safely on job_materials
        // above even if this mirror-write to the quote fails.
      }
    }
    return { ok: true, item: data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Removes a manually-added item (job_materials row only — worksheet-
 *  derived items can't be removed here; toggle them off on the worksheet
 *  itself instead). returns: { ok: true } | { ok: false, error } */
async function saaBomRemoveItem(jobDetail, itemId) {
  try {
    const { error } = await _saaClient.from("job_materials").delete().eq("id", itemId);
    if (error) throw error;
    jobDetail.manualItems = (jobDetail.manualItems || []).filter((m) => m.id !== itemId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}
