/* ============================================================
   SAA Comfort Air LLC — Customers (employee/customers.html)
   Round 44 (2026-09-22), per Vijayan: "Add a provision in dashboard to
   see all customer profile." A cross-customer list view, same pattern as
   the Invoices/Payments lists (gen_invoices.py/gen_payments.py) -- plus a
   lightweight read-only "profile" (their Systems and Jobs) opened from a
   row, rather than a whole separate standalone Customer Detail page.
   ============================================================ */

/* Round 73 (2026-09-29), per Vijayan: the Customers list shows "System 1" and
 * "System 2" columns (with tonnage) instead of a count + a Jobs column, and the
 * profile card shows customer info, the recent job (no events) and systems.
 *
 * A "system" only counts (is ACTIVE) when it has a current Job or some real
 * details recorded -- the empty "System" records left behind by follow-up
 * visits that were converted to historical Events are hidden here (they still
 * appear on the Historic Events page). System 1 is the customer's oldest active
 * system, System 2 the next one, and so on. */

function saaSystemTonnage(system, equipmentRows) {
  const t = system && system.tonnage;
  if (t !== null && t !== undefined && t !== "" && parseFloat(t) > 0) return parseFloat(t);
  const rows = (equipmentRows || []).filter((r) => r.system_id === system.id && r.tonnage !== null && r.tonnage !== undefined && parseFloat(r.tonnage) > 0);
  const cond = rows.find((r) => r.equipment_type === "condenser") || rows[0];
  return cond ? parseFloat(cond.tonnage) : null;
}

function saaSystemTonnageLabel(tons) {
  return tons ? `${parseFloat(tons)} ton` : "";
}

/** systems/jobs/equipment for ONE customer -> ordered active systems, each
 *  { ...system, tonnage_value, currentJob, latestJob }. */
function saaCustomersActiveSystems(systems, jobs, equipmentRows) {
  const ordered = (systems || []).slice().sort((x, y) => String(x.created_at || "").localeCompare(String(y.created_at || "")));
  const out = [];
  ordered.forEach((s) => {
    const sJobs = (jobs || []).filter((j) => j.system_id === s.id).sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")));
    const currentJob = sJobs.find((j) => j.is_current !== false) || null;
    const tons = saaSystemTonnage(s, equipmentRows);
    const hasData = !!(tons || s.manufacturer || s.model_number || s.outdoor_unit || s.coil || s.indoor_unit || s.furnace_air_handler ||
      (equipmentRows || []).some((r) => r.system_id === s.id && (r.brand || r.model || r.serial_number)));
    if (!currentJob && !hasData) return;
    out.push(Object.assign({}, s, { tonnage_value: tons, currentJob, latestJob: sJobs[0] || null }));
  });
  return out;
}

/** Every customer, with their active systems (System 1 / System 2 columns). */
async function saaCustomersFetchAll() {
  const { data: customers, error } = await _saaClient
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const custIds = (customers || []).map((c) => c.id);
  const [{ data: jobs, error: e2 }, { data: systems, error: e3 }, { data: equipment, error: e4 }] = await Promise.all([
    custIds.length
      ? _saaClient.from("jobs").select("id,customer_id,system_id,is_current,created_at").in("customer_id", custIds)
      : { data: [], error: null },
    custIds.length
      ? _saaClient.from("systems").select("*").in("customer_id", custIds)
      : { data: [], error: null },
    custIds.length
      ? _saaClient.from("equipment").select("id,customer_id,system_id,equipment_type,brand,model,serial_number,tonnage").in("customer_id", custIds)
      : { data: [], error: null },
  ]);
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;

  return (customers || []).map((c) => {
    const cSystems = (systems || []).filter((s) => s.customer_id === c.id);
    const cJobs = (jobs || []).filter((j) => j.customer_id === c.id);
    const cEquip = (equipment || []).filter((r) => r.customer_id === c.id);
    const active = saaCustomersActiveSystems(cSystems, cJobs, cEquip);
    return Object.assign({}, c, {
      activeSystems: active,
      systemCount: active.length,
      jobCount: cJobs.length,
      currentJobCount: cJobs.filter((j) => j.is_current !== false).length,
    });
  });
}

/** Profile for one customer's card: contact info, ACTIVE systems, and the ONE
 *  most recent job (no events). */
async function saaCustomersFetchProfile(customerId) {
  const [{ data: customer, error: e1 }, { data: systems, error: e2 }, { data: jobs, error: e3 }, { data: equipment, error: e4 }] = await Promise.all([
    _saaClient.from("customers").select("*").eq("id", customerId).maybeSingle(),
    _saaClient.from("systems").select("*").eq("customer_id", customerId),
    _saaClient.from("jobs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
    _saaClient.from("equipment").select("id,customer_id,system_id,equipment_type,brand,model,serial_number,tonnage").eq("customer_id", customerId),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  if (e4) throw e4;
  const activeSystems = saaCustomersActiveSystems(systems || [], jobs || [], equipment || []);
  const recentJob = (jobs || [])[0] || null;
  return { customer, systems: activeSystems, activeSystems, jobs: jobs || [], recentJob };
}

/** Everything for the Historic Events page: all systems (active or not), all
 *  jobs, all events and the technician names. */
async function saaCustomersFetchHistory(customerId) {
  const [{ data: customer, error: e1 }, { data: systems, error: e2 }, { data: jobs, error: e3 }, { data: events, error: e4 }, { data: techs, error: e5 }, { data: equipment, error: e6 }] = await Promise.all([
    _saaClient.from("customers").select("*").eq("id", customerId).maybeSingle(),
    _saaClient.from("systems").select("*").eq("customer_id", customerId),
    _saaClient.from("jobs").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
    _saaClient.from("events").select("*").eq("customer_id", customerId).order("scheduled_start", { ascending: false }),
    _saaClient.from("technicians").select("id,name"),
    _saaClient.from("equipment").select("id,customer_id,system_id,equipment_type,brand,model,serial_number,tonnage").eq("customer_id", customerId),
  ]);
  for (const e of [e1, e2, e3, e4, e5, e6]) if (e) throw e;
  const active = saaCustomersActiveSystems(systems || [], jobs || [], equipment || []);
  return { customer, systems: systems || [], activeSystems: active, jobs: jobs || [], events: events || [], technicians: techs || [], equipment: equipment || [] };
}
