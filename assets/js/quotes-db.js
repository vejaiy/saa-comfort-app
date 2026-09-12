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

async function saaFindOrCreateCustomer(firstName, lastName, phone) {
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
    .insert({ first_name: firstName || null, last_name: lastName || null, phone: phone || null })
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
async function _saaNextQuoteNumber() {
  const year = new Date().getFullYear();
  const { count, error } = await _saaClient
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .like("quote_number", `Q-${year}-%`);
  if (error) throw error;
  return `Q-${year}-${String((count || 0) + 1).padStart(4, "0")}`;
}

/**
 * payload: { quoteId (optional — pass the id of a quote already saved or
 *            retrieved this session to update it instead of creating a
 *            new one), quoteType, firstName, lastName, phone, jobAddress,
 *            total, formState }
 * returns: { ok: true, quoteId, quoteNumber } | { ok: false, error }
 */
async function saaSaveQuote(payload) {
  try {
    if (!payload.firstName && !payload.lastName && !payload.phone) {
      return { ok: false, error: "Enter a first name, last name, or phone number first." };
    }
    const customerId = await saaFindOrCreateCustomer(payload.firstName, payload.lastName, payload.phone);

    const row = {
      customer_id: customerId,
      quote_type: payload.quoteType || "",
      job_address: payload.jobAddress || null,
      total: payload.total || 0,
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
      row.quote_number = await _saaNextQuoteNumber();
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
