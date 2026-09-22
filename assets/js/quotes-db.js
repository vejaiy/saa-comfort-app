/* ============================================================
   SAA Comfort Air LLC — Save Quote / Retrieve Quote
   Talks to the "customers" and "quotes" tables in Supabase (see
   database/README.md). Requires auth.js to have already created
   the shared _saaClient. Used by the New Installation and
   Replacement worksheet pages only.

   A saved quote stores:
     - a customer row (matched/created by exact first name + last
       name + phone; Row Level Security requires a signed-in staff
       session for all of this, same as everything else in the app)
     - a quotes row with the full worksheet state as JSON
       (form_state) so "Retrieve Saved Quote" can put the page back
       exactly the way it was left, plus a few plain columns
       (quote_number, quote_type, job_address, total) so the search
       results list can be built without unpacking that JSON.
   Saving again under the same Quote # updates that same row
   instead of creating a duplicate.
   ============================================================ */

/** Digits-only comparison key for phone numbers -- "248-494-0509" and
 *  "2484940509" are the same customer. Matching on the raw string (as this
 *  function used to) silently created a second customer row every time the
 *  same person's number was typed with different punctuation (round 12
 *  follow-up, 2026-09-13 -- confirmed to have bitten a real customer twice).
 *  Same helper duplicated in jobs-db.js/calendar-db.js since none of these
 *  files are shared/loaded together. */
function _saaPhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/** address/city/state/zip are optional -- when provided they fill in the
 *  customer's billing_* columns, and (round 12 follow-up) also backfill an
 *  EXISTING matched customer's address fields if those are still blank, so
 *  picking the same customer up again from a different intake point doesn't
 *  leave their address permanently empty. */
async function saaFindOrCreateCustomer(firstName, lastName, phone, address, city, state, zip) {
  const { data: candidates, error: findErr } = await _saaClient
    .from("customers")
    .select("id,phone,billing_address,billing_city,billing_state,billing_zip")
    .eq("first_name", firstName || "")
    .eq("last_name", lastName || "");
  if (findErr) throw findErr;
  const phoneKey = _saaPhoneKey(phone);
  const existing = (candidates || []).find((c) => _saaPhoneKey(c.phone) === phoneKey);
  if (existing) {
    const patch = {};
    if (address && !existing.billing_address) patch.billing_address = address;
    if (city && !existing.billing_city) patch.billing_city = city;
    if (state && !existing.billing_state) patch.billing_state = state;
    if (zip && !existing.billing_zip) patch.billing_zip = zip;
    if (Object.keys(patch).length) {
      await _saaClient.from("customers").update(patch).eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error: createErr } = await _saaClient
    .from("customers")
    .insert({
      first_name: firstName || null, last_name: lastName || null, phone: phone || null,
      billing_address: address || null, billing_city: city || null, billing_state: state || null, billing_zip: zip || null,
    })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return created.id;
}

/** Sequential, human-readable quote number (Q-2026-0001) — same
 *  count-based scheme jobs-db.js uses for job numbers and invoices
 *  already use for invoice numbers. Assigned automatically the first
 *  time a quote is saved; the office never types one in (round 3,
 *  2026-09-12 — previously "Quote #" was a free-text field the office
 *  had to remember to fill in and keep unique themselves). */
async function _saaNextQuoteNumber(firstName) {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .like("quote_number", `Q-${year}-%`);
  if (error) throw error;
  const base = `Q-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
  return saaAppendNameSuffix(base, firstName);
}

/**
 * payload: { quoteId (optional — pass the id of a quote already saved or
 *            retrieved this session to update it instead of creating a
 *            new one), quoteType, firstName, lastName, phone, jobAddress,
 *            total, materialCost, laborCost, otherCost, formState }
 * materialCost/laborCost/otherCost: the quote's own cost breakdown (equipment
 * + labor split the worksheet already computes for the printed line items),
 * saved as plain columns alongside `total` so the Job Card's Actual
 * Material/Labor/Other Cost fields can default from a linked quote without
 * re-parsing `form_state` (round 6 follow-up, 2026-09-13). Optional — quotes
 * saved before this existed simply have these columns null.
 * returns: { ok: true, quoteId, quoteNumber } | { ok: false, error }
 */
async function saaSaveQuote(payload) {
  try {
    if (!payload.firstName && !payload.lastName && !payload.phone) {
      return { ok: false, error: "Enter a first name, last name, or phone number first." };
    }
    const customerId = await saaFindOrCreateCustomer(
      payload.firstName, payload.lastName, payload.phone,
      payload.jobAddress, payload.city, payload.state, payload.zip
    );

    const row = {
      customer_id: customerId,
      quote_type: payload.quoteType || "",
      job_address: payload.jobAddress || null,
      total: payload.total || 0,
      material_cost: payload.materialCost != null ? payload.materialCost : null,
      labor_cost: payload.laborCost != null ? payload.laborCost : null,
      other_cost: payload.otherCost != null ? payload.otherCost : null,
      form_state: payload.formState || {},
      updated_at: new Date().toISOString(),
    };

    if (payload.quoteId) {
      const { data, error } = await _saaClient
        .from("quotes")
        .update(row)
        .eq("id", payload.quoteId)
        .select("id,quote_number")
        .single();
      if (error) throw error;
      return { ok: true, quoteId: data.id, quoteNumber: data.quote_number };
    } else {
      row.quote_number = await _saaNextQuoteNumber(payload.firstName);
      const { data, error } = await _saaClient.from("quotes").insert(row).select("id,quote_number").single();
      if (error) throw error;
      return { ok: true, quoteId: data.id, quoteNumber: data.quote_number };
    }
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * Matches on ANY ONE of first name / last name / phone (partial,
 * case-insensitive). Only non-empty fields are used as filters.
 * returns: { ok: true, results: [...] } | { ok: false, error }
 */
async function saaSearchQuotes({ firstName, lastName, phone }) {
  try {
    const clean = (s) => (s || "").trim().replace(/[%,()]/g, "");
    const f = { first: clean(firstName), last: clean(lastName), phone: clean(phone) };
    const filters = [];
    if (f.first) filters.push(`first_name.ilike.%${f.first}%`);
    if (f.last) filters.push(`last_name.ilike.%${f.last}%`);
    if (f.phone) filters.push(`phone.ilike.%${f.phone}%`);
    if (!filters.length) return { ok: false, error: "Enter at least one field to search." };

    const { data: customers, error: custErr } = await _saaClient
      .from("customers")
      .select("id, first_name, last_name, phone")
      .or(filters.join(","));
    if (custErr) throw custErr;
    if (!customers || !customers.length) return { ok: true, results: [] };

    const ids = customers.map((c) => c.id);
    const { data: quotes, error: qErr } = await _saaClient
      .from("quotes")
      .select("id, quote_number, quote_type, job_address, total, updated_at, customer_id")
      .in("customer_id", ids)
      .order("updated_at", { ascending: false });
    if (qErr) throw qErr;

    const custById = Object.fromEntries(customers.map((c) => [c.id, c]));
    const results = (quotes || []).map((q) => Object.assign({}, q, { customer: custById[q.customer_id] }));
    return { ok: true, results };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * Looks for saved quotes already on file for this exact customer
 * (first+last+phone) with the same quote type — used to warn the office
 * before creating what looks like a duplicate quote, rather than after
 * the fact. excludeId skips the quote currently being edited (updating
 * an existing quote is never a "duplicate" of itself).
 * returns: { ok: true, quotes: [...] } | { ok: false, error }
 */
async function saaFindDuplicateQuotes({ firstName, lastName, phone, quoteType, excludeId }) {
  try {
    const { data: existing, error: findErr } = await _saaClient
      .from("customers")
      .select("id")
      .eq("first_name", firstName || "")
      .eq("last_name", lastName || "")
      .eq("phone", phone || "")
      .limit(1);
    if (findErr) throw findErr;
    if (!existing || !existing.length) return { ok: true, quotes: [] };

    const { data: quotes, error: qErr } = await _saaClient
      .from("quotes")
      .select("id, quote_number, quote_type, total, updated_at")
      .eq("customer_id", existing[0].id)
      .eq("quote_type", quoteType || "");
    if (qErr) throw qErr;
    return { ok: true, quotes: (quotes || []).filter((q) => q.id !== excludeId) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Round 44 (2026-09-22), per Vijayan: "Add another provision in dashboard
 *  to view all quotes in list form similar to jobs." Every quote across
 *  every customer, newest first, with its customer and (if any) the Job
 *  it's linked to -- backs the new Quotes list page (quotes.html), same
 *  cross-record pattern as saaInvoicesFetchAll/saaJobsFetchAll. */
async function saaQuotesFetchAll() {
  const { data: quotes, error } = await _saaClient
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const custIds = [...new Set((quotes || []).map((q) => q.customer_id).filter(Boolean))];
  const jobIds = [...new Set((quotes || []).map((q) => q.job_id).filter(Boolean))];
  const [{ data: customers, error: e2 }, { data: jobs, error: e3 }] = await Promise.all([
    custIds.length
      ? _saaClient.from("customers").select("id,first_name,last_name,phone").in("id", custIds)
      : { data: [], error: null },
    jobIds.length
      ? _saaClient.from("jobs").select("id,job_number,job_type,is_current").in("id", jobIds)
      : { data: [], error: null },
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const custById = Object.fromEntries((customers || []).map((c) => [c.id, c]));
  const jobById = Object.fromEntries((jobs || []).map((j) => [j.id, j]));

  return (quotes || []).map((q) => Object.assign({}, q, {
    customer: custById[q.customer_id] || null,
    job: jobById[q.job_id] || null,
  }));
}

/** returns: { ok: true } | { ok: false, error } */
async function saaDeleteQuote(quoteId) {
  try {
    const { error } = await _saaClient.from("quotes").delete().eq("id", quoteId);
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * Renders Retrieve Saved Quote's search results into `container`
 * (normally #rq-results) — shared by the Quotation and Repair pages so
 * both list/load/delete a saved quote identically. Clicking a row loads
 * it (onLoad(quoteId)); its Delete button asks for confirmation, deletes
 * it, then calls onDeleted(quoteId) so the caller can re-run the search.
 */
function saaRenderQuoteResults(container, results, { onLoad, onDeleted }) {
  if (!results.length) {
    container.innerHTML = '<div class="quote-result-empty">No saved quotes match.</div>';
    return;
  }
  container.innerHTML = results.map((q) => {
    const c = q.customer || {};
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed";
    const when = q.updated_at ? new Date(q.updated_at).toLocaleDateString("en-US") : "";
    return `<div class="quote-result-row" data-quote-id="${q.id}">
      <div>
        <div class="name">${name}${c.phone ? " — " + saaFormatPhone(c.phone) : ""}</div>
        <div class="meta">${q.quote_number || "No #"} &middot; ${q.quote_type || ""} &middot; ${q.job_address || ""} &middot; ${when}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="name">${fmtMoney(q.total || 0)}</div>
        <button type="button" class="btn btn-ghost btn-sm" data-del-quote="${q.id}" title="Delete this saved quote">Delete</button>
      </div>
    </div>`;
  }).join("");
  container.querySelectorAll("[data-del-quote]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await saaConfirm("Delete this saved quote? This can't be undone.", { title: "Delete saved quote", okLabel: "Delete" });
      if (!ok) return;
      const result = await saaDeleteQuote(btn.dataset.delQuote);
      if (result.ok && onDeleted) onDeleted(btn.dataset.delQuote);
    });
  });
  container.querySelectorAll(".quote-result-row").forEach((row) => {
    row.addEventListener("click", () => onLoad(row.dataset.quoteId));
  });
}

/** returns: { ok: true, quote } | { ok: false, error } */
async function saaLoadQuote(quoteId) {
  try {
    const { data, error } = await _saaClient
      .from("quotes")
      .select("*, customers(first_name,last_name,phone)")
      .eq("id", quoteId)
      .single();
    if (error) throw error;
    return { ok: true, quote: data };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/* ============================================================
   "Select Existing Customer" search (round 8 follow-up, 2026-09-13)
   Lets the Quotation and Repair pages pull an existing customer
   (one already on file from a job or the Dispatch Calendar) into
   the quote intake card instead of retyping their name/phone/
   address. Mirrors saaJobsSearchCustomers (jobs-db.js) /
   saaCalSearchCustomers (calendar-db.js); duplicated rather than
   shared since neither of those files is loaded here.
   ============================================================ */

async function saaQuotesSearchCustomers(query) {
  const q = (query || "").trim().replace(/[%,()]/g, "");
  if (!q) return [];
  const { data, error } = await _saaClient
    .from("customers")
    .select("id,first_name,last_name,phone,billing_address,billing_city,billing_state,billing_zip")
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(8);
  if (error) throw error;
  return data || [];
}

/** Wires the "Select Existing Customer" search box inside
 *  quote_intake_card() (templates.py) — id="q-cust-search"/
 *  "q-cust-results". Selecting a result fills First/Last/Phone/
 *  Address and fires an input event so the page's own totals/
 *  save-state listeners pick up the change. Call once, after the
 *  page's other DOM wiring, from Quotation's and Repair's own
 *  inline <script>. No-ops quietly if the fields aren't present. */
let _saaQuoteCustSearchTimer = null;
function saaWireQuoteCustomerSearch() {
  const input = document.getElementById("q-cust-search");
  const results = document.getElementById("q-cust-results");
  if (!input || !results) return;

  input.addEventListener("input", (e) => {
    clearTimeout(_saaQuoteCustSearchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    _saaQuoteCustSearchTimer = setTimeout(async () => {
      let matches = [];
      try { matches = await saaQuotesSearchCustomers(q); } catch (err) { /* best-effort search */ }
      if (!matches.length) {
        results.innerHTML = `<div class="cal-cust-result muted">No matching customers.</div>`;
        results.hidden = false;
        return;
      }
      results.innerHTML = matches.map((c) => `
        <div class="cal-cust-result" data-id="${c.id}">
          <div class="name">${[c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)"}</div>
          ${c.phone ? `<div class="phone">${saaFormatPhone(c.phone)}</div>` : ""}
          ${c.billing_address ? `<div class="addr">${[c.billing_address, c.billing_city, c.billing_zip].filter(Boolean).join(", ")}</div>` : ""}
        </div>`).join("");
      results.hidden = false;
      results.querySelectorAll(".cal-cust-result[data-id]").forEach((row) => {
        row.addEventListener("click", () => {
          const c = matches.find((m) => m.id === row.dataset.id);
          if (!c) return;
          document.getElementById("q-first").value = c.first_name || "";
          document.getElementById("q-last").value = c.last_name || "";
          document.getElementById("q-phone").value = c.phone ? saaFormatPhone(c.phone) : "";
          document.getElementById("q-address").value = c.billing_address || "";
          if (document.getElementById("q-city")) document.getElementById("q-city").value = c.billing_city || "";
          if (document.getElementById("q-state")) document.getElementById("q-state").value = c.billing_state || "TX";
          if (document.getElementById("q-zip")) document.getElementById("q-zip").value = c.billing_zip || "";
          input.value = "";
          results.hidden = true;
          results.innerHTML = "";
          // Nudge the page's own totals/save-state listeners (bound to
          // input/change on the whole worksheet) so the newly-filled
          // fields are picked up immediately, same as if typed by hand.
          document.getElementById("q-address").dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
    }, 200);
  });

  // Clicking anywhere outside the search box closes the results list.
  document.addEventListener("click", (e) => {
    if (!results.hidden && !e.target.closest(".cal-cust-search-wrap")) results.hidden = true;
  });
}
