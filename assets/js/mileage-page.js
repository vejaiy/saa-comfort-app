/* ============================================================
   SAA Comfort Air LLC — Mileage reporting page (employee/mileage.html)
   Lists every technician's driving legs (mileage_logs, via
   mileage-db.js), with technician/date filters, per-technician
   totals, and a form to add a standalone manual trip that isn't
   tied to any job. Per-job legs are still calculated/edited on
   that job's own Job Card — this page is for the overview plus
   the occasional trip that has no job behind it.
   Requires auth.js (_saaClient), jobs-db.js (saaJobsFetchTechnicians),
   maps-config.js and mileage-db.js to already be loaded.
   ============================================================ */

let _mpTechnicians = [];
let _mpEntries = [];

function _mpFmtDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function _mpJobLabel(job) {
  if (!job) return "";
  const custName = job.customer ? `${job.customer.first_name || ""} ${job.customer.last_name || ""}`.trim() : "";
  const base = job.job_number ? `${job.job_number}${job.title ? " · " + job.title : ""}` : (job.title || "");
  return custName ? `${base}${base ? " · " : ""}${custName}` : base;
}

async function _mpLoadTechnicians() {
  _mpTechnicians = await saaJobsFetchTechnicians();
  const opts = `<option value="">All Technicians</option>` + _mpTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
  document.getElementById("mp-tech-filter").innerHTML = opts;
  document.getElementById("mp-add-tech").innerHTML = `<option value="">Select…</option>` + _mpTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
}

function _mpRenderTotals() {
  const totalsEl = document.getElementById("mp-totals");
  if (!_mpEntries.length) { totalsEl.textContent = "No trips in range yet."; return; }
  const byTech = {};
  let grand = 0;
  for (const e of _mpEntries) {
    const name = e.technician ? e.technician.name : "Unassigned";
    byTech[name] = (byTech[name] || 0) + (Number(e.miles) || 0);
    grand += Number(e.miles) || 0;
  }
  const parts = Object.entries(byTech)
    .sort((a, b) => b[1] - a[1])
    .map(([name, miles]) => `${name}: ${miles.toFixed(1)} mi`);
  totalsEl.innerHTML = `<strong>Total: ${grand.toFixed(1)} miles</strong> &nbsp;&middot;&nbsp; ${parts.join(" &nbsp;&middot;&nbsp; ")}`;
}

function _mpRenderTable() {
  const tbody = document.getElementById("mp-tbody");
  const empty = document.getElementById("mp-empty");
  if (!_mpEntries.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  tbody.innerHTML = _mpEntries.map((e) => {
    // Round 35 ("update miles to include to and from"): a return_to_shop
    // row shares its job_id with that job's own arrival ("trip") leg --
    // without a distinct label here the two rows would look like
    // duplicates of the same trip instead of the outbound and return legs
    // of one job.
    const isReturn = e.leg_type === "return_to_shop";
    const legCell = isReturn ? "Return" : (e.leg_order >= 99 ? "—" : e.leg_order);
    const jobLabel = _mpJobLabel(e.job) || '<span class="muted">(none)</span>';
    const jobCell = isReturn ? `${jobLabel} <span class="muted" style="font-size:.8em">(return to shop)</span>` : jobLabel;
    return `
    <tr data-id="${e.id}">
      <td>${e.technician ? e.technician.name : "—"}</td>
      <td>${_mpFmtDate(e.log_date)}</td>
      <td>${legCell}</td>
      <td>${e.from_address || "—"}</td>
      <td>${e.to_address || "—"}</td>
      <td>${jobCell}</td>
      <td><input type="number" step="0.1" min="0" class="mp-miles-input" data-id="${e.id}" value="${e.miles != null ? e.miles : ""}" style="width:80px"></td>
      <td>${e.source === "manual" ? "Manual" : "Auto"}</td>
      <td><button type="button" class="jb-photo-del mp-del-btn" data-id="${e.id}" title="Delete entry" style="position:static">&times;</button></td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".mp-miles-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const id = input.dataset.id;
      const val = input.value.trim() === "" ? null : parseFloat(input.value);
      const res = await saaMileageUpdateEntry(id, { miles: val, source: "manual" });
      if (res.ok) {
        const entry = _mpEntries.find((e) => e.id === id);
        if (entry) { entry.miles = val; entry.source = "manual"; }
        _mpRenderTable();
        _mpRenderTotals();
      } else {
        _jbMpToast(res.error, true);
      }
    });
  });
  tbody.querySelectorAll(".mp-del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const ok = await saaConfirm("Delete this mileage entry? This can't be undone.", { title: "Delete entry", okLabel: "Delete", cancelLabel: "Cancel" });
      if (!ok) return;
      const res = await saaMileageDeleteEntry(id);
      if (res.ok) {
        _mpEntries = _mpEntries.filter((e) => e.id !== id);
        _mpRenderTable();
        _mpRenderTotals();
      } else {
        _jbMpToast(res.error, true);
      }
    });
  });
}

/** Small ad-hoc toast — this page doesn't load jobs.js's _jbToast, so it
 *  gets its own minimal version rather than pulling that whole file in. */
function _jbMpToast(msg, isError) {
  let el = document.getElementById("mp-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mp-toast";
    el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c2b3a;color:#fff;padding:10px 18px;border-radius:8px;font-size:.88rem;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.2)";
    document.body.appendChild(el);
  }
  el.style.background = isError ? "#b42318" : "#1c2b3a";
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function _mpLoadEntries() {
  const technicianId = document.getElementById("mp-tech-filter").value || undefined;
  const dateFrom = document.getElementById("mp-date-from").value || undefined;
  const dateTo = document.getElementById("mp-date-to").value || undefined;
  const jobQuery = document.getElementById("mp-job-search").value.trim() || undefined;
  _mpEntries = await saaMileageFetchAll({ technicianId, dateFrom, dateTo, jobQuery });
  _mpRenderTable();
  _mpRenderTotals();
}

/* ---- Year-End Tax Summary ---- */

let _mpLastTaxSummary = null;

function _mpCsvField(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function _mpRunTaxSummary() {
  const yearInput = document.getElementById("mp-tax-year");
  const resultsEl = document.getElementById("mp-tax-results");
  const printBtn = document.getElementById("mp-tax-print-btn");
  const csvBtn = document.getElementById("mp-tax-csv-btn");
  const year = parseInt(yearInput.value, 10) || new Date().getFullYear();
  yearInput.value = year;
  resultsEl.innerHTML = '<span class="muted">Generating&hellip;</span>';
  printBtn.hidden = true;
  csvBtn.hidden = true;

  const entries = await saaMileageFetchAll({ dateFrom: `${year}-01-01`, dateTo: `${year}-12-31` });
  const byTech = {};
  let grandTotal = 0, tripCountTotal = 0;
  for (const e of entries) {
    const name = e.technician ? e.technician.name : "Unassigned";
    if (!byTech[name]) byTech[name] = { technicianName: name, tripCount: 0, miles: 0 };
    byTech[name].tripCount += 1;
    byTech[name].miles += Number(e.miles) || 0;
    tripCountTotal += 1;
    grandTotal += Number(e.miles) || 0;
  }
  const rows = Object.values(byTech).sort((a, b) => b.miles - a.miles);
  _mpLastTaxSummary = { year, rows, grandTotal, tripCountTotal, generatedOn: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) };

  if (!rows.length) {
    resultsEl.innerHTML = `<p class="muted">No mileage logged for ${year} yet.</p>`;
    return;
  }
  resultsEl.innerHTML = `
    <table class="jobs-table">
      <thead><tr><th>Technician</th><th>Trips</th><th>Total Miles</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.technicianName}</td><td>${r.tripCount}</td><td>${r.miles.toFixed(1)}</td></tr>`).join("")}
        <tr style="font-weight:800;border-top:2px solid var(--navy)"><td>Company Total</td><td>${tripCountTotal}</td><td>${grandTotal.toFixed(1)}</td></tr>
      </tbody>
    </table>`;
  printBtn.hidden = false;
  csvBtn.hidden = false;
}

function _mpDownloadTaxCsv() {
  if (!_mpLastTaxSummary) return;
  const { year, rows, grandTotal, tripCountTotal } = _mpLastTaxSummary;
  const lines = [["Technician", "Trips", "Total Miles"].join(",")];
  rows.forEach((r) => lines.push([_mpCsvField(r.technicianName), r.tripCount, r.miles.toFixed(1)].join(",")));
  lines.push([_mpCsvField("Company Total"), tripCountTotal, grandTotal.toFixed(1)].join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SAA-mileage-tax-summary-${year}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener("DOMContentLoaded", async () => {
  // auth.js's guard reveals the body once signed-in; give it a tick.
  await _mpLoadTechnicians();
  await _mpLoadEntries();
  document.getElementById("mp-tax-year").value = new Date().getFullYear();

  document.getElementById("mp-tech-filter").addEventListener("change", _mpLoadEntries);
  document.getElementById("mp-date-from").addEventListener("change", _mpLoadEntries);
  document.getElementById("mp-date-to").addEventListener("change", _mpLoadEntries);
  let _mpSearchTimer = null;
  document.getElementById("mp-job-search").addEventListener("input", () => {
    clearTimeout(_mpSearchTimer);
    _mpSearchTimer = setTimeout(_mpLoadEntries, 250);
  });
  document.getElementById("mp-clear-btn").addEventListener("click", () => {
    document.getElementById("mp-tech-filter").value = "";
    document.getElementById("mp-date-from").value = "";
    document.getElementById("mp-date-to").value = "";
    document.getElementById("mp-job-search").value = "";
    _mpLoadEntries();
  });

  document.getElementById("mp-tax-run-btn").addEventListener("click", _mpRunTaxSummary);
  document.getElementById("mp-tax-print-btn").addEventListener("click", () => {
    if (_mpLastTaxSummary) printMileageSummary(_mpLastTaxSummary);
  });
  document.getElementById("mp-tax-csv-btn").addEventListener("click", _mpDownloadTaxCsv);

  document.getElementById("mp-add-btn").addEventListener("click", async () => {
    const status = document.getElementById("mp-add-status");
    const technicianId = document.getElementById("mp-add-tech").value;
    const logDate = document.getElementById("mp-add-date").value;
    const toAddress = document.getElementById("mp-add-to").value.trim();
    const fromAddress = document.getElementById("mp-add-from").value.trim();
    const miles = document.getElementById("mp-add-miles").value;
    const notes = document.getElementById("mp-add-notes").value.trim();
    if (!technicianId || !logDate || !toAddress) {
      status.textContent = "Technician, date, and a destination address are required.";
      return;
    }
    status.textContent = "Saving…";
    const res = await saaMileageAddManualEntry({
      technicianId, logDate, fromAddress: fromAddress || undefined, toAddress,
      miles: miles === "" ? null : parseFloat(miles), notes,
    });
    if (res.ok) {
      status.textContent = "Trip added.";
      document.getElementById("mp-add-to").value = "";
      document.getElementById("mp-add-from").value = "";
      document.getElementById("mp-add-miles").value = "";
      document.getElementById("mp-add-notes").value = "";
      await _mpLoadEntries();
    } else {
      status.textContent = "Error: " + res.error;
    }
  });
});
