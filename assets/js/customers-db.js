/* ============================================================
   SAA Comfort Air LLC — Customers (employee/customers.html)
   Round 44 (2026-09-22), per Vijayan: "Add a provision in dashboard to
   see all customer profile." A cross-customer list view, same pattern as
   the Invoices/Payments lists (gen_invoices.py/gen_payments.py) -- plus a
   lightweight read-only "profile" (their Systems and Jobs) opened from a
   row, rather than a whole separate standalone Customer Detail page.
   ============================================================ */

/** Every customer, with a couple of counts (# Systems, # Jobs / # of
 *  those still current) so the list is useful at a glance without
 *  opening each one's profile. */
async function saaCustomersFetchAll() {
  const { data: customers, error } = await _saaClient
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const custIds = (customers || []).map((c) => c.id);
  const [{ data: jobs, error: e2 }, { data: systems, error: e3 }] = await Promise.all([
    custIds.length
      ? _saaClient.from("jobs").select("id,customer_id,is_current").in("customer_id", custIds)
      : { data: [], error: null },
    custIds.length
      ? _saaClient.from("systems").select("id,customer_id").in("customer_id", custIds)
      : { data: [], error: null },
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const jobCountBy = {};
  const currentJobCountBy = {};
  const sysCountBy = {};
  (jobs || []).forEach((j) => {
    jobCountBy[j.customer_id] = (jobCountBy[j.customer_id] || 0) + 1;
    if (j.is_current !== false) currentJobCountBy[j.customer_id] = (currentJobCountBy[j.customer_id] || 0) + 1;
  });
  (systems || []).forEach((s) => { sysCountBy[s.customer_id] = (sysCountBy[s.customer_id] || 0) + 1; });

  return (customers || []).map((c) => Object.assign({}, c, {
    jobCount: jobCountBy[c.id] || 0,
    currentJobCount: currentJobCountBy[c.id] || 0,
    systemCount: sysCountBy[c.id] || 0,
  }));
}

/** Full profile for one customer -- their Systems and Jobs -- for the
 *  Customers List's row-click profile panel.
 *
 *  Round 48 follow-up (2026-09-24), per Vijayan: "Make sure system
 *  information is linked with customer information in customer tab view."
 *  Each System is one physical piece of equipment permanently tied to
 *  exactly one Job (Customer -> System -> Job -> Event, same as
 *  systems-db.js's own saaSystemsFetchByCustomerWithJobs, which does this
 *  same join for other callers) -- this profile's own Systems list used to
 *  show name/manufacturer/tonnage only, with no link back to which Job it
 *  belongs to, so there was no way to tell which System a given visit was
 *  actually for, or jump straight to it, from this panel. Reuses the Jobs
 *  already fetched below rather than a second query. */
async function saaCustomersFetchProfile(customerId) {
  const [{ data: customer, error: e1 }, { data: systems, error: e2 }, { data: jobs, error: e3 }] = await Promise.all([
    _saaClient.from("customers").select("*").eq("id", customerId).maybeSingle(),
    _saaClient.from("systems").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
    _saaClient.from("jobs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  const jobBySystem = Object.fromEntries((jobs || []).filter((j) => j.system_id).map((j) => [j.system_id, j]));
  const systemsWithJob = (systems || []).map((s) => Object.assign({}, s, { job: jobBySystem[s.id] || null }));
  return { customer, systems: systemsWithJob, jobs: jobs || [] };
}
