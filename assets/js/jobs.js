/* ============================================================
   SAA Comfort Air LLC — Jobs Master List (employee/jobs.html)
   Rendering + interaction layer on top of jobs-db.js: the table,
   its filters/search, the New Job popup (customer search / inline
   create, same pattern as the Dispatch Calendar's New Service
   popup), and the full Job Card detail modal (equipment, diagnosis,
   quote link, cost/profit, invoice + payments, signature, notes).
   ============================================================ */

let _jbAllJobs = [];
let _jbTechnicians = [];
let _jbSelectedCust = null; // { id } or { isNew, customer: {...} } — New Job popup
let _jbCurrentJob = null; // the job object currently open in the detail modal
let _jbAutosaveTimer = null; // Round 26 (2026-09-14) autosave debounce -- see jbScheduleAutosave
let _jbEquipByType = { condenser: null, coil: null, furnace: null };
let _jbCurrentInvoice = null;
let _jbCurrentPayments = [];
let _jbNewPriority = "normal";
let _jbConvertingQuote = null; // the quote object picked via "Start from a Quote" in the New Job popup
let _jbQuoteSearchTimer = null;
let _jbPhotos = []; // every job_photos row for the open job (general + inspection-linked)
let _jbInspectionResults = []; // [{index, item, checked}] — synced with INSPECTION_ITEMS by index
let _jbWarrantyFiles = []; // every job_warranty_files row for the open job
let _jbSystem = null; // Round 42 (2026-09-19): the open job's System row (systems-db.js)
let _jbEvents = []; // Round 42: the open job's full Event History, newest first (events-db.js)
let _jbEventModalMode = null; // "create" | "edit" -- which flow jb-event-modal is currently in
let _jbEventModalTarget = null; // the Event object being edited, or null in "create" mode
let _jbEventCompletedAtOpen = { date: "", time: "" }; // Round 42 Task 120: change-detection so Save doesn't re-stamp an unedited (possibly estimated) Completed Time -- same idea as job._jbCompletedTimeAtOpen

// Round 44 (2026-09-22), per Vijayan: "Redo jobs page view ... add + (expand
// button) and show its events underneath it kind of group function in excel
// ... so I can get to events directly from jobs page instead of opening the
// job and looking for events i want." Which Job rows are currently expanded
// on the Jobs List -- a plain Set of job ids, kept across re-renders (search/
// filter/sort) so toggling a row open doesn't collapse again just because the
// table re-drew, but reset on a fresh full load (jbLoadAll).
let _jbExpandedJobIds = new Set();

/* Round 42 Task 121-124: per-Event full working controls (Quote/
 * Financials/Mileage/Photos/Receipts/Invoice & Payment/Inspection/BOM),
 * mirroring the Job Card's own "jb*"/"_jb*" state one level down, scoped to
 * whichever ONE Event is open in jb-event-modal (_jbEventModalTarget above)
 * rather than the whole Job. Per Vijayan: "event is once a full job ...
 * all information and control for old job should be passed to that
 * particular event." Mileage/Photos/Receipts/Invoice & Payment/Inspection/
 * BOM all need a real event_id to attach to, so they render a "Save this
 * Event first" placeholder in create mode and go fully live once the
 * Event has been saved once (same as the Job Card's own sections are only
 * ever shown after a Job already exists) -- Quote linking and Financials
 * don't need that wait, since they're either plain columns flushed via the
 * same create-then-follow-up-patch pattern jbSaveEventModal already uses
 * for Notes/Signature (detailFields), or (Quote) deferred via
 * _jbePendingQuote below and applied the moment the Event is created. */
let _jbeCurrentInvoice = null; // the open Event's own current Invoice (invoices.event_id)
let _jbeCurrentPayments = [];
let _jbePhotos = []; // every job_photos row for the open EVENT (general + receipts + inspection-linked)
let _jbeInspectionResults = []; // [{index, item, checked}] for the open Event's own separate checklist
let _jbePendingQuote = null; // a quote picked before the Event has been saved yet (create mode) -- linked on Save
let _jbeMileageAtOpen = { primary: "", 2: "", 3: "" }; // change-detection for the Event modal's Mileage fields, same idea as job._jbMileageMilesAtOpen
let _jbInspModalTarget = "job"; // "job" | "event" -- which one the shared jb-inspection-modal is currently open for (see jbOpenInspectionModal/jbeOpenInspectionModal)

function _jbToast(msg, isError) {
  const el = document.getElementById("jb-toast");
  el.textContent = msg;
  el.style.background = isError ? "var(--danger)" : "var(--navy)";
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function _jbFormatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00` : dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function _jbCustName(c) {
  if (!c) return "—";
  return [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
}

/** Round 22 (2026-09-14): "Add provision to change customer name and
 *  phone number" -- the Job Card's Customer box used to be plain,
 *  read-only text. This renders it with a small "Edit" button that
 *  swaps in first/last name + phone fields, and writes straight to the
 *  customers table (via saaCustomersUpdateContact) so a correction shows
 *  up everywhere else this customer appears too, not just on this job. */
function jbRenderCustomerBox(job) {
  const box = document.getElementById("jbd-customer");
  const c = job.customer;
  box.innerHTML = `<div id="jbd-cust-view">
      <strong>${_jbCustName(c)}</strong>
      ${c && c.phone ? ` &middot; <a href="tel:${c.phone}">${saaFormatPhone(c.phone)}</a>` : ""}
      ${c && c.email ? ` &middot; ${c.email}` : ""}
      ${c ? `<button type="button" class="btn btn-ghost btn-sm" id="jbd-cust-edit-btn" style="margin-left:8px" title="Edit customer information">✎ Edit</button>` : ""}
    </div>
    <div id="jbd-cust-edit" hidden style="margin-top:6px">
      <div class="field-row field-row-3">
        <div class="field"><label>First Name</label><input type="text" id="jbd-cust-first"></div>
        <div class="field"><label>Last Name</label><input type="text" id="jbd-cust-last"></div>
        <div class="field"><label>Phone</label><input type="tel" id="jbd-cust-phone"></div>
      </div>
      <button type="button" class="btn btn-navy btn-sm" id="jbd-cust-save-btn">Save</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-cust-cancel-btn">Cancel</button>
      <span class="muted" id="jbd-cust-edit-err" style="margin-left:8px;color:#b3261e"></span>
    </div>`;

  if (!c) return;
  const editBtn = document.getElementById("jbd-cust-edit-btn");
  const viewEl = document.getElementById("jbd-cust-view");
  const editEl = document.getElementById("jbd-cust-edit");
  editBtn.addEventListener("click", () => {
    document.getElementById("jbd-cust-first").value = c.first_name || "";
    document.getElementById("jbd-cust-last").value = c.last_name || "";
    document.getElementById("jbd-cust-phone").value = c.phone || "";
    document.getElementById("jbd-cust-edit-err").textContent = "";
    viewEl.hidden = true;
    editEl.hidden = false;
    document.getElementById("jbd-cust-first").focus();
  });
  document.getElementById("jbd-cust-cancel-btn").addEventListener("click", () => {
    editEl.hidden = true;
    viewEl.hidden = false;
  });
  document.getElementById("jbd-cust-save-btn").addEventListener("click", async () => {
    const errEl = document.getElementById("jbd-cust-edit-err");
    const saveBtn = document.getElementById("jbd-cust-save-btn");
    const fields = {
      first_name: document.getElementById("jbd-cust-first").value,
      last_name: document.getElementById("jbd-cust-last").value,
      phone: document.getElementById("jbd-cust-phone").value,
    };
    if (!fields.first_name.trim()) {
      errEl.textContent = "First name is required.";
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const res = await saaCustomersUpdateContact(c.id, fields);
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
    if (!res.ok) {
      errEl.textContent = res.error;
      return;
    }
    // Update every in-memory copy of this customer (this job plus any
    // other job/quote rows already loaded) so the Jobs list, other open
    // jobs for the same customer, etc. all reflect the edit without a
    // full page reload.
    Object.assign(c, res.customer);
    jbRenderCustomerBox(job);
    _jbToast("Customer updated.");
    jbLoadAll();
  });
}

/** Real sequential job number (J-2026-0001), assigned once at creation —
 *  see _saaJobsNextJobNumber in jobs-db.js. Falls back to the old
 *  "JOB-<uuid8>" display only for a job row from before this existed. */
function _jbJobNum(job) {
  return (job && job.job_number) || ("JOB-" + ((job && job.id) || "").slice(0, 8).toUpperCase());
}

const _jbStatusLabel = Object.fromEntries(SAA_JOBS_STATUS_OPTIONS);
// Round 43 (2026-09-22): 'converted_to_event' is deliberately left OUT of
// SAA_JOBS_STATUS_OPTIONS (the curated list that fills the Status <select>
// on the Job Card and the Jobs List's Status filter) so it can never be
// manually picked -- it's only ever set by the conversion transaction.
// Special-cased here instead of just adding it to that list.
function _jbJobStatusLabel(j) {
  if (j.status === "converted_to_event") return "Converted to Event";
  return _jbStatusLabel[j.status] || j.status;
}
const _jbPriorityLabel = Object.fromEntries(SAA_JOBS_PRIORITY_OPTIONS);
const _jbPaymentLabel = { unpaid: "Unpaid", partial: "Partially Paid", paid: "Paid" };
const _jbInvoiceLabel = { draft: "Draft", sent: "Sent", partial: "Partially Paid", paid: "Paid", overdue: "Overdue", void: "Void" };

function _jbOptionsHtml(pairs, selected) {
  return pairs.map(([v, l]) => `<option value="${v}"${v === selected ? " selected" : ""}>${l}</option>`).join("");
}

/* ============================== Table: columns, filters, sort ============================== */

/* Round 24: "add filter and sort options for each column in Jobs" -- the
 * Job Type/Status/Priority/Technician/Payment dropdowns already filtered
 * (they just lived in a toolbar above the table, disconnected from their
 * column); the other six columns had no per-column filter at all, and
 * nothing anywhere let you sort. Each column now carries its own filter
 * control directly under its header, and clicking any header sorts by
 * it (click again to flip direction).
 *
 * `sortVal` returns the value to compare for that column. Text columns
 * are lower-cased for a case-insensitive sort; a job with no scheduled
 * date, no assigned technician, or no quote returns `null` from
 * `sortVal`, which jbApplyFilters' comparator always sorts to the end,
 * in EITHER direction (Round 31 fix -- these three previously used a
 * sentinel value multiplied by the sort direction like every other
 * value, so a blank only actually sorted last in ascending order; flipped
 * to descending, it sorted first instead, silently contradicting this
 * exact comment).
 */
const _JB_COLUMNS = [
  { key: "jobnum", filterId: "jb-filter-jobnum", kind: "text",
    matchText: (j) => _jbJobNum(j), sortVal: (j) => _jbJobNum(j).toLowerCase() },
  { key: "received", filterId: "jb-filter-received", kind: "text",
    matchText: (j) => _jbFormatDate(j.created_at), sortVal: (j) => j.created_at || "" },
  { key: "scheduled", filterId: "jb-filter-scheduled", kind: "text",
    matchText: (j) => _jbFormatDate(j.scheduled_date), sortVal: (j) => j.scheduled_date || null },
  { key: "customer", filterId: "jb-filter-customer", kind: "text",
    matchText: (j) => _jbCustName(j.customer), sortVal: (j) => _jbCustName(j.customer).toLowerCase() },
  { key: "phone", filterId: "jb-filter-phone", kind: "text",
    matchText: (j) => (j.customer && j.customer.phone ? saaFormatPhone(j.customer.phone) : ""), sortVal: (j) => (j.customer && j.customer.phone) || "" },
  { key: "address", filterId: "jb-filter-address", kind: "text",
    matchText: (j) => [j.job_address, j.job_city].filter(Boolean).join(", "), sortVal: (j) => [j.job_address, j.job_city].filter(Boolean).join(", ").toLowerCase() },
  { key: "type", filterId: "jb-filter-type", kind: "select",
    matchValue: (j) => j.job_type, sortVal: (j) => saaJobTypeLabel(j.job_type).toLowerCase() },
  { key: "priority", filterId: "jb-filter-priority", kind: "select",
    matchValue: (j) => j.priority, sortVal: (j) => SAA_JOBS_PRIORITY_OPTIONS.findIndex(([v]) => v === j.priority) },
  // Round 25 (2026-09-14) multi-technician support: filtering by a
  // technician now matches a job they're assigned to in ANY slot
  // (primary or helper) -- matchValue returns an array here instead of a
  // scalar; jbApplyFilters' select-kind branch below checks membership
  // when it sees an array. Sort still orders by the PRIMARY technician's
  // name only, same as before.
  { key: "tech", filterId: "jb-filter-tech", kind: "select",
    matchValue: (j) => [j.assigned_technician_id, j.assigned_technician_id_2, j.assigned_technician_id_3].filter(Boolean),
    sortVal: (j) => (j.technician ? j.technician.name.toLowerCase() : null) },
  { key: "status", filterId: "jb-filter-status", kind: "select",
    matchValue: (j) => j.status, sortVal: (j) => SAA_JOBS_STATUS_OPTIONS.findIndex(([v]) => v === j.status) },
  { key: "payment", filterId: "jb-filter-payment", kind: "select",
    matchValue: (j) => j.paymentStatus, sortVal: (j) => ({ unpaid: 0, partial: 1, paid: 2 }[j.paymentStatus] ?? 9) },
  // Round 26 (2026-09-14), per Vijayan: "add a column to show associated
  // quotation $ amount and when the $ amount is clicked it should open up
  // the quotation." Filter matches either the formatted amount or the
  // quote number; missing-quote jobs sort as if their amount were
  // infinite, same "always sorts last" idea _jbQuoteAmount's sibling
  // columns use for their own blank values.
  { key: "quote", filterId: "jb-filter-quote", kind: "text",
    matchText: (j) => [_jbQuoteAmount(j) != null ? fmtMoney(_jbQuoteAmount(j)) : "", j.linkedQuote && j.linkedQuote.quote_number].filter(Boolean).join(" "),
    sortVal: (j) => _jbQuoteAmount(j) },
];

/** The $ amount to show in the Jobs list's Quote $ column: the job's own
 *  quoted_amount if it has one, else the linked quote's total (covers a
 *  job that was linked to a quote before quoted_amount existed on it),
 *  else null (no quote associated at all -- renders as "—", not clickable). */
/** Round 25 (2026-09-14) multi-technician support: the Jobs list
 *  Technician column now lists everyone assigned to the job (primary
 *  first), not just the primary -- "None" when nobody's assigned at all. */
function _jbTechDisplayNames(j) {
  const names = [j.technician, j.technician2, j.technician3].filter(Boolean).map((t) => t.name);
  return names.length ? names.join(", ") : "None";
}

// Round 37 (2026-09-17), per Vijayan's annotated screenshot ("This job is
// only $250 with $50 discount" against a job showing Quote $ "$300.00"):
// quoted_amount is a one-time snapshot taken when a quote is linked to a
// job (saaJobsLinkQuote) and never updated again, but an invoice's
// Discount/Additional Charges (jbd-inv-discount, saaJobsInvoiceTotalDue)
// are exactly the kind of after-the-fact adjustment that can leave it
// stale -- once a job has an invoice, that invoice's actual Total Due is
// the truth about what the job is really for, so it now wins over the
// frozen quoted_amount/linked-quote total.
function _jbQuoteAmount(j) {
  if (j.invoice) return saaJobsInvoiceTotalDue(j.invoice);
  if (j.quoted_amount != null && j.quoted_amount !== "") return j.quoted_amount;
  if (j.linkedQuote && j.linkedQuote.total != null) return j.linkedQuote.total;
  return null;
}

function _jbQuoteCellHtml(j) {
  const amt = _jbQuoteAmount(j);
  if (amt == null) return "—";
  // A quoted_amount can exist with no linked_quote_id at all (typed
  // straight into the Job Card, no saved quote behind it) -- show the
  // number but don't make it a dead link. Repair-worksheet quotes save
  // with quote_type "repair" and live on repair.html, not quotation.html.
  if (!j.linked_quote_id) return fmtMoney(amt);
  const page = (j.linkedQuote && j.linkedQuote.quote_type === "repair") ? "repair.html" : "quotation.html";
  return `<button type="button" class="jb-quote-link" data-quote-id="${j.linked_quote_id}" data-quote-page="${page}">${fmtMoney(amt)}</button>`;
}

// Round 31 (2026-09-15), per Vijayan: "Always open the job page with
// schedule date filtered from newest to oldest" -- the Jobs list now
// defaults to sorting by Scheduled, newest first, instead of opening
// unsorted (natural DB order, newest-CREATED first). _JB_DEFAULT_SORT is
// also what "Clear Filters & Sort" resets to, so that button restores the
// same default view a fresh page load shows, not a different one.
const _JB_DEFAULT_SORT = { key: "scheduled", dir: -1 };
let _jbSort = Object.assign({}, _JB_DEFAULT_SORT);

function jbApplyFilters() {
  const q = (document.getElementById("jb-search").value || "").trim().toLowerCase();

  const colFilters = _JB_COLUMNS.map((col) => ({
    col,
    value: col.kind === "text"
      ? (document.getElementById(col.filterId).value || "").trim().toLowerCase()
      : document.getElementById(col.filterId).value,
  })).filter((cf) => cf.value);

  // Round 43 (2026-09-22), spec item 23: "Job search needs Current/
  // Historical/All filters, default Current Jobs." A standalone dropdown
  // rather than a _JB_COLUMNS entry, since it isn't a real table column --
  // it filters on is_current, which has no column of its own in the grid.
  const currentFilterEl = document.getElementById("jb-filter-current");
  const currentFilter = currentFilterEl ? currentFilterEl.value : "current";

  let rows = _jbAllJobs.filter((j) => {
    if (currentFilter === "current" && j.is_current === false) return false;
    if (currentFilter === "historical" && j.is_current !== false) return false;
    for (const { col, value } of colFilters) {
      if (col.kind === "select") {
        const mv = col.matchValue(j);
        if (Array.isArray(mv) ? !mv.includes(value) : mv !== value) return false;
      } else if (!col.matchText(j).toLowerCase().includes(value)) {
        return false;
      }
    }
    if (q) {
      const hay = [
        _jbCustName(j.customer), j.customer && j.customer.phone, j.job_address, j.job_city, j.job_zip, j.title,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (_jbSort.key) {
    const col = _JB_COLUMNS.find((c) => c.key === _jbSort.key);
    if (col) {
      rows = rows.slice().sort((a, b) => {
        const va = col.sortVal(a), vb = col.sortVal(b);
        // A blank (null) value always sorts last, regardless of sort
        // direction -- see the _JB_COLUMNS comment above (Round 31 fix).
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (va < vb) return -1 * _jbSort.dir;
        if (va > vb) return 1 * _jbSort.dir;
        return 0;
      });
    }
  }

  return rows;
}

function _jbUpdateSortArrows() {
  document.querySelectorAll(".jb-sort-arrow").forEach((el) => {
    const isActive = el.dataset.arrow === _jbSort.key;
    el.classList.toggle("active", isActive);
    el.textContent = isActive ? (_jbSort.dir === 1 ? "▲" : "▼") : "▲▼";
  });
}

/** Vijayan: "Make filtered column title in bright color" -- a column
 *  whose own filter box (text or dropdown) currently has a value gets its
 *  header title highlighted in the brand orange, so it's obvious at a
 *  glance which columns are actively narrowing the list, separate from
 *  the small sort-direction arrow (which only shows the active SORT
 *  column, not which ones are filtered). */
function _jbUpdateFilterHeaderHighlight() {
  _JB_COLUMNS.forEach((col) => {
    const input = document.getElementById(col.filterId);
    const label = document.querySelector(`.jb-sortable[data-sort="${col.key}"] .jb-th-label`);
    if (!input || !label) return;
    const active = !!(input.value || "").trim();
    label.classList.toggle("jb-th-filtered", active);
  });
}

// Round 44: total column count of the main table (the expand toggle column
// plus the 12 data columns) -- the nested Event row spans all of them with
// one colspan'd cell so its content can be indented under the Job # column
// without needing to line up under every individual column.
const _JB_TABLE_COLSPAN = 13;

function _jbEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One Event's label for the Jobs List expand-row: event number FIRST
 *  (per Vijayan: "show event number in before event name"), then its type,
 *  status badge, and scheduled time -- deliberately more compact than the
 *  Job Card's own Event History timeline (jbRenderEventTimeline), since
 *  this is a quick-scan/quick-jump list, not the full detail view. */
function _jbEventRowHtml(job, e) {
  const techNames = [e.technician, e.technician2, e.technician3].filter(Boolean).map((t) => t.name).join(", ");
  return `
    <tr class="jb-event-subrow" data-job-id="${job.id}" data-event-id="${e.id}">
      <td colspan="${_JB_TABLE_COLSPAN}">
        <div class="jb-event-subrow-inner">
          <span class="jb-event-subrow-num">${_jbEsc(e.event_number || "—")}</span>
          <span class="jb-event-subrow-sep">&mdash;</span>
          <span class="jb-event-subrow-type">${_jbEsc(saaEventTypeLabel(e.event_type))}</span>
          <span class="jb-event-badge evt-${e.event_status}">${_jbEsc(saaEventStatusLabel(e.event_status))}</span>
          <span class="jb-event-subrow-meta">${_jbEventTimeLabel(e.scheduled_start)}${techNames ? " · " + _jbEsc(techNames) : ""}</span>
        </div>
      </td>
    </tr>`;
}

function _jbToggleExpandRow(jobId) {
  if (_jbExpandedJobIds.has(jobId)) _jbExpandedJobIds.delete(jobId);
  else _jbExpandedJobIds.add(jobId);
  jbRenderTable();
}

function jbRenderTable() {
  const tbody = document.getElementById("jb-tbody");
  if (!tbody) return; // embedded Job Card context (e.g. calendar.html) has no Jobs List table
  const rows = jbApplyFilters();
  document.getElementById("jb-empty").hidden = rows.length > 0;
  tbody.innerHTML = rows.map((j) => {
    const events = j.events || [];
    const expanded = _jbExpandedJobIds.has(j.id);
    // Round 44: the expand toggle is only shown when there's something to
    // expand -- a Job with no Events yet gets a blank cell instead of a
    // button that would just open an empty group.
    const expandCell = events.length
      ? `<button type="button" class="jb-expand-btn" data-id="${j.id}" title="${expanded ? "Collapse" : "Expand"} events" aria-label="${expanded ? "Collapse" : "Expand"} events">${expanded ? "−" : "+"}</button>`
      : "";
    const mainRow = `
    <tr class="jb-row" data-id="${j.id}">
      <td class="jb-expand-cell">${expandCell}</td>
      <td>${_jbJobNum(j)}</td>
      <td>${_jbFormatDate(j.created_at)}</td>
      <td>${_jbFormatDate(j.scheduled_date)}</td>
      <td>${_jbCustName(j.customer)}</td>
      <td>${j.customer && j.customer.phone ? saaFormatPhone(j.customer.phone) : "—"}</td>
      <td>${[j.job_address, j.job_city].filter(Boolean).join(", ") || "—"}</td>
      <td>${saaJobTypeLabel(j.job_type)}</td>
      <td><span class="jb-badge jb-pri-${j.priority}">${_jbPriorityLabel[j.priority] || j.priority}</span></td>
      <td>${_jbTechDisplayNames(j)}</td>
      <td><span class="jb-badge jb-status-${j.status}">${_jbJobStatusLabel(j)}</span></td>
      <td><span class="jb-badge jb-pay-${j.paymentStatus}">${_jbPaymentLabel[j.paymentStatus]}</span></td>
      <td>${_jbQuoteCellHtml(j)}</td>
    </tr>`;
    const eventRows = expanded ? events.map((e) => _jbEventRowHtml(j, e)).join("") : "";
    return mainRow + eventRows;
  }).join("");

  tbody.querySelectorAll(".jb-row").forEach((tr) => {
    tr.addEventListener("click", () => jbOpenDetail(tr.dataset.id));
  });
  // The expand +/− button toggles the group instead of opening the Job
  // Card -- stop the click from bubbling up to the row's own listener.
  tbody.querySelectorAll(".jb-expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _jbToggleExpandRow(btn.dataset.id);
    });
  });
  // Clicking a nested Event row jumps straight to that Event -- opens its
  // parent Job Card and, once loaded, opens that Event's own modal on top,
  // instead of leaving the office to open the Job and hunt through its
  // Event History list for the one they wanted.
  tbody.querySelectorAll(".jb-event-subrow").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      e.stopPropagation();
      jbOpenEventDirect(tr.dataset.jobId, tr.dataset.eventId);
    });
  });
  // The Quote $ link opens the quotation in a new tab instead of the Job
  // Card the rest of the row opens -- stop the click from also bubbling up
  // to the row's own listener above.
  tbody.querySelectorAll(".jb-quote-link").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.quoteId) window.open(`${btn.dataset.quotePage}?quote=${btn.dataset.quoteId}`, "_blank", "noopener");
    });
  });
  _jbUpdateSortArrows();
  _jbUpdateFilterHeaderHighlight();
}

/** Opens a Job Card straight to one of its Events, from the Jobs List's
 *  expand-row (or a `?job=&event=` deep link -- see the DOMContentLoaded
 *  handler below). Reuses jbOpenDetail/jbOpenEventModal as-is rather than
 *  building a second, parallel "standalone event" view, so every save/
 *  re-render/history-chain behavior the Event modal already has keeps
 *  working unchanged. */
async function jbOpenEventDirect(jobId, eventId) {
  await jbOpenDetail(jobId);
  const ev = _jbEvents.find((e) => e.id === eventId);
  if (ev) jbOpenEventModal(ev);
}

async function jbLoadAll() {
  _jbAllJobs = await saaJobsFetchAll();
  jbRenderTable();
}

// Round 39 (2026-09-19), per Vijayan: "Add download button in Jobs ... to
// download the file in excel format and save in computer." Same CSV-via-
// Blob approach already used on the Tool List (_tlDownloadCsv in
// tools-page.js) and Mileage (_mpDownloadTaxCsv in mileage-page.js) pages
// -- opens straight into Excel, no extra library needed. Exports exactly
// what's on screen right now (respects the active column filters/search/
// sort), not the whole unfiltered table, matching the Tool List's same
// filtered-export behavior.
//
// Round 45 (2026-09-22), per Vijayan: "In Jobs download give options in
// drop down list format 1. Download all, 2. Download jobs, 3. Download
// events. Display event columns similar to Jobs." The single-button
// download is now three: Jobs (the original Round 39 export, unchanged),
// Events (new -- every Event under the currently-filtered Jobs, one row
// per Event, in the same column shape as the Jobs export), and All (both,
// as two sections of one CSV file -- this app has no xlsx/multi-sheet
// library, so a blank-line-separated section is the same pattern used
// nowhere else yet but reads cleanly in Excel/Sheets either way).
function _jbCsvField(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function _jbTriggerCsvDownload(lines, filenameStem) {
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameStem}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const _JB_JOBS_CSV_HEADER = ["Job #", "Date Received", "Scheduled", "Customer", "Phone", "Service Address", "Job Type", "Priority", "Technician", "Status", "Payment", "Quote $"];

function _jbJobCsvRow(j) {
  const amt = _jbQuoteAmount(j);
  return [
    _jbJobNum(j),
    _jbFormatDate(j.created_at),
    _jbFormatDate(j.scheduled_date),
    _jbCustName(j.customer),
    j.customer && j.customer.phone ? saaFormatPhone(j.customer.phone) : "",
    [j.job_address, j.job_city].filter(Boolean).join(", "),
    saaJobTypeLabel(j.job_type),
    _jbPriorityLabel[j.priority] || j.priority || "",
    _jbTechDisplayNames(j),
    _jbJobStatusLabel(j),
    _jbPaymentLabel[j.paymentStatus] || "",
    amt != null ? fmtMoney(amt) : "",
  ];
}

function _jbBuildJobsCsvLines(rows) {
  const lines = [_JB_JOBS_CSV_HEADER.map(_jbCsvField).join(",")];
  rows.forEach((j) => lines.push(_jbJobCsvRow(j).map(_jbCsvField).join(",")));
  return lines;
}

/** Same column order as the Jobs export -- Vijayan: "Display event columns
 *  similar to Jobs" -- but each row is one EVENT (one visit), not one Job.
 *  "Date Received" stays the parent Job's intake date (an Event doesn't
 *  have its own intake), while Scheduled/Technician/Status come from the
 *  Event's own fields (its own visit time, whoever was actually assigned
 *  to THAT visit, and that visit's own Completed/Scheduled/etc. status --
 *  not the parent Job's, since a multi-visit Job's Events can each be at a
 *  different stage). Service Address prefers the Event's own Service
 *  Address (Round 42 gave Events their own) and falls back to the Job's.
 *  Customer/Phone/Job Type/Priority/Payment/Quote $ are Job/Customer-level
 *  facts, so every Event under the same Job repeats the same value.
 *  Leads with Event # (mirroring "Job #" leading the Jobs export) plus the
 *  parent Job # so an Events export row can always be traced back. */
const _JB_EVENTS_CSV_HEADER = ["Event #", "Job #", "Date Received", "Scheduled", "Customer", "Phone", "Service Address", "Job Type", "Priority", "Technician", "Status", "Payment", "Quote $"];

function _jbEventTechNames(e) {
  const names = [e.technician, e.technician2, e.technician3].filter(Boolean).map((t) => t.name);
  return names.length ? names.join(", ") : "None";
}

function _jbEventCsvRow(job, e) {
  const amt = _jbQuoteAmount(job);
  const eventAddress = [e.service_address, e.service_city].filter(Boolean).join(", ");
  return [
    e.event_number || "",
    _jbJobNum(job),
    _jbFormatDate(job.created_at),
    _jbEventTimeLabel(e.scheduled_start),
    _jbCustName(job.customer),
    job.customer && job.customer.phone ? saaFormatPhone(job.customer.phone) : "",
    eventAddress || [job.job_address, job.job_city].filter(Boolean).join(", "),
    saaJobTypeLabel(job.job_type),
    _jbPriorityLabel[job.priority] || job.priority || "",
    _jbEventTechNames(e),
    saaEventStatusLabel(e.event_status),
    _jbPaymentLabel[job.paymentStatus] || "",
    amt != null ? fmtMoney(amt) : "",
  ];
}

function _jbBuildEventsCsvLines(rows) {
  const lines = [_JB_EVENTS_CSV_HEADER.map(_jbCsvField).join(",")];
  rows.forEach((j) => (j.events || []).forEach((e) => lines.push(_jbEventCsvRow(j, e).map(_jbCsvField).join(","))));
  return lines;
}

function jbDownloadJobsCsv() {
  _jbTriggerCsvDownload(_jbBuildJobsCsvLines(jbApplyFilters()), "SAA-jobs");
}

function jbDownloadEventsCsv() {
  _jbTriggerCsvDownload(_jbBuildEventsCsvLines(jbApplyFilters()), "SAA-events");
}

function jbDownloadAllCsv() {
  const rows = jbApplyFilters();
  const lines = ["JOBS", ..._jbBuildJobsCsvLines(rows), "", "EVENTS", ..._jbBuildEventsCsvLines(rows)];
  _jbTriggerCsvDownload(lines, "SAA-jobs-and-events");
}

function _jbToggleDownloadMenu(forceOpen) {
  const menu = document.getElementById("jb-download-menu");
  if (!menu) return;
  menu.hidden = forceOpen === undefined ? !menu.hidden : !forceOpen;
}

/* ============================== New Job popup ============================== */

function jbRenderCustResults(results, query) {
  const box = document.getElementById("jbn-cust-results");
  const items = (results || []).map((c) => `
    <div class="cal-cust-result" data-id="${c.id}">
      <strong>${_jbCustName(c)}</strong>
      ${c.phone ? ` &middot; ${saaFormatPhone(c.phone)}` : ""}
      ${c.billing_address ? `<div class="muted" style="font-size:.78rem">${c.billing_address}</div>` : ""}
    </div>`).join("");
  const addNew = `<div class="cal-cust-result add-new" id="jbn-add-new-cust">+ Add "${query || ""}" as a new customer</div>`;
  box.innerHTML = items + addNew;
  box.hidden = false;

  box.querySelectorAll(".cal-cust-result[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const c = results.find((r) => r.id === el.dataset.id);
      jbSelectCustomer({ id: c.id, customer: c });
    });
  });
  document.getElementById("jbn-add-new-cust").addEventListener("click", () => jbOpenNewCustomerForm(query));
}

function jbOpenNewCustomerForm(query) {
  document.getElementById("jbn-cust-results").hidden = true;
  const form = document.getElementById("jbn-newcust-form");
  form.hidden = false;
  const looksLikePhone = /^[\d\s\-().]{7,}$/.test((query || "").trim());
  document.getElementById("jbn-newcust-first").value = "";
  document.getElementById("jbn-newcust-last").value = "";
  document.getElementById("jbn-newcust-phone").value = looksLikePhone ? query : "";
  if (!looksLikePhone && query) {
    const parts = query.trim().split(/\s+/);
    document.getElementById("jbn-newcust-first").value = parts[0] || "";
    document.getElementById("jbn-newcust-last").value = parts.slice(1).join(" ");
  }
}

function jbSelectCustomer(sel) {
  _jbSelectedCust = sel;
  document.getElementById("jbn-cust-results").hidden = true;
  document.getElementById("jbn-newcust-form").hidden = true;
  document.getElementById("jbn-cust-search").value = "";
  const box = document.getElementById("jbn-selected-cust");
  const c = sel.customer;
  box.hidden = false;
  box.innerHTML = `<strong>${_jbCustName(c)}</strong>${sel.isNew ? ' <span class="muted">(new customer)</span>' : ""}
    ${c.phone ? ` &middot; ${saaFormatPhone(c.phone)}` : ""}
    <button type="button" class="btn btn-ghost btn-sm" id="jbn-change-cust-btn" style="margin-left:10px">Change</button>`;
  document.getElementById("jbn-change-cust-btn").addEventListener("click", () => {
    _jbSelectedCust = null;
    box.hidden = true;
  });
}

function jbUseNewCustomer() {
  const c = {
    first_name: document.getElementById("jbn-newcust-first").value.trim(),
    last_name: document.getElementById("jbn-newcust-last").value.trim(),
    phone: document.getElementById("jbn-newcust-phone").value.trim(),
    billing_address: document.getElementById("jbn-newcust-address").value.trim(),
    billing_city: document.getElementById("jbn-newcust-city").value.trim(),
    billing_zip: document.getElementById("jbn-newcust-zip").value.trim(),
  };
  if (!c.first_name && !c.last_name && !c.phone) {
    document.getElementById("jbn-status").textContent = "Enter a name or phone number.";
    return;
  }
  jbSelectCustomer({ isNew: true, customer: c });
}

function jbOpenNewJobModal() {
  _jbSelectedCust = null;
  _jbNewPriority = "normal";
  _jbConvertingQuote = null;
  document.getElementById("jbn-cust-search").value = "";
  document.getElementById("jbn-cust-results").hidden = true;
  document.getElementById("jbn-newcust-form").hidden = true;
  document.getElementById("jbn-selected-cust").hidden = true;
  document.getElementById("jbn-quote-search-wrap").hidden = true;
  document.getElementById("jbn-quote-search").value = "";
  document.getElementById("jbn-quote-results").hidden = true;
  document.getElementById("jbn-quote-linked").hidden = true;
  ["jbn-newcust-first", "jbn-newcust-last", "jbn-newcust-phone", "jbn-newcust-address", "jbn-newcust-city", "jbn-newcust-zip", "jbn-title", "jbn-address", "jbn-city", "jbn-zip", "jbn-date", "jbn-time", "jbn-notes"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("jbn-state").value = "TX";
  document.getElementById("jbn-type").selectedIndex = 0;
  document.getElementById("jbn-tech").value = "";
  document.getElementById("jbn-tech2").value = "";
  document.getElementById("jbn-tech3").value = "";
  document.getElementById("jbn-status").textContent = "";
  jbRenderPriorityRow("jbn-priority-row", "normal", (p) => { _jbNewPriority = p; });
  document.getElementById("jb-new-modal").hidden = false;
}

/* ---- New Job popup: "Start from a Quote" ---- */

function jbRenderQuoteResults(results, query) {
  const box = document.getElementById("jbn-quote-results");
  if (!results.length) {
    box.innerHTML = `<div class="muted" style="padding:8px;font-size:.82rem">No saved quotes match "${query}".</div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = results.map((qt) => `
    <div class="cal-cust-result" data-id="${qt.id}">
      <strong>${qt.quote_number || "(no #)"}</strong> &middot; ${saaJobTypeLabel(qt.quote_type)} &middot; ${fmtMoney(qt.total || 0)}
      <div class="muted" style="font-size:.78rem">${_jbCustName(qt.customer)}${qt.job_id ? " · already linked to a job" : ""}</div>
    </div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".cal-cust-result[data-id]").forEach((el) => {
    el.addEventListener("click", () => jbUseQuote(results.find((r) => r.id === el.dataset.id)));
  });
}

function jbUseQuote(quote) {
  _jbConvertingQuote = quote;
  document.getElementById("jbn-quote-search-wrap").hidden = true;
  document.getElementById("jbn-quote-results").hidden = true;
  const linked = document.getElementById("jbn-quote-linked");
  linked.hidden = false;
  linked.innerHTML = `Starting from Quote <strong>${quote.quote_number || "—"}</strong> (${fmtMoney(quote.total || 0)})
    <button type="button" class="btn btn-ghost btn-sm" id="jbn-quote-change-btn" style="margin-left:8px">Change</button>`;
  document.getElementById("jbn-quote-change-btn").addEventListener("click", () => {
    _jbConvertingQuote = null;
    linked.hidden = true;
  });

  if (quote.customer) {
    jbSelectCustomer({ id: quote.customer_id, customer: quote.customer });
  }
  const typeSelect = document.getElementById("jbn-type");
  if ([...typeSelect.options].some((o) => o.value === quote.quote_type)) typeSelect.value = quote.quote_type;
  document.getElementById("jbn-title").value = `${saaJobTypeLabel(quote.quote_type)} (from Quote ${quote.quote_number || ""})`.trim();
  document.getElementById("jbn-address").value = quote.job_address || (quote.customer && quote.customer.billing_address) || "";
  document.getElementById("jbn-city").value = (quote.customer && quote.customer.billing_city) || "";
  document.getElementById("jbn-zip").value = (quote.customer && quote.customer.billing_zip) || "";
  document.getElementById("jbn-status").textContent = "";
}

function jbRenderPriorityRow(mountId, selected, onPick) {
  const mount = document.getElementById(mountId);
  mount.innerHTML = SAA_JOBS_PRIORITY_OPTIONS.map(([v, l]) =>
    `<button type="button" class="btn btn-sm ${v === selected ? "btn-navy" : "btn-ghost"}" data-val="${v}">${l}</button>`).join("");
  mount.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      mount.querySelectorAll("button").forEach((b) => b.classList.remove("btn-navy") || b.classList.add("btn-ghost"));
      btn.classList.remove("btn-ghost");
      btn.classList.add("btn-navy");
      onPick(btn.dataset.val);
    });
  });
}

/** Round 42 Task 118: this used to call saaJobsCreateJob directly, which
 *  predates Systems/Events entirely — it never created a System (so the
 *  Job Card's System section came up permanently empty) and never
 *  created an Event (so the Job Card's Event History was empty, AND the
 *  job never showed up on the Dispatch Calendar at all, since the
 *  Calendar reads from `events`, not `jobs`/the old `appointments`
 *  table). Now mirrors the Calendar's own "+ Schedule" New Job tab:
 *  saaSystemsCreateWithJob creates a fresh System (name "System",
 *  fillable later from the Job Card — this form has no System picker of
 *  its own) together with the Job, then saaEventsCreateForJob gives it
 *  its first Event, mapped from the picked Job Type via
 *  SAA_JOBTYPE_TO_EVENTTYPE (events-db.js) — same mapping the Calendar
 *  uses, so a job created either way ends up with an equivalent Event. */
async function jbSaveNewJob() {
  const statusEl = document.getElementById("jbn-status");
  if (!_jbSelectedCust) { statusEl.textContent = "Select or add a customer first."; return; }
  // Round 25 (2026-09-14): the same technician can't fill two of the
  // three slots on one job.
  const pickedTechs = [document.getElementById("jbn-tech").value, document.getElementById("jbn-tech2").value, document.getElementById("jbn-tech3").value].filter(Boolean);
  if (new Set(pickedTechs).size !== pickedTechs.length) {
    statusEl.textContent = "The same technician can't be picked in more than one Technician slot.";
    return;
  }
  const jobType = document.getElementById("jbn-type").value;
  const jobAddress = document.getElementById("jbn-address").value.trim();
  const jobCity = document.getElementById("jbn-city").value.trim();
  const jobState = document.getElementById("jbn-state").value.trim().toUpperCase() || "TX";
  const jobZip = document.getElementById("jbn-zip").value.trim();
  const technicianId = document.getElementById("jbn-tech").value || null;
  const technicianId2 = document.getElementById("jbn-tech2").value || null;
  const technicianId3 = document.getElementById("jbn-tech3").value || null;
  const scheduledDate = document.getElementById("jbn-date").value || null;
  const scheduledTime = document.getElementById("jbn-time").value || null;
  const title = document.getElementById("jbn-title").value.trim();

  let customerId;
  try {
    if (_jbSelectedCust.isNew) {
      const c = _jbSelectedCust.customer;
      customerId = await saaJobsFindOrCreateCustomer({ firstName: c.first_name, lastName: c.last_name, phone: c.phone, address: c.billing_address, city: c.billing_city, zip: c.billing_zip });
    } else {
      customerId = _jbSelectedCust.id;
      const dup = await saaJobsFindDuplicateJobs({ customerId: _jbSelectedCust.id, phone: _jbSelectedCust.customer && _jbSelectedCust.customer.phone, jobType });
      if (dup.ok && dup.jobs.length) {
        const nums = dup.jobs.map((j) => j.job_number || "unnumbered").join(", ");
        const proceed = await saaConfirm(`This customer already has an open ${saaJobTypeLabel(jobType)} job (${nums}). Create another job anyway?`, { title: "Possible duplicate job", okLabel: "Create Anyway" });
        if (!proceed) { statusEl.textContent = "Not created."; return; }
      }
    }
  } catch (e) {
    statusEl.textContent = "Error: " + ((e && e.message) || String(e));
    return;
  }

  let status = "new";
  if (technicianId && scheduledDate) status = "scheduled";
  else if (technicianId) status = "assigned";

  statusEl.textContent = "Saving…";
  const sysRes = await saaSystemsCreateWithJob(
    customerId,
    {},
    {
      jobType, status, title, jobAddress, jobCity, jobState, jobZip,
      priority: _jbNewPriority,
      technicianId, technicianId2, technicianId3,
      scheduledDate, scheduledTime,
      notes: document.getElementById("jbn-notes").value.trim(),
      linkedQuoteId: _jbConvertingQuote ? _jbConvertingQuote.id : null,
      quotedAmount: _jbConvertingQuote ? _jbConvertingQuote.total || 0 : null,
    }
  );
  if (!sysRes.ok) { statusEl.textContent = sysRes.error; return; }

  let startDatetime = null, endDatetime = null;
  if (technicianId && scheduledDate) {
    const time = scheduledTime || "09:00";
    const durations = await saaJobsFetchAppointmentTypes();
    const duration = durations[jobType] || 60;
    startDatetime = _saaJobsTimeStr(scheduledDate, time);
    endDatetime = _saaJobsTimeStr(scheduledDate, _saaJobsAddMinutes(time, duration));
  }
  const evRes = await saaEventsCreateForJob(sysRes.jobId, {
    eventType: SAA_JOBTYPE_TO_EVENTTYPE[jobType] || "service_call",
    eventStatus: "scheduled",
    scheduledStart: startDatetime,
    scheduledEnd: endDatetime,
    technicianId, technicianId2, technicianId3,
    reason: title || null,
  });
  if (!evRes.ok) { statusEl.textContent = "Job created, but its first Event couldn't be scheduled: " + evRes.error; return; }

  document.getElementById("jb-new-modal").hidden = true;
  await jbLoadAll();
  _jbToast("Job created.");
}

/* ============================== Job Detail modal ============================== */

function jbComputeProfit() {
  const material = parseFloat(document.getElementById("jbd-cost-material").value) || 0;
  const labor = parseFloat(document.getElementById("jbd-cost-labor").value) || 0;
  const other = parseFloat(document.getElementById("jbd-cost-other").value) || 0;
  const approved = parseFloat(document.getElementById("jbd-approved").value) || 0;
  const quoted = parseFloat(document.getElementById("jbd-quoted").value) || 0;
  const totalActual = material + labor + other;
  const base = approved || quoted || 0;
  // Round 33 (2026-09-16): Actual Material Cost and Actual Labor Cost both
  // default to 0 until the office fills them in, which made every fresh
  // job read as a "$300 profit, 100% margin" the moment it was Approved --
  // before a single real cost had been entered. That's not a real margin,
  // it's an empty form, so hold off computing Gross Profit/Margin at all
  // until at least one of the two actual-cost fields is nonzero.
  const costsEntered = material > 0 || labor > 0;
  if (!costsEntered) {
    document.getElementById("jbd-profit-box").innerHTML = `
      <div class="jb-profit-row"><span>Total Actual Cost</span><strong>${fmtMoney(totalActual)}</strong></div>
      <div class="jb-profit-row"><span>Gross Profit</span><strong class="jb-pending">Pending actual costs</strong></div>
      <div class="jb-profit-row"><span>Gross Margin %</span><strong class="jb-pending">&mdash;</strong></div>`;
    jbUpdateInvoiceQuoteFlag();
    return;
  }
  const profit = base - totalActual;
  const marginPct = base > 0 ? (profit / base) * 100 : 0;
  document.getElementById("jbd-profit-box").innerHTML = `
    <div class="jb-profit-row"><span>Total Actual Cost</span><strong>${fmtMoney(totalActual)}</strong></div>
    <div class="jb-profit-row"><span>Gross Profit</span><strong class="${profit < 0 ? "jb-negative" : ""}">${fmtMoney(profit)}</strong></div>
    <div class="jb-profit-row"><span>Gross Margin %</span><strong class="${marginPct < 0 ? "jb-negative" : ""}">${marginPct.toFixed(1)}%</strong></div>`;
  jbUpdateInvoiceQuoteFlag();
}

/** Flags when the current Invoice's Amount Total has drifted from the
 *  job's own Quoted Amount -- e.g. the linked quote was changed after the
 *  invoice was already generated, or the invoice amount was hand-edited.
 *  Purely informational (doesn't block Save/Update anything); re-run on
 *  every Quoted-Amount edit (via jbComputeProfit's oninput wiring) and
 *  every invoice render/update so it never goes stale. */
function jbUpdateInvoiceQuoteFlag() {
  const flag = document.getElementById("jbd-invoice-quote-flag");
  const quotedEl = document.getElementById("jbd-quoted");
  const approvedEl = document.getElementById("jbd-approved");
  if (!flag || !quotedEl) return;
  // Same basis as quoteBasis in jbRenderInvoiceBox and the default amount
  // in saaJobsGetOrCreateInvoice -- Approved Amount wins when set, so a job
  // approved at a different number than it was quoted doesn't get flagged
  // as "mismatched" just for matching the number it was actually approved
  // at (round 7 follow-up, 2026-09-13).
  const approved = approvedEl ? parseFloat(approvedEl.value) || 0 : 0;
  const quoted = approved || parseFloat(quotedEl.value) || 0;
  if (!_jbCurrentInvoice || !quoted) {
    flag.hidden = true;
    return;
  }
  const invoiceAmt = Number(_jbCurrentInvoice.amount_total || 0);
  const diff = invoiceAmt - quoted;
  if (Math.abs(diff) < 0.01) {
    flag.hidden = true;
    return;
  }
  flag.hidden = false;
  flag.className = "jb-badge jb-flag-mismatch";
  const basisLabel = approved ? "Approved" : "Quote";
  flag.textContent = `⚠️ Invoice ${diff > 0 ? "+" : "−"}${fmtMoney(Math.abs(diff))} vs ${basisLabel}`;
}

/* ============================== Round 42 Task 124: Event modal — Financials ==============================
 * Direct mirror of jbComputeProfit/jbUpdateInvoiceQuoteFlag above, scoped
 * to the Event modal's own jbe-* fields and _jbeCurrentInvoice instead of
 * the Job Card's jbd-* fields / _jbCurrentInvoice -- see the per-Event state comment
 * near the top of this file. Works in both create and edit mode (these are
 * plain fields, not a separate DB row -- see jbSaveEventModal). */
function jbeComputeProfit() {
  const material = parseFloat(document.getElementById("jbe-cost-material").value) || 0;
  const labor = parseFloat(document.getElementById("jbe-cost-labor").value) || 0;
  const other = parseFloat(document.getElementById("jbe-cost-other").value) || 0;
  const approved = parseFloat(document.getElementById("jbe-approved").value) || 0;
  const quoted = parseFloat(document.getElementById("jbe-quoted").value) || 0;
  const totalActual = material + labor + other;
  const base = approved || quoted || 0;
  const costsEntered = material > 0 || labor > 0;
  if (!costsEntered) {
    document.getElementById("jbe-profit-box").innerHTML = `
      <div class="jb-profit-row"><span>Total Actual Cost</span><strong>${fmtMoney(totalActual)}</strong></div>
      <div class="jb-profit-row"><span>Gross Profit</span><strong class="jb-pending">Pending actual costs</strong></div>
      <div class="jb-profit-row"><span>Gross Margin %</span><strong class="jb-pending">&mdash;</strong></div>`;
    jbeUpdateInvoiceQuoteFlag();
    return;
  }
  const profit = base - totalActual;
  const marginPct = base > 0 ? (profit / base) * 100 : 0;
  document.getElementById("jbe-profit-box").innerHTML = `
    <div class="jb-profit-row"><span>Total Actual Cost</span><strong>${fmtMoney(totalActual)}</strong></div>
    <div class="jb-profit-row"><span>Gross Profit</span><strong class="${profit < 0 ? "jb-negative" : ""}">${fmtMoney(profit)}</strong></div>
    <div class="jb-profit-row"><span>Gross Margin %</span><strong class="${marginPct < 0 ? "jb-negative" : ""}">${marginPct.toFixed(1)}%</strong></div>`;
  jbeUpdateInvoiceQuoteFlag();
}

function jbeUpdateInvoiceQuoteFlag() {
  const flag = document.getElementById("jbe-invoice-quote-flag");
  const quotedEl = document.getElementById("jbe-quoted");
  const approvedEl = document.getElementById("jbe-approved");
  if (!flag || !quotedEl) return;
  const approved = approvedEl ? parseFloat(approvedEl.value) || 0 : 0;
  const quoted = approved || parseFloat(quotedEl.value) || 0;
  if (!_jbeCurrentInvoice || !quoted) {
    flag.hidden = true;
    return;
  }
  const invoiceAmt = Number(_jbeCurrentInvoice.amount_total || 0);
  const diff = invoiceAmt - quoted;
  if (Math.abs(diff) < 0.01) {
    flag.hidden = true;
    return;
  }
  flag.hidden = false;
  flag.className = "jb-badge jb-flag-mismatch";
  const basisLabel = approved ? "Approved" : "Quote";
  flag.textContent = `⚠️ Invoice ${diff > 0 ? "+" : "−"}${fmtMoney(Math.abs(diff))} vs ${basisLabel}`;
}

/* ============================== Round 42 Task 124: Event modal — Quote linking ==============================
 * Per-Event quote linking (Vijayan: "Per-Event quote linking") -- direct
 * mirror of jbRenderQuoteSection/jbSearchCustomerQuotes below, scoped to
 * the open Event (saaEventsLinkQuote/saaEventsUnlinkQuote in events-db.js)
 * instead of the Job. Unlike Mileage/Photos/Invoice/BOM further down, this
 * works even in CREATE mode -- a quote picked before the Event has been
 * saved yet is held in _jbePendingQuote and linked the moment
 * jbSaveEventModal creates the row. */
async function jbeRenderQuoteSection(event) {
  const linkedBox = document.getElementById("jbe-quote-linked");
  const searchWrap = document.getElementById("jbe-quote-search-wrap");
  const linkedQuote = (event && event.linkedQuote) || _jbePendingQuote;
  const linkedId = (event && event.linked_quote_id) || (_jbePendingQuote ? _jbePendingQuote.id : null);
  if (linkedId && linkedQuote) {
    linkedBox.hidden = false;
    searchWrap.hidden = true;
    linkedBox.innerHTML = `Linked to Quote <strong>${linkedQuote.quote_number || "—"}</strong> (${linkedQuote.quote_type || ""}) &mdash; ${fmtMoney(linkedQuote.total || 0)}
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-unlink-quote-btn" style="margin-left:8px">Change</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-remove-quote-btn" style="margin-left:4px">Remove Quotation</button>`;
    document.getElementById("jbe-unlink-quote-btn").addEventListener("click", () => {
      linkedBox.hidden = true;
      searchWrap.hidden = false;
    });
    document.getElementById("jbe-remove-quote-btn").addEventListener("click", async () => {
      const proceed = await saaConfirm(
        `Remove the link to Quote ${linkedQuote.quote_number || "this quote"}? The quote itself won't be deleted, and Quoted Amount stays as-is -- only the connection between this event and that quote is cleared.`,
        { title: "Remove Quotation", okLabel: "Remove Link" }
      );
      if (!proceed) return;
      if (event && event.id) {
        const res = await saaEventsUnlinkQuote(event.id, event.linked_quote_id);
        if (!res.ok) { _jbToast(res.error, true); return; }
        event.linked_quote_id = null;
        event.linkedQuote = null;
      }
      _jbePendingQuote = null;
      jbeRenderQuoteSection(event);
      _jbToast("Quotation link removed.");
    });
  } else {
    linkedBox.hidden = true;
    searchWrap.hidden = false;
  }
}

async function jbeSearchCustomerQuotes(query) {
  const job = _jbCurrentJob;
  if (!job) return;
  const quotes = await saaJobsFetchCustomerQuotes(job.customer_id, job.customer && job.customer.phone);
  const q = (query || "").toLowerCase();
  const matches = q ? quotes.filter((qt) => (qt.quote_number || "").toLowerCase().includes(q) || (qt.quote_type || "").toLowerCase().includes(q)) : quotes;
  const filtered = matches.slice(0, 5);
  const box = document.getElementById("jbe-quote-results");
  if (!filtered.length) {
    box.innerHTML = `<div class="muted" style="padding:8px;font-size:.82rem">No saved quotes found for this customer.</div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = filtered.map((qt) => `
    <div class="cal-cust-result" data-id="${qt.id}">
      <strong>${qt.quote_number || "(no #)"}</strong> &middot; ${qt.quote_type || ""} &middot; ${fmtMoney(qt.total || 0)}
    </div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".cal-cust-result").forEach((el) => {
    el.addEventListener("click", async () => {
      const quote = filtered.find((f) => f.id === el.dataset.id);
      const event = _jbEventModalTarget;
      let res;
      if (event && event.id) {
        res = await saaEventsLinkQuote(event.id, el.dataset.id);
      } else {
        // Not saved yet -- defer the actual DB link until Save Event
        // creates the row (see jbSaveEventModal's create branch), same
        // idea as Notes/Signature/Financials only being written on Save
        // for a brand-new Event.
        res = { ok: true, quotedAmount: quote.total || 0, materialCost: quote.material_cost, laborCost: quote.labor_cost, otherCost: quote.other_cost };
        _jbePendingQuote = quote;
      }
      if (!res.ok) { _jbToast(res.error, true); return; }
      if (event) { event.linked_quote_id = el.dataset.id; event.linkedQuote = quote; }
      document.getElementById("jbe-quoted").value = res.quotedAmount || 0;
      const approvedEl = document.getElementById("jbe-approved");
      if (!parseFloat(approvedEl.value)) approvedEl.value = res.quotedAmount || 0;
      if (res.materialCost != null || res.laborCost != null || res.otherCost != null) {
        document.getElementById("jbe-cost-material").value = res.materialCost || 0;
        document.getElementById("jbe-cost-labor").value = res.laborCost || 0;
        document.getElementById("jbe-cost-other").value = res.otherCost || 0;
      }
      jbeComputeProfit();
      // Auto-populate Service Address the same as the Job Card's own
      // quote-pick flow (jbSearchCustomerQuotes below), only when still blank.
      const addrEl = document.getElementById("jbe-address");
      if (!addrEl.value.trim()) addrEl.value = quote.job_address || (job.customer && job.customer.billing_address) || "";
      const cityEl = document.getElementById("jbe-city");
      if (!cityEl.value.trim() && job.customer && job.customer.billing_city) cityEl.value = job.customer.billing_city;
      const zipEl = document.getElementById("jbe-zip");
      if (!zipEl.value.trim() && job.customer && job.customer.billing_zip) zipEl.value = job.customer.billing_zip;
      jbeRenderQuoteSection(event);
      box.hidden = true;
    });
  });
}

async function jbRenderQuoteSection(job) {
  const linkedBox = document.getElementById("jbd-quote-linked");
  const searchWrap = document.getElementById("jbd-quote-search-wrap");
  if (job.linked_quote_id && job.linkedQuote) {
    linkedBox.hidden = false;
    searchWrap.hidden = true;
    linkedBox.innerHTML = `Linked to Quote <strong>${job.linkedQuote.quote_number || "—"}</strong> (${job.linkedQuote.quote_type || ""}) &mdash; ${fmtMoney(job.linkedQuote.total || 0)}
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-unlink-quote-btn" style="margin-left:8px">Change</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-remove-quote-btn" style="margin-left:4px">Remove Quotation</button>`;
    document.getElementById("jbd-unlink-quote-btn").addEventListener("click", () => {
      linkedBox.hidden = true;
      searchWrap.hidden = false;
    });
    // Round 33 (2026-09-16): "Change" above only swaps in the search box to
    // pick a REPLACEMENT quote -- there was no way to detach a job from a
    // quote entirely. This clears the link outright (the quote itself, and
    // the job's own Quoted Amount, are both left untouched).
    document.getElementById("jbd-remove-quote-btn").addEventListener("click", async () => {
      const proceed = await saaConfirm(
        `Remove the link to Quote ${job.linkedQuote.quote_number || "this quote"}? The quote itself won't be deleted, and Quoted Amount stays as-is -- only the connection between this job and that quote is cleared.`,
        { title: "Remove Quotation", okLabel: "Remove Link" }
      );
      if (!proceed) return;
      const res = await saaJobsUnlinkQuote(job.id, job.linked_quote_id);
      if (!res.ok) { _jbToast(res.error, true); return; }
      job.linked_quote_id = null;
      job.linkedQuote = null;
      jbRenderQuoteSection(job);
      _jbToast("Quotation link removed.");
    });
  } else {
    linkedBox.hidden = true;
    searchWrap.hidden = false;
  }
}

async function jbSearchCustomerQuotes(job, query) {
  // saaJobsFetchCustomerQuotes already orders newest-first (updated_at
  // desc) -- capping to 5 here (a follow-up to Round 6 item 8) is what
  // gives a focus-with-nothing-typed click a short, useful "latest to
  // oldest" list instead of every quote this customer has ever saved.
  const quotes = await saaJobsFetchCustomerQuotes(job.customer_id, job.customer && job.customer.phone);
  const q = (query || "").toLowerCase();
  const matches = q ? quotes.filter((qt) => (qt.quote_number || "").toLowerCase().includes(q) || (qt.quote_type || "").toLowerCase().includes(q)) : quotes;
  const filtered = matches.slice(0, 5);
  const box = document.getElementById("jbd-quote-results");
  if (!filtered.length) {
    box.innerHTML = `<div class="muted" style="padding:8px;font-size:.82rem">No saved quotes found for this customer.</div>`;
    box.hidden = false;
    return;
  }
  box.innerHTML = filtered.map((qt) => `
    <div class="cal-cust-result" data-id="${qt.id}">
      <strong>${qt.quote_number || "(no #)"}</strong> &middot; ${qt.quote_type || ""} &middot; ${fmtMoney(qt.total || 0)}
    </div>`).join("");
  box.hidden = false;
  box.querySelectorAll(".cal-cust-result").forEach((el) => {
    el.addEventListener("click", async () => {
      const quote = filtered.find((f) => f.id === el.dataset.id);
      const res = await saaJobsLinkQuote(job.id, el.dataset.id);
      if (res.ok) {
        job.linked_quote_id = el.dataset.id;
        job.linkedQuote = quote;
        document.getElementById("jbd-quoted").value = res.quotedAmount || 0;
        // Keep the in-memory job object in sync immediately, not just the
        // DOM field -- saaJobsLinkQuote already wrote quoted_amount to the
        // database, but jbQuickInvoice()/"Generate Invoice" read straight
        // off this in-memory `job`, so without this line clicking Invoice
        // right after picking a quote (before ever clicking Save Job Card)
        // would build the invoice off the OLD amount. Same class of bug as
        // the "stale job after Save" fix from the original Jobs Master List
        // round -- see site-build-notes.md.
        job.quoted_amount = res.quotedAmount || 0;
        // Approved Amount has no equivalent field on a quote, so this is a
        // reasonable default (most jobs approve at the quoted price), not a
        // real quote field -- only fills it when still blank so a real,
        // already-entered Approved Amount is never overwritten.
        const approvedEl = document.getElementById("jbd-approved");
        if (!parseFloat(approvedEl.value)) {
          approvedEl.value = res.quotedAmount || 0;
          job.approved_amount = res.quotedAmount || 0;
        }
        // Default Actual Material/Labor/Other Cost from the quote's own cost
        // breakdown, same as Quoted Amount above -- picking a (new) quote
        // resets these to that quote's numbers every time, on the
        // assumption the office will adjust them to the real costs once
        // work is done. Quotes saved before this breakdown existed have
        // null here, not $0 -- leave the existing Actual Cost fields alone
        // in that case rather than wiping them to zero (round 6 follow-up,
        // 2026-09-13).
        if (res.materialCost != null || res.laborCost != null || res.otherCost != null) {
          const materialEl = document.getElementById("jbd-cost-material");
          const laborEl = document.getElementById("jbd-cost-labor");
          const otherEl = document.getElementById("jbd-cost-other");
          materialEl.value = res.materialCost || 0;
          laborEl.value = res.laborCost || 0;
          otherEl.value = res.otherCost || 0;
          job.actual_material_cost = res.materialCost || 0;
          job.actual_labor_cost = res.laborCost || 0;
          job.other_cost = res.otherCost || 0;
        }
        jbComputeProfit();
        // Auto-populate the job sheet from the quote, same fields the New
        // Job popup's "Start from a Quote" flow fills. Address/city/zip are
        // genuinely blank-by-default text fields, so only fill those when
        // empty. Job Type always already holds a real value (there's no
        // "unset" option), so a blank check would never fire there — instead
        // ask before changing it, and only when the quote's type actually
        // differs from what's already selected.
        const typeSelect = document.getElementById("jbd-type");
        if (quote.quote_type && quote.quote_type !== typeSelect.value && [...typeSelect.options].some((o) => o.value === quote.quote_type)) {
          const newLabel = saaJobTypeLabel(quote.quote_type);
          const useNewType = await saaConfirm(
            `This quote is a "${newLabel}" quote. Update the Job Type to match?`,
            { title: "Update job type from quote", okLabel: "Update", cancelLabel: "Keep Current" }
          );
          if (useNewType) typeSelect.value = quote.quote_type;
        }
        const addrEl = document.getElementById("jbd-address");
        if (!addrEl.value.trim()) {
          addrEl.value = quote.job_address || (job.customer && job.customer.billing_address) || "";
        }
        const cityEl = document.getElementById("jbd-city");
        if (!cityEl.value.trim() && job.customer && job.customer.billing_city) cityEl.value = job.customer.billing_city;
        const zipEl = document.getElementById("jbd-zip");
        if (!zipEl.value.trim() && job.customer && job.customer.billing_zip) zipEl.value = job.customer.billing_zip;
        jbRenderQuoteSection(job);
        box.hidden = true;
      }
    });
  });
}

/** Job Card quick-access "💵 Invoice" button (Round 6 item 4): create the
 *  invoice if this job doesn't have one yet, then jump straight to the
 *  Invoice & Payment section either way — same "Generate Invoice"/"Update
 *  Invoice" flow underneath, just reachable without scrolling. */
async function jbQuickInvoice() {
  const job = _jbCurrentJob;
  if (!job) return;
  if (!_jbCurrentInvoice) {
    const res = await saaJobsGetOrCreateInvoice(job);
    if (res.ok) {
      _jbCurrentInvoice = res.invoice;
      _jbCurrentPayments = [];
      jbRenderInvoiceBox(job, res.invoice, []);
      _jbToast("Invoice generated.");
    } else {
      _jbToast(res.error, true);
      return;
    }
  }
  const box = document.getElementById("jbd-invoice-box");
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  box.closest(".drawer-section").classList.add("jb-highlight-section");
  setTimeout(() => box.closest(".drawer-section").classList.remove("jb-highlight-section"), 1200);
}

function jbRenderInvoiceBox(job, invoice, payments) {
  const box = document.getElementById("jbd-invoice-box");
  if (!invoice) {
    box.innerHTML = `<button type="button" class="btn btn-navy btn-sm" id="jbd-gen-invoice-btn">Generate Invoice</button>
      <span class="jb-badge jb-invstatus-none" style="margin-left:8px">Not Invoiced</span>`;
    document.getElementById("jbd-gen-invoice-btn").addEventListener("click", async () => {
      // Generates off whatever's currently in the Financials section --
      // Approved Amount, falling back to Quoted Amount (see
      // saaJobsGetOrCreateInvoice) -- both of which, as of this follow-up,
      // are kept in sync on `job` the instant a quote is picked, not only
      // after Save Job Card, so this reflects a just-selected quote too.
      const res = await saaJobsGetOrCreateInvoice(job);
      if (res.ok) {
        _jbCurrentInvoice = res.invoice;
        _jbCurrentPayments = [];
        jbRenderInvoiceBox(job, res.invoice, []);
        _jbToast("Invoice generated.");
      } else {
        _jbToast(res.error, true);
      }
    });
    jbUpdateInvoiceQuoteFlag();
    return;
  }
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  // Round 31: pass whether a payment ROW exists at all (payments.length),
  // not just the $ sum -- a $0 payment sums to 0 same as no payment at
  // all, but only the former means "reviewed, confirmed nothing owed."
  const paymentStatus = saaJobsPaymentStatus(invoice, paid, payments.length > 0);
  const paymentsHtml = payments.length
    ? payments.map((p) => `<div class="jb-payment-row">${_jbFormatDate(p.payment_date)} &middot; ${(p.method || "").replace(/^\w/, (c) => c.toUpperCase())} &middot; ${fmtMoney(Number(p.amount || 0))}</div>`).join("")
    : `<div class="muted" style="font-size:.8rem">No payments recorded yet.</div>`;

  // An existing invoice's Amount Total is otherwise frozen at whatever it
  // was when generated (saaJobsGetOrCreateInvoice only defaults a NEW
  // invoice's amount -- an already-existing one is returned untouched) --
  // so it can sit at a stale number forever with nothing but the mismatch
  // flag above to notice. Offer one-click ways to pull in either basis
  // instead of retyping it: the Quoted/Approved Amount from the Quote
  // section, or the Actual Amount (Actual Material + Labor + Other Cost)
  // from the Financials section above. Both buttons stay visible on every
  // invoice regardless of status (Draft/Sent/Paid) or whether the amount
  // already matches -- previously "Use Quoted Amount" disappeared once a
  // Draft invoice matched or once the invoice was no longer Draft, which
  // made it unavailable exactly when the office wanted to re-check or
  // re-apply it; only a $0 basis (nothing to pull in yet) disables a
  // button, it never hides it (round 7 follow-up, 2026-09-13).
  const quoteBasis = Number(job.approved_amount || job.quoted_amount || 0);
  const actualBasis = Number(job.actual_material_cost || 0) + Number(job.actual_labor_cost || 0) + Number(job.other_cost || 0);
  const syncBtnHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-inv-sync-quote-btn"${quoteBasis > 0 ? "" : " disabled"}>Use Quoted Amount (${fmtMoney(quoteBasis)})</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-inv-sync-actual-btn"${actualBasis > 0 ? "" : " disabled"}>Use Actual Amount (${fmtMoney(actualBasis)})</button>
    </div>`;

  // Discount and Other Costs (extra charges beyond the quote -- e.g. a
  // part found on-site that wasn't in the original estimate) are both
  // optional, so the fields stay in the Job Card for editing either way,
  // but the printed customer-facing invoice only shows a line for either
  // one when it's actually nonzero (round 6 follow-up, 2026-09-13).
  const discount = Number(invoice.discount || 0);
  const otherCharges = Number(invoice.additional_charges || 0);

  box.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Invoice #</label><input type="text" value="${invoice.invoice_number || ""}" disabled></div>
      <div class="field"><label>Invoice Status</label><select id="jbd-inv-status">${_jbOptionsHtml(SAA_INVOICE_STATUS_OPTIONS, invoice.status)}</select></div>
    </div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="jbd-inv-amount" value="${invoice.amount_total || 0}"></div>
    ${syncBtnHtml}
    <div class="field-row" style="margin-top:8px">
      <div class="field"><label>Discount</label><input type="number" step="0.01" id="jbd-inv-discount" value="${discount || ""}" placeholder="0.00"></div>
      <div class="field"><label>Other Costs</label><input type="number" step="0.01" id="jbd-inv-other" value="${otherCharges || ""}" placeholder="0.00"></div>
    </div>
    <div class="jb-profit-row" id="jbd-inv-total-row" style="margin-top:4px"><span>Total</span><strong id="jbd-inv-total-display">${fmtMoney(saaJobsInvoiceTotalDue(invoice))}</strong></div>
    <div style="display:flex;gap:8px;margin:10px 0 10px">
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-inv-save-btn">Update Invoice</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbd-inv-print-btn">Print Invoice</button>
      <span class="jb-badge jb-pay-${paymentStatus}">${_jbPaymentLabel[paymentStatus]}</span>
    </div>
    <div class="jb-payments-list">${paymentsHtml}</div>
    <div class="field-row" style="margin-top:8px">
      <div class="field"><label>Payment Amount</label><input type="number" step="0.01" min="0" id="jbd-pay-amount" placeholder="0.00"></div>
      <div class="field"><label>Date</label><input type="date" id="jbd-pay-date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Method</label><select id="jbd-pay-method">
        <option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option>
        <option value="ach">ACH</option><option value="financing">Financing</option><option value="other">Other</option>
      </select></div>
      <div class="field"><label>Reference #</label><input type="text" id="jbd-pay-ref"></div>
    </div>
    <button type="button" class="btn btn-navy btn-sm" id="jbd-pay-save-btn">Record Payment</button>
    <p class="muted" style="font-size:.78rem;margin:4px 0 0">Enter 0 for a no-charge visit (e.g. a free follow-up check) &mdash; this confirms nothing is owed and marks it Paid.</p>
  `;

  // Live Total = Amount - Discount + Other Costs, recomputed on every
  // keystroke in any of the three fields, well before Update Invoice is
  // clicked -- purely a display refresh (see saaJobsInvoiceTotalDue in
  // jobs-db.js for the same math used for payment status/the printed
  // invoice, kept in one place so they can't drift apart).
  function recalcInvoiceTotal() {
    const amt = parseFloat(document.getElementById("jbd-inv-amount").value) || 0;
    const disc = parseFloat(document.getElementById("jbd-inv-discount").value) || 0;
    const other = parseFloat(document.getElementById("jbd-inv-other").value) || 0;
    document.getElementById("jbd-inv-total-display").textContent = fmtMoney(amt - disc + other);
  }
  ["jbd-inv-amount", "jbd-inv-discount", "jbd-inv-other"].forEach((id) => {
    document.getElementById(id).addEventListener("input", recalcInvoiceTotal);
  });

  document.getElementById("jbd-inv-save-btn").addEventListener("click", async () => {
    const newAmount = parseFloat(document.getElementById("jbd-inv-amount").value) || 0;
    const newDiscount = parseFloat(document.getElementById("jbd-inv-discount").value) || 0;
    const newOther = parseFloat(document.getElementById("jbd-inv-other").value) || 0;
    const res = await saaJobsUpdateInvoice(invoice.id, {
      status: document.getElementById("jbd-inv-status").value,
      amount_total: newAmount,
      discount: newDiscount,
      additional_charges: newOther,
    });
    if (res.ok) {
      _jbToast("Invoice updated.");
      invoice.status = document.getElementById("jbd-inv-status").value;
      invoice.amount_total = newAmount;
      invoice.discount = newDiscount;
      invoice.additional_charges = newOther;
      jbRenderInvoiceBox(job, invoice, payments);
    } else _jbToast(res.error, true);
  });
  // Only updates the field on screen -- the office still clicks Update
  // Invoice to actually persist it, same "review before you commit"
  // pattern as everything else here (nothing writes to the database on
  // its own just because a number changed elsewhere). Disabled buttons
  // (basis is $0) have nothing to wire up.
  if (quoteBasis > 0) {
    document.getElementById("jbd-inv-sync-quote-btn").addEventListener("click", () => {
      document.getElementById("jbd-inv-amount").value = quoteBasis;
      jbUpdateInvoiceQuoteFlag();
      recalcInvoiceTotal();
    });
  }
  if (actualBasis > 0) {
    document.getElementById("jbd-inv-sync-actual-btn").addEventListener("click", () => {
      document.getElementById("jbd-inv-amount").value = actualBasis;
      jbUpdateInvoiceQuoteFlag();
      recalcInvoiceTotal();
    });
  }
  document.getElementById("jbd-inv-print-btn").addEventListener("click", () => {
    printFormalInvoice({
      invoiceNumber: invoice.invoice_number,
      issueDate: _jbFormatDate(invoice.issue_date),
      dueDate: _jbFormatDate(invoice.due_date),
      status: invoice.status,
      customer: _jbCustName(job.customer),
      phone: job.customer && job.customer.phone,
      address: [job.job_address, job.job_city].filter(Boolean).join(", "),
      jobTitle: job.title || saaJobTypeLabel(job.job_type),
      description: job.recommended_action || "",
      amountTotal: invoice.amount_total,
      discount: invoice.discount,
      additionalCharges: invoice.additional_charges,
      amountPaid: paid,
      payments,
    });
  });
  document.getElementById("jbd-pay-save-btn").addEventListener("click", async () => {
    const amount = parseFloat(document.getElementById("jbd-pay-amount").value) || 0;
    const res = await saaJobsRecordPayment({
      invoiceId: invoice.id,
      customerId: job.customer_id,
      amount,
      paymentDate: document.getElementById("jbd-pay-date").value,
      method: document.getElementById("jbd-pay-method").value,
      referenceNumber: document.getElementById("jbd-pay-ref").value.trim(),
    });
    if (res.ok) {
      const freshPayments = await saaJobsFetchPayments(invoice.id);
      _jbCurrentPayments = freshPayments;
      const freshInvoice = await _saaClient.from("invoices").select("*").eq("id", invoice.id).single();
      _jbCurrentInvoice = freshInvoice.data || invoice;
      jbRenderInvoiceBox(job, _jbCurrentInvoice, freshPayments);
      _jbToast("Payment recorded.");
      jbLoadAll();
    } else {
      _jbToast(res.error, true);
    }
  });
  jbUpdateInvoiceQuoteFlag();
}

/* ============================== Round 42 Task 124: Event modal — Invoice & Payment ==============================
 * Direct mirror of jbRenderInvoiceBox above, scoped to the open Event's OWN
 * Invoice/Payment history (invoices.event_id / saaEventsGetOrCreateInvoice
 * in events-db.js) instead of the Job's -- per Vijayan: "Events will have
 * its own ... invoices, print invoice, record payment ... it will have its
 * own working control." Needs a real event_id (an already-SAVED Event) --
 * shows a "Save this Event first" placeholder otherwise, same as
 * Mileage/Photos/BOM further down. */
function jbeRenderInvoiceBox(event, invoice, payments) {
  const box = document.getElementById("jbe-invoice-box");
  if (!event || !event.id) {
    box.innerHTML = `<span class="muted" style="font-size:.85rem">Save this Event first, then generate its Invoice.</span>`;
    return;
  }
  if (!invoice) {
    box.innerHTML = `<button type="button" class="btn btn-navy btn-sm" id="jbe-gen-invoice-btn">Generate Invoice</button>
      <span class="jb-badge jb-invstatus-none" style="margin-left:8px">Not Invoiced</span>`;
    document.getElementById("jbe-gen-invoice-btn").addEventListener("click", async () => {
      const res = await saaEventsGetOrCreateInvoice(event);
      if (res.ok) {
        _jbeCurrentInvoice = res.invoice;
        _jbeCurrentPayments = [];
        jbeRenderInvoiceBox(event, res.invoice, []);
        _jbToast("Invoice generated.");
      } else {
        _jbToast(res.error, true);
      }
    });
    jbeUpdateInvoiceQuoteFlag();
    return;
  }
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentStatus = saaJobsPaymentStatus(invoice, paid, payments.length > 0);
  const paymentsHtml = payments.length
    ? payments.map((p) => `<div class="jb-payment-row">${_jbFormatDate(p.payment_date)} &middot; ${(p.method || "").replace(/^\w/, (c) => c.toUpperCase())} &middot; ${fmtMoney(Number(p.amount || 0))}</div>`).join("")
    : `<div class="muted" style="font-size:.8rem">No payments recorded yet.</div>`;

  const quoteBasis = Number(event.approved_amount || event.quoted_amount || 0);
  const actualBasis = Number(event.actual_material_cost || 0) + Number(event.actual_labor_cost || 0) + Number(event.other_cost || 0);
  const syncBtnHtml = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-inv-sync-quote-btn"${quoteBasis > 0 ? "" : " disabled"}>Use Quoted Amount (${fmtMoney(quoteBasis)})</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-inv-sync-actual-btn"${actualBasis > 0 ? "" : " disabled"}>Use Actual Amount (${fmtMoney(actualBasis)})</button>
    </div>`;

  const discount = Number(invoice.discount || 0);
  const otherCharges = Number(invoice.additional_charges || 0);

  box.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Invoice #</label><input type="text" value="${invoice.invoice_number || ""}" disabled></div>
      <div class="field"><label>Invoice Status</label><select id="jbe-inv-status">${_jbOptionsHtml(SAA_INVOICE_STATUS_OPTIONS, invoice.status)}</select></div>
    </div>
    <div class="field"><label>Amount</label><input type="number" step="0.01" id="jbe-inv-amount" value="${invoice.amount_total || 0}"></div>
    ${syncBtnHtml}
    <div class="field-row" style="margin-top:8px">
      <div class="field"><label>Discount</label><input type="number" step="0.01" id="jbe-inv-discount" value="${discount || ""}" placeholder="0.00"></div>
      <div class="field"><label>Other Costs</label><input type="number" step="0.01" id="jbe-inv-other" value="${otherCharges || ""}" placeholder="0.00"></div>
    </div>
    <div class="jb-profit-row" id="jbe-inv-total-row" style="margin-top:4px"><span>Total</span><strong id="jbe-inv-total-display">${fmtMoney(saaJobsInvoiceTotalDue(invoice))}</strong></div>
    <div style="display:flex;gap:8px;margin:10px 0 10px">
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-inv-save-btn">Update Invoice</button>
      <button type="button" class="btn btn-ghost btn-sm" id="jbe-inv-print-btn">Print Invoice</button>
      <span class="jb-badge jb-pay-${paymentStatus}">${_jbPaymentLabel[paymentStatus]}</span>
    </div>
    <div class="jb-payments-list">${paymentsHtml}</div>
    <div class="field-row" style="margin-top:8px">
      <div class="field"><label>Payment Amount</label><input type="number" step="0.01" min="0" id="jbe-pay-amount" placeholder="0.00"></div>
      <div class="field"><label>Date</label><input type="date" id="jbe-pay-date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Method</label><select id="jbe-pay-method">
        <option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option>
        <option value="ach">ACH</option><option value="financing">Financing</option><option value="other">Other</option>
      </select></div>
      <div class="field"><label>Reference #</label><input type="text" id="jbe-pay-ref"></div>
    </div>
    <button type="button" class="btn btn-navy btn-sm" id="jbe-pay-save-btn">Record Payment</button>
    <p class="muted" style="font-size:.78rem;margin:4px 0 0">Enter 0 for a no-charge visit (e.g. a free follow-up check) &mdash; this confirms nothing is owed and marks it Paid.</p>
  `;

  function recalcInvoiceTotal() {
    const amt = parseFloat(document.getElementById("jbe-inv-amount").value) || 0;
    const disc = parseFloat(document.getElementById("jbe-inv-discount").value) || 0;
    const other = parseFloat(document.getElementById("jbe-inv-other").value) || 0;
    document.getElementById("jbe-inv-total-display").textContent = fmtMoney(amt - disc + other);
  }
  ["jbe-inv-amount", "jbe-inv-discount", "jbe-inv-other"].forEach((id) => {
    document.getElementById(id).addEventListener("input", recalcInvoiceTotal);
  });

  document.getElementById("jbe-inv-save-btn").addEventListener("click", async () => {
    const newAmount = parseFloat(document.getElementById("jbe-inv-amount").value) || 0;
    const newDiscount = parseFloat(document.getElementById("jbe-inv-discount").value) || 0;
    const newOther = parseFloat(document.getElementById("jbe-inv-other").value) || 0;
    const res = await saaJobsUpdateInvoice(invoice.id, {
      status: document.getElementById("jbe-inv-status").value,
      amount_total: newAmount,
      discount: newDiscount,
      additional_charges: newOther,
    });
    if (res.ok) {
      _jbToast("Invoice updated.");
      invoice.status = document.getElementById("jbe-inv-status").value;
      invoice.amount_total = newAmount;
      invoice.discount = newDiscount;
      invoice.additional_charges = newOther;
      jbeRenderInvoiceBox(event, invoice, payments);
    } else _jbToast(res.error, true);
  });
  if (quoteBasis > 0) {
    document.getElementById("jbe-inv-sync-quote-btn").addEventListener("click", () => {
      document.getElementById("jbe-inv-amount").value = quoteBasis;
      jbeUpdateInvoiceQuoteFlag();
      recalcInvoiceTotal();
    });
  }
  if (actualBasis > 0) {
    document.getElementById("jbe-inv-sync-actual-btn").addEventListener("click", () => {
      document.getElementById("jbe-inv-amount").value = actualBasis;
      jbeUpdateInvoiceQuoteFlag();
      recalcInvoiceTotal();
    });
  }
  document.getElementById("jbe-inv-print-btn").addEventListener("click", () => {
    const job = _jbCurrentJob || {};
    printFormalInvoice({
      invoiceNumber: invoice.invoice_number,
      issueDate: _jbFormatDate(invoice.issue_date),
      dueDate: _jbFormatDate(invoice.due_date),
      status: invoice.status,
      customer: _jbCustName(job.customer),
      phone: job.customer && job.customer.phone,
      address: [event.service_address || job.job_address, event.service_city || job.job_city].filter(Boolean).join(", "),
      jobTitle: saaEventTypeLabel(event.event_type),
      description: event.description || event.reason || "",
      amountTotal: invoice.amount_total,
      discount: invoice.discount,
      additionalCharges: invoice.additional_charges,
      amountPaid: paid,
      payments,
    });
  });
  document.getElementById("jbe-pay-save-btn").addEventListener("click", async () => {
    const amount = parseFloat(document.getElementById("jbe-pay-amount").value) || 0;
    const res = await saaJobsRecordPayment({
      invoiceId: invoice.id,
      customerId: event.customer_id,
      amount,
      paymentDate: document.getElementById("jbe-pay-date").value,
      method: document.getElementById("jbe-pay-method").value,
      referenceNumber: document.getElementById("jbe-pay-ref").value.trim(),
    });
    if (res.ok) {
      const freshPayments = await saaJobsFetchPayments(invoice.id);
      _jbeCurrentPayments = freshPayments;
      const freshInvoice = await _saaClient.from("invoices").select("*").eq("id", invoice.id).single();
      _jbeCurrentInvoice = freshInvoice.data || invoice;
      jbeRenderInvoiceBox(event, _jbeCurrentInvoice, freshPayments);
      _jbToast("Payment recorded.");
    } else {
      _jbToast(res.error, true);
    }
  });
  jbeUpdateInvoiceQuoteFlag();
}

/* ============================== Equipment (Condenser / Coil / Furnace) ============================== */

function jbRenderEquipmentBlock(type, label) {
  const block = document.querySelector(`.jb-eq-block[data-eqtype="${type}"]`);
  if (!block) return;
  const row = _jbEquipByType[type];
  const toggleBtn = block.querySelector(".jb-eq-toggle-btn");
  const lockBtn = block.querySelector(".jb-eq-lock-btn");
  const fields = block.querySelector(".jb-eq-fields");
  const hasData = !!row;
  const locked = !!(row && row.locked);

  toggleBtn.textContent = hasData ? `Edit ${label}` : `+ Add ${label}`;
  lockBtn.hidden = !hasData;
  lockBtn.textContent = locked ? "🔒 Locked" : "🔓 Unlocked";
  lockBtn.classList.toggle("jb-locked", locked);
  if (!fields.dataset.opened) fields.hidden = !hasData;

  block.querySelector(".jb-eq-brand").value = row ? row.brand || "" : "";
  block.querySelector(".jb-eq-model").value = row ? row.model || "" : "";
  block.querySelector(".jb-eq-serial").value = row ? row.serial_number || "" : "";
  block.querySelector(".jb-eq-refrigerant").value = row ? row.refrigerant_type || "" : "";
  block.querySelector(".jb-eq-tonnage").value = row ? row.tonnage || "" : "";
  block.querySelector(".jb-eq-installyear").value = row ? row.install_year || "" : "";
  block.querySelector(".jb-eq-warranty").value = row ? row.warranty_status || "unknown" : "unknown";
  fields.querySelectorAll("input, select").forEach((el) => { el.disabled = locked; });
}

function jbRenderAllEquipment() {
  SAA_EQUIPMENT_TYPES.forEach(([type, label]) => jbRenderEquipmentBlock(type, label));
}

/** Wired once on load: the Add/Edit toggle just shows/hides that type's
 *  fields; the lock button persists immediately since it's a discrete
 *  action, not a text field waiting on the main Save button. */
function jbWireEquipmentBlocks() {
  SAA_EQUIPMENT_TYPES.forEach(([type, label]) => {
    const block = document.querySelector(`.jb-eq-block[data-eqtype="${type}"]`);
    if (!block) return;
    block.querySelector(".jb-eq-toggle-btn").addEventListener("click", () => {
      const fields = block.querySelector(".jb-eq-fields");
      fields.hidden = !fields.hidden;
      fields.dataset.opened = "1";
    });
    block.querySelector(".jb-eq-lock-btn").addEventListener("click", async () => {
      const row = _jbEquipByType[type];
      if (!row) return;
      const newLocked = !row.locked;
      const res = await saaJobsToggleEquipmentLock(row.id, newLocked);
      if (res.ok) {
        row.locked = newLocked;
        jbRenderEquipmentBlock(type, label);
        _jbToast(newLocked ? `${label} locked.` : `${label} unlocked.`);
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

/* ============================== Photos ============================== */

function jbRenderPhotoGrid() {
  const grid = document.getElementById("jbd-photos-grid");
  // photo_type excludes receipts (Round 6) from the general grid even
  // though, like general photos, they have no inspection_item_index.
  const general = _jbPhotos.filter((p) => p.inspection_item_index == null && p.photo_type !== "receipt");
  if (!general.length) {
    grid.innerHTML = `<span class="jb-photo-empty">No photos yet.</span>`;
    return;
  }
  grid.innerHTML = general.map((p) => `
    <div class="jb-photo-thumb" data-id="${p.id}">
      <img src="${p.url}" alt="Job photo">
      <button type="button" class="jb-photo-del" data-id="${p.id}" title="Delete photo">&times;</button>
    </div>`).join("");
  grid.querySelectorAll(".jb-photo-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photo = _jbPhotos.find((p) => p.id === btn.dataset.id);
      if (!photo) return;
      const res = await saaPhotosDelete(photo);
      if (res.ok) {
        _jbPhotos = _jbPhotos.filter((p) => p.id !== photo.id);
        jbRenderPhotoGrid();
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

function jbAddPhotos() {
  if (!_jbCurrentJob) return;
  saaCamOpen(async (blobs) => {
    for (const blob of blobs) {
      const res = await saaPhotosUpload(_jbCurrentJob.id, blob, null);
      if (res.ok) _jbPhotos.push(res.photo);
      else _jbToast(res.error, true);
    }
    jbRenderPhotoGrid();
    _jbToast(`${blobs.length} photo${blobs.length === 1 ? "" : "s"} added.`);
  });
}

/* ---- Warranty Documents — PDF/Word files attached to a job (manufacturer
   warranty cards, extended-warranty paperwork, signed registrations).
   Same list-render/upload/delete shape as Photos above, just files instead
   of images, and no camera capture — a plain file-picker input. ---- */
function _jbFileSizeLabel(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function jbRenderWarrantyList() {
  const list = document.getElementById("jbd-warranty-list");
  if (!_jbWarrantyFiles.length) {
    list.innerHTML = `<span class="jb-photo-empty">No warranty files yet.</span>`;
    return;
  }
  list.innerHTML = _jbWarrantyFiles.map((f) => `
    <div class="jb-file-row" data-id="${f.id}">
      <span class="jb-file-icon">${f.file_type === "pdf" ? "📄" : "📝"}</span>
      <a href="${f.url}" target="_blank" rel="noopener">${f.file_name}</a>
      <span class="jb-file-size">${_jbFileSizeLabel(f.file_size_bytes)}</span>
      <button type="button" class="jb-photo-del" data-id="${f.id}" title="Delete file">&times;</button>
    </div>`).join("");
  list.querySelectorAll(".jb-photo-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const file = _jbWarrantyFiles.find((f) => f.id === btn.dataset.id);
      if (!file) return;
      const ok = await saaConfirm(`Delete "${file.file_name}"? This can't be undone.`, { title: "Delete warranty file", okLabel: "Delete", cancelLabel: "Cancel" });
      if (!ok) return;
      const res = await saaWarrantyDelete(file);
      if (res.ok) {
        _jbWarrantyFiles = _jbWarrantyFiles.filter((f) => f.id !== file.id);
        jbRenderWarrantyList();
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

async function jbAddWarrantyFiles(fileList) {
  if (!_jbCurrentJob || !fileList || !fileList.length) return;
  const files = Array.from(fileList);
  let added = 0;
  let lastError = null;
  for (const file of files) {
    const res = await saaWarrantyUpload(_jbCurrentJob.id, file);
    if (res.ok) { _jbWarrantyFiles.push(res.file); added++; }
    else lastError = res.error;
  }
  jbRenderWarrantyList();
  // Show whichever the office most needs to see: if everything failed,
  // the (specific, e.g. "not a PDF or Word file") error; if only some
  // failed, both counts; only silence the error when every file made it.
  if (added && !lastError) {
    _jbToast(`${added} file${added === 1 ? "" : "s"} added.`);
  } else if (added && lastError) {
    _jbToast(`${added} added, but: ${lastError}`, true);
  } else {
    _jbToast(lastError || "Couldn't add that file.", true);
  }
}

/* ---- Receipts (Round 6) — same camera-capture/upload/delete plumbing as
   Photos above, filed under photo_type 'receipt' so they show in their own
   drawer section instead of the general Photos grid. ---- */
function jbRenderReceiptGrid() {
  const grid = document.getElementById("jbd-receipts-grid");
  const receipts = _jbPhotos.filter((p) => p.photo_type === "receipt");
  if (!receipts.length) {
    grid.innerHTML = `<span class="jb-photo-empty">No receipts yet.</span>`;
    return;
  }
  grid.innerHTML = receipts.map((p) => `
    <div class="jb-photo-thumb" data-id="${p.id}">
      <img src="${p.url}" alt="Receipt">
      <button type="button" class="jb-photo-del" data-id="${p.id}" title="Delete receipt">&times;</button>
    </div>`).join("");
  grid.querySelectorAll(".jb-photo-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photo = _jbPhotos.find((p) => p.id === btn.dataset.id);
      if (!photo) return;
      const res = await saaPhotosDelete(photo);
      if (res.ok) {
        _jbPhotos = _jbPhotos.filter((p) => p.id !== photo.id);
        jbRenderReceiptGrid();
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

function jbAddReceipt() {
  if (!_jbCurrentJob) return;
  // Reuses camera-capture.js's existing take-a-photo-or-pick-a-file modal
  // unchanged — a receipt is just a photo filed under a different type.
  saaCamOpen(async (blobs) => {
    for (const blob of blobs) {
      const res = await saaPhotosUpload(_jbCurrentJob.id, blob, null, "receipt");
      if (res.ok) _jbPhotos.push(res.photo);
      else _jbToast(res.error, true);
    }
    jbRenderReceiptGrid();
    _jbToast(`${blobs.length} receipt${blobs.length === 1 ? "" : "s"} added.`);
  }, "Add Receipt");
}

/* ============================== Round 42 Task 124: Event modal — Photos + Receipts ==============================
 * Direct mirror of jbRenderPhotoGrid/jbAddPhotos/jbRenderReceiptGrid/
 * jbAddReceipt above, scoped to the open Event's OWN photos (_jbePhotos,
 * fetched via saaPhotosFetchForEvent) instead of the whole Job's. Needs a
 * real event_id to attach a photo to (saaPhotosUpload's optional 5th
 * eventId arg) -- shows a "Save this Event first" placeholder otherwise. */
function jbeRenderPhotoGrid() {
  const grid = document.getElementById("jbe-photos-grid");
  if (!_jbEventModalTarget || !_jbEventModalTarget.id) {
    grid.innerHTML = `<span class="jb-photo-empty">Save this Event first, then add photos.</span>`;
    return;
  }
  const general = _jbePhotos.filter((p) => p.inspection_item_index == null && p.photo_type !== "receipt");
  if (!general.length) {
    grid.innerHTML = `<span class="jb-photo-empty">No photos yet.</span>`;
    return;
  }
  grid.innerHTML = general.map((p) => `
    <div class="jb-photo-thumb" data-id="${p.id}">
      <img src="${p.url}" alt="Event photo">
      <button type="button" class="jb-photo-del" data-id="${p.id}" title="Delete photo">&times;</button>
    </div>`).join("");
  grid.querySelectorAll(".jb-photo-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photo = _jbePhotos.find((p) => p.id === btn.dataset.id);
      if (!photo) return;
      const res = await saaPhotosDelete(photo);
      if (res.ok) {
        _jbePhotos = _jbePhotos.filter((p) => p.id !== photo.id);
        jbeRenderPhotoGrid();
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

function jbeAddPhotos() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then add photos.", true); return; }
  saaCamOpen(async (blobs) => {
    for (const blob of blobs) {
      const res = await saaPhotosUpload(event.job_id, blob, null, "general", event.id);
      if (res.ok) _jbePhotos.push(res.photo);
      else _jbToast(res.error, true);
    }
    jbeRenderPhotoGrid();
    _jbToast(`${blobs.length} photo${blobs.length === 1 ? "" : "s"} added.`);
  });
}

function jbeRenderReceiptGrid() {
  const grid = document.getElementById("jbe-receipts-grid");
  if (!_jbEventModalTarget || !_jbEventModalTarget.id) {
    grid.innerHTML = `<span class="jb-photo-empty">Save this Event first, then add receipts.</span>`;
    return;
  }
  const receipts = _jbePhotos.filter((p) => p.photo_type === "receipt");
  if (!receipts.length) {
    grid.innerHTML = `<span class="jb-photo-empty">No receipts yet.</span>`;
    return;
  }
  grid.innerHTML = receipts.map((p) => `
    <div class="jb-photo-thumb" data-id="${p.id}">
      <img src="${p.url}" alt="Receipt">
      <button type="button" class="jb-photo-del" data-id="${p.id}" title="Delete receipt">&times;</button>
    </div>`).join("");
  grid.querySelectorAll(".jb-photo-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const photo = _jbePhotos.find((p) => p.id === btn.dataset.id);
      if (!photo) return;
      const res = await saaPhotosDelete(photo);
      if (res.ok) {
        _jbePhotos = _jbePhotos.filter((p) => p.id !== photo.id);
        jbeRenderReceiptGrid();
      } else {
        _jbToast(res.error, true);
      }
    });
  });
}

function jbeAddReceipt() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then add receipts.", true); return; }
  saaCamOpen(async (blobs) => {
    for (const blob of blobs) {
      const res = await saaPhotosUpload(event.job_id, blob, null, "receipt", event.id);
      if (res.ok) _jbePhotos.push(res.photo);
      else _jbToast(res.error, true);
    }
    jbeRenderReceiptGrid();
    _jbToast(`${blobs.length} receipt${blobs.length === 1 ? "" : "s"} added.`);
  }, "Add Receipt");
}

/* ============================== Inspection checklist ============================== */
/* Round 42 Task 122-124, per Vijayan: "Checklist: give each Event its own
 * separate checklist" -- rather than building a second copy of this modal,
 * the ONE existing jb-inspection-modal/jb-insp-list is reused for both the
 * Job Card's own checklist and whichever Event is open in jb-event-modal;
 * _jbInspModalTarget (declared near the top of this file) says which one
 * it's currently showing, and every function below branches on it. */

function _jbInspCount() {
  const total = INSPECTION_ITEMS.length;
  const checked = _jbInspectionResults.filter((r) => r && r.checked).length;
  const photos = _jbPhotos.filter((p) => p.inspection_item_index != null).length;
  return { total, checked, photos };
}

function jbRenderInspectionSummary() {
  const { total, checked, photos } = _jbInspCount();
  const el = document.getElementById("jbd-insp-summary");
  el.textContent = checked === 0 && photos === 0
    ? "Not started"
    : `${checked} / ${total} items checked · ${photos} photo${photos === 1 ? "" : "s"}`;
}

/* Event modal's own equivalent of _jbInspCount/jbRenderInspectionSummary
 * above -- shows a "Save this Event first" placeholder until the Event has
 * a real id, same as Mileage/Photos/Invoice/BOM further down. */
function _jbeInspCount() {
  const total = INSPECTION_ITEMS.length;
  const checked = _jbeInspectionResults.filter((r) => r && r.checked).length;
  const photos = _jbePhotos.filter((p) => p.inspection_item_index != null).length;
  return { total, checked, photos };
}

function jbeRenderInspectionSummary() {
  const el = document.getElementById("jbe-insp-summary");
  if (!_jbEventModalTarget || !_jbEventModalTarget.id) {
    el.textContent = "Save this Event first";
    return;
  }
  const { total, checked, photos } = _jbeInspCount();
  el.textContent = checked === 0 && photos === 0
    ? "Not started"
    : `${checked} / ${total} items checked · ${photos} photo${photos === 1 ? "" : "s"}`;
}

function jbRenderInspectionList() {
  const isEvent = _jbInspModalTarget === "event";
  const results = isEvent ? _jbeInspectionResults : _jbInspectionResults;
  const photos = isEvent ? _jbePhotos : _jbPhotos;
  const list = document.getElementById("jb-insp-list");
  list.innerHTML = INSPECTION_ITEMS.map((item, i) => {
    const result = results.find((r) => r && r.index === i);
    const checked = !!(result && result.checked);
    const photoCount = photos.filter((p) => p.inspection_item_index === i).length;
    return `<li data-i="${i}" class="${checked ? "checked" : ""}">
      <input type="checkbox" id="insp-chk-${i}" ${checked ? "checked" : ""}>
      <label for="insp-chk-${i}">${item}</label>
      <button type="button" class="jb-insp-cam-btn${photoCount ? " has-photos" : ""}" data-i="${i}">📷${photoCount ? " " + photoCount : ""}</button>
    </li>`;
  }).join("");

  list.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener("change", () => {
      const i = parseInt(box.closest("li").dataset.i, 10);
      const arr = isEvent ? _jbeInspectionResults : _jbInspectionResults;
      const existing = arr.find((r) => r && r.index === i);
      if (existing) existing.checked = box.checked;
      else arr.push({ index: i, item: INSPECTION_ITEMS[i], checked: box.checked });
      box.closest("li").classList.toggle("checked", box.checked);
    });
  });
  list.querySelectorAll(".jb-insp-cam-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i, 10);
      saaCamOpen(async (blobs) => {
        for (const blob of blobs) {
          const res = isEvent
            ? await saaPhotosUpload(_jbEventModalTarget.job_id, blob, i, null, _jbEventModalTarget.id)
            : await saaPhotosUpload(_jbCurrentJob.id, blob, i);
          if (res.ok) { if (isEvent) _jbePhotos.push(res.photo); else _jbPhotos.push(res.photo); }
          else _jbToast(res.error, true);
        }
        jbRenderInspectionList();
        if (isEvent) { jbeRenderInspectionSummary(); jbeRenderPhotoGrid(); } else { jbRenderInspectionSummary(); jbRenderPhotoGrid(); }
      });
    });
  });
}

function jbOpenInspectionModal() {
  if (!_jbCurrentJob) return;
  _jbInspModalTarget = "job";
  jbRenderInspectionList();
  document.getElementById("jb-inspection-modal").hidden = false;
}

/* Event modal's own "Open Inspection Checklist" -- needs a real event_id
 * to tag any photos taken from it, so (like Mileage/Photos/Invoice/BOM
 * further down) it's only reachable once the Event has been saved once. */
function jbeOpenInspectionModal() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then open its checklist.", true); return; }
  _jbInspModalTarget = "event";
  jbRenderInspectionList();
  document.getElementById("jb-inspection-modal").hidden = false;
}

async function jbSaveInspection() {
  if (_jbInspModalTarget === "event") {
    const event = _jbEventModalTarget;
    if (!event || !event.id) return;
    const res = await saaEventsUpdate(event.id, { inspection_results: _jbeInspectionResults });
    if (res.ok) {
      event.inspection_results = _jbeInspectionResults;
      jbeRenderInspectionSummary();
      document.getElementById("jb-inspection-modal").hidden = true;
      _jbToast("Inspection saved.");
    } else {
      _jbToast(res.error, true);
    }
    return;
  }
  if (!_jbCurrentJob) return;
  const res = await saaJobsUpdateJob(_jbCurrentJob.id, { inspection_results: _jbInspectionResults });
  if (res.ok) {
    _jbCurrentJob.inspection_results = _jbInspectionResults;
    jbRenderInspectionSummary();
    document.getElementById("jb-inspection-modal").hidden = true;
    _jbToast("Inspection saved.");
  } else {
    _jbToast(res.error, true);
  }
}

/* ============================== Bill of Material ============================== */
/* Round 12 redesign (2026-09-13): "dont show bill of material in job
 * card" -- the freely-typed BOM UI that used to live inline in the Job
 * Card's drawer is gone. The quick-actions button is now a plain link to
 * the dedicated Bill of Material page (bill-of-material.html), pointed at
 * this job — see jbWireBomLink below, called from jbOpenDetail. */
function jbWireBomLink(job) {
  const href = `bill-of-material.html?job=${encodeURIComponent(job.job_number || job.id)}`;
  // Round 15: a second Bill of Material link right in the Equipment
  // section (in addition to the quick-actions one at the top) -- Vijayan
  // pointed at the Equipment section specifically when asking for a BOM
  // button, so both stay wired to the same page rather than replacing
  // one with the other.
  ["jbd-quick-bom-btn", "jbd-eq-bom-btn"].forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.href = href;
  });
}

/** Round 42 Task 122-124: the Event modal's own "Bill of Material" link --
 *  same plain-link-to-the-dedicated-page pattern as jbWireBomLink above,
 *  but pointed at bill-of-material.html?event=<id> (saaBomFetchEvent in
 *  bom-db.js) so each Event gets its OWN Bill of Material, separate from
 *  the parent Job's. Needs a real event_id, so it's disabled (via the
 *  click-guard wired in DOMContentLoaded below) until the Event has been
 *  saved once, same as Mileage/Photos/Invoice further down. */
function jbeWireBomLink(event) {
  const link = document.getElementById("jbe-bom-btn");
  if (!link) return;
  if (event && event.id) {
    link.href = `bill-of-material.html?event=${encodeURIComponent(event.id)}`;
    link.textContent = "🧰 Bill of Material";
  } else {
    link.removeAttribute("href");
    link.textContent = "🧰 Bill of Material (save event first)";
  }
}

/* ============================== Quotation quick link ============================== */
/* Round 37 (2026-09-17), per Vijayan's annotated screenshot ("Quotation"
 * hand-written and circled next to the Checklist/Receipt/Invoice/Bill of
 * Material quick-access row) plus the plain-text instruction "add
 * quotation to job card" -- same idea as jbWireBomLink above: a plain
 * link to the actual Quotation/Repair worksheet page, not an inline
 * editor. When the job already has a linked quote, deep-link straight to
 * it (same quotation.html?quote=<id> / repair.html?quote=<id> pattern the
 * Jobs list's Quote $ column already uses); otherwise send them to a
 * blank Quotation page to start one, since there's nothing to load yet. */
function jbWireQuoteLink(job) {
  const link = document.getElementById("jbd-quick-quote-btn");
  if (!link) return;
  if (job.linked_quote_id) {
    const page = (job.linkedQuote && job.linkedQuote.quote_type === "repair") ? "repair.html" : "quotation.html";
    link.href = `${page}?quote=${encodeURIComponent(job.linked_quote_id)}`;
  } else {
    link.href = "quotation.html";
  }
}

/* ============================== Mileage ============================== */

/** Builds a plain snapshot from the Job Card's LIVE field values (not the
 *  possibly-stale _jbCurrentJob object) — so mileage can be calculated
 *  using whatever's currently on screen (tech just picked, address just
 *  typed) even before "Save Job Card" is clicked, same as other Job Card
 *  helper actions (e.g. quote-select) work against in-progress edits. */
function _jbMileageSnapshot() {
  if (!_jbCurrentJob) return null;
  return {
    id: _jbCurrentJob.id,
    assigned_technician_id: document.getElementById("jbd-tech").value || null,
    scheduled_date: document.getElementById("jbd-scheduled").value || null,
    scheduled_time: document.getElementById("jbd-time").value || null,
    job_address: document.getElementById("jbd-address").value.trim() || null,
    job_city: document.getElementById("jbd-city").value.trim() || null,
    job_state: document.getElementById("jbd-state").value.trim() || null,
    job_zip: document.getElementById("jbd-zip").value.trim() || null,
  };
}

/** Updates only the "Trip: from → to" context line from whatever's
 *  currently in the tech/date/address fields — safe to call on every
 *  field change without disturbing the Miles Driven value the office may
 *  already be editing. */
async function _jbUpdateMileageContext() {
  const ctxEl = document.getElementById("jbd-mileage-context");
  const snap = _jbMileageSnapshot();
  if (!snap || !snap.assigned_technician_id || !snap.scheduled_date) {
    ctxEl.textContent = "Assign a technician and a Scheduled Date to calculate this trip.";
    return;
  }
  const leg = await saaMileageLegContext(snap);
  const dest = saaMileageJobAddress(snap);
  // Round 33 (2026-09-16): a from-address that isn't the shop was read as a
  // bug ("this is not company address") -- it's actually this technician's
  // PRIOR job of the same day chaining into this one (see the design note
  // atop mileage-db.js: only the day's first leg starts from the shop).
  // Spelling that out here instead of just showing the bare address should
  // make it read as intentional instead of wrong.
  const legNote = leg.legOrder === 1
    ? " (first stop of the day, from the shop)"
    : ` (leg ${leg.legOrder} of the day — starts where this technician's previous job ended)`;
  ctxEl.textContent = dest
    ? `Trip: ${leg.fromAddress} → ${dest}${legNote}`
    : `Trip starts at: ${leg.fromAddress}${legNote} (add a Service Address to complete the route)`;
}

/** Full render on Job Card open — context line plus the saved Miles
 *  Driven value/note for this job. */
async function jbRenderMileageSection(job) {
  const milesEl = document.getElementById("jbd-mileage-miles");
  const noteEl = document.getElementById("jbd-mileage-note");
  await _jbUpdateMileageContext();

  const existing = await saaMileageFetchForJob(job.id);
  milesEl.value = existing && existing.miles != null ? existing.miles : "";
  job._jbMileageMilesAtOpen = milesEl.value;
  noteEl.textContent = existing
    ? (existing.source === "manual" ? "Entered manually." : "Auto-calculated from addresses.")
    : "";

  // Round 45 (2026-09-22): the return-to-office leg for this same job/
  // event, if one's already on file (either from a prior click of
  // "Calculate Return Miles" below, or from the background end-of-day
  // sync in mileage-db.js).
  const returnMilesEl = document.getElementById("jbd-return-mileage-miles");
  const returnNoteEl = document.getElementById("jbd-return-mileage-note");
  const existingReturn = await saaMileageFetchForJob(job.id, null, "return_to_shop");
  returnMilesEl.value = existingReturn && existingReturn.miles != null ? existingReturn.miles : "";
  returnNoteEl.textContent = existingReturn ? "Auto-calculated from addresses." : "";
}

async function jbCalculateMileage() {
  if (!_jbCurrentJob) return;
  const snap = _jbMileageSnapshot();
  const btn = document.getElementById("jbd-mileage-calc-btn");
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    let res = await saaMileageRecalcForJob(snap);
    if (!res.ok && res.manual) {
      const ok = await saaConfirm("This trip's mileage was entered manually. Recalculate and overwrite it?", { title: "Overwrite manual entry", okLabel: "Recalculate", cancelLabel: "Cancel" });
      if (!ok) return;
      res = await saaMileageRecalcForJob(snap, true);
    }
    if (res.ok) {
      document.getElementById("jbd-mileage-miles").value = res.log.miles != null ? res.log.miles : "";
      _jbCurrentJob._jbMileageMilesAtOpen = document.getElementById("jbd-mileage-miles").value;
      document.getElementById("jbd-mileage-note").textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Miles";
  }
}

/** Round 45 (2026-09-22), per Vijayan: "Add another button to calculate
 *  return miles to office" -- the Job Card's own trigger for the trip
 *  home (job site -> SAA_COMPANY_ADDRESS), same button/field pattern as
 *  jbCalculateMileage above, just the reverse leg. */
async function jbCalculateReturnMileage() {
  if (!_jbCurrentJob) return;
  const snap = _jbMileageSnapshot();
  const btn = document.getElementById("jbd-return-mileage-calc-btn");
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    const res = await saaMileageRecalcReturnForJob(snap);
    if (res.ok) {
      document.getElementById("jbd-return-mileage-miles").value = res.log.miles != null ? res.log.miles : "";
      document.getElementById("jbd-return-mileage-note").textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} return miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Return Miles";
  }
}

/** Round 25 (2026-09-14) multi-technician mileage -- technician 2/3's own
 *  opt-in Mileage block (n is 2 or 3). Deliberately simpler than the
 *  primary's: no live "Trip: X → Y" context line, no automatic background
 *  calculation on every save (see jbSaveDetail) -- per Vijayan, this is
 *  only for "if they drive separately," so it starts blank and stays
 *  exactly whatever the office last calculated or typed in for that
 *  technician's own leg. */
function _jbMileageSlotTechId(n) {
  const sel = document.getElementById(`jbd-tech${n}`);
  return (sel && sel.value) || null;
}

async function jbRenderMileageSlot(job, n) {
  const techId = _jbMileageSlotTechId(n);
  const block = document.getElementById(`jbd-mileage${n}-block`);
  block.hidden = !techId;
  if (!techId) return;
  const milesEl = document.getElementById(`jbd-mileage${n}-miles`);
  const noteEl = document.getElementById(`jbd-mileage${n}-note`);
  const existing = await saaMileageFetchForJob(job.id, techId);
  milesEl.value = existing && existing.miles != null ? existing.miles : "";
  job[`_jbMileage${n}MilesAtOpen`] = milesEl.value;
  noteEl.textContent = existing
    ? (existing.source === "manual" ? "Entered manually." : "Auto-calculated from addresses.")
    : "";
}

async function jbCalculateMileageSlot(n) {
  if (!_jbCurrentJob) return;
  const techId = _jbMileageSlotTechId(n);
  if (!techId) return;
  const snap = _jbMileageSnapshot();
  const btn = document.getElementById(`jbd-mileage${n}-calc-btn`);
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    let res = await saaMileageRecalcForJob(snap, false, techId);
    if (!res.ok && res.manual) {
      const ok = await saaConfirm("This trip's mileage was entered manually. Recalculate and overwrite it?", { title: "Overwrite manual entry", okLabel: "Recalculate", cancelLabel: "Cancel" });
      if (!ok) return;
      res = await saaMileageRecalcForJob(snap, true, techId);
    }
    if (res.ok) {
      document.getElementById(`jbd-mileage${n}-miles`).value = res.log.miles != null ? res.log.miles : "";
      _jbCurrentJob[`_jbMileage${n}MilesAtOpen`] = document.getElementById(`jbd-mileage${n}-miles`).value;
      document.getElementById(`jbd-mileage${n}-note`).textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Miles";
  }
}

/* ============================== Round 42 Task 124: Event modal — Mileage ==============================
 * Direct mirror of the primary/slot Mileage functions just above, scoped
 * to the open Event's OWN mileage leg (mileage_logs.event_id, via the
 * event-based saaMileage*ForEvent functions in mileage-db.js) instead of
 * the Job's -- per Vijayan: "Mileage similar logic to job card." Needs a
 * real event_id (mileage_logs.event_id has a NOT NULL-equivalent unique
 * constraint pairing -- see the mileage-db.js rewrite notes), so this
 * whole section shows a "Save this Event first" placeholder in create mode
 * and goes fully live once the Event has been saved once. */

/** Builds a plain object shaped like an Event row from the modal's LIVE
 *  field values (not the possibly-stale _jbEventModalTarget), same idea as
 *  the Job Card's own _jbMileageSnapshot -- so mileage can be calculated
 *  off whatever's currently on screen (tech just picked, address just
 *  edited) even before Save Event is clicked again. */
function _jbeMileageEventSnapshot() {
  const event = _jbEventModalTarget;
  if (!event) return null;
  const dateVal = document.getElementById("jbe-date").value;
  const timeVal = document.getElementById("jbe-time").value || "09:00";
  return Object.assign({}, event, {
    assigned_technician_id: document.getElementById("jbe-tech").value || null,
    scheduled_start: dateVal ? `${dateVal}T${timeVal}:00` : null,
    service_address: document.getElementById("jbe-address").value.trim() || null,
    service_city: document.getElementById("jbe-city").value.trim() || null,
    service_state: document.getElementById("jbe-state").value.trim() || null,
    service_zip: document.getElementById("jbe-zip").value.trim() || null,
  });
}

async function jbeRenderMileageSection() {
  const context = document.getElementById("jbe-mileage-context");
  const milesEl = document.getElementById("jbe-mileage-miles");
  const noteEl = document.getElementById("jbe-mileage-note");
  const event = _jbEventModalTarget;
  if (!event || !event.id) {
    context.textContent = "Save this Event first, then calculate mileage.";
    milesEl.value = "";
    noteEl.textContent = "";
    return;
  }
  const snap = _jbeMileageEventSnapshot();
  const techId = snap.assigned_technician_id;
  if (!techId || !snap.scheduled_start) {
    context.textContent = "Assign a technician and a Scheduled Date to calculate this trip.";
  } else {
    const leg = await saaMileageEventLegContext(snap, techId, _jbCurrentJob);
    const dest = saaMileageEventAddress(snap, _jbCurrentJob);
    const legNote = leg.legOrder === 1
      ? " (first stop of the day, from the shop)"
      : ` (leg ${leg.legOrder} of the day — starts where this technician's previous job ended)`;
    context.textContent = dest
      ? `Trip: ${leg.fromAddress} → ${dest}${legNote}`
      : `Trip starts at: ${leg.fromAddress}${legNote} (add a Service Address to complete the route)`;
  }
  const existing = await saaMileageFetchForEvent(event.id, techId);
  milesEl.value = existing && existing.miles != null ? existing.miles : "";
  _jbeMileageAtOpen.primary = milesEl.value;
  noteEl.textContent = existing
    ? (existing.source === "manual" ? "Entered manually." : "Auto-calculated from addresses.")
    : "";

  // Round 45 (2026-09-22): Event-modal mirror of the Job Card's Return
  // Miles (to Office) display -- see jbRenderMileageSection.
  const returnMilesEl = document.getElementById("jbe-return-mileage-miles");
  const returnNoteEl = document.getElementById("jbe-return-mileage-note");
  const existingReturn = await saaMileageFetchForEvent(event.id, techId, "return_to_shop");
  returnMilesEl.value = existingReturn && existingReturn.miles != null ? existingReturn.miles : "";
  returnNoteEl.textContent = existingReturn ? "Auto-calculated from addresses." : "";
}

async function jbeCalculateMileage() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then calculate mileage.", true); return; }
  const snap = _jbeMileageEventSnapshot();
  const btn = document.getElementById("jbe-mileage-calc-btn");
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    let res = await saaMileageRecalcForEvent(snap, false, null, _jbCurrentJob);
    if (!res.ok && res.manual) {
      const ok = await saaConfirm("This trip's mileage was entered manually. Recalculate and overwrite it?", { title: "Overwrite manual entry", okLabel: "Recalculate", cancelLabel: "Cancel" });
      if (!ok) return;
      res = await saaMileageRecalcForEvent(snap, true, null, _jbCurrentJob);
    }
    if (res.ok) {
      document.getElementById("jbe-mileage-miles").value = res.log.miles != null ? res.log.miles : "";
      _jbeMileageAtOpen.primary = document.getElementById("jbe-mileage-miles").value;
      document.getElementById("jbe-mileage-note").textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Miles";
  }
}

/** Round 45 (2026-09-22): Event-modal mirror of jbCalculateReturnMileage
 *  above -- this Event's own trip home (its Service Address ->
 *  SAA_COMPANY_ADDRESS). */
async function jbeCalculateReturnMileage() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then calculate mileage.", true); return; }
  const snap = _jbeMileageEventSnapshot();
  const btn = document.getElementById("jbe-return-mileage-calc-btn");
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    const res = await saaMileageRecalcReturnForEvent(snap, false, null, _jbCurrentJob);
    if (res.ok) {
      document.getElementById("jbe-return-mileage-miles").value = res.log.miles != null ? res.log.miles : "";
      document.getElementById("jbe-return-mileage-note").textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} return miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Return Miles";
  }
}

function _jbeMileageSlotTechId(n) {
  const sel = document.getElementById(`jbe-tech${n}`);
  return (sel && sel.value) || null;
}

async function jbeRenderMileageSlot(n) {
  const event = _jbEventModalTarget;
  const techId = _jbeMileageSlotTechId(n);
  const block = document.getElementById(`jbe-mileage${n}-block`);
  const available = !!(techId && event && event.id);
  block.hidden = !available;
  if (!available) return;
  const milesEl = document.getElementById(`jbe-mileage${n}-miles`);
  const noteEl = document.getElementById(`jbe-mileage${n}-note`);
  const existing = await saaMileageFetchForEvent(event.id, techId);
  milesEl.value = existing && existing.miles != null ? existing.miles : "";
  _jbeMileageAtOpen[n] = milesEl.value;
  noteEl.textContent = existing
    ? (existing.source === "manual" ? "Entered manually." : "Auto-calculated from addresses.")
    : "";
}

async function jbeCalculateMileageSlot(n) {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { _jbToast("Save this Event first, then calculate mileage.", true); return; }
  const techId = _jbeMileageSlotTechId(n);
  if (!techId) return;
  const snap = _jbeMileageEventSnapshot();
  const btn = document.getElementById(`jbe-mileage${n}-calc-btn`);
  btn.disabled = true;
  btn.textContent = "Calculating…";
  try {
    let res = await saaMileageRecalcForEvent(snap, false, techId, _jbCurrentJob);
    if (!res.ok && res.manual) {
      const ok = await saaConfirm("This trip's mileage was entered manually. Recalculate and overwrite it?", { title: "Overwrite manual entry", okLabel: "Recalculate", cancelLabel: "Cancel" });
      if (!ok) return;
      res = await saaMileageRecalcForEvent(snap, true, techId, _jbCurrentJob);
    }
    if (res.ok) {
      document.getElementById(`jbe-mileage${n}-miles`).value = res.log.miles != null ? res.log.miles : "";
      _jbeMileageAtOpen[n] = document.getElementById(`jbe-mileage${n}-miles`).value;
      document.getElementById(`jbe-mileage${n}-note`).textContent = "Auto-calculated from addresses.";
      _jbToast(`${res.log.miles} miles calculated.`);
    } else {
      _jbToast(res.error, true);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "📍 Calculate Miles";
  }
}

/* ============================== Round 42 (2026-09-19): System + Event History ==============================
 * Customer -> System -> Job -> Event. The System section shows/edits the
 * one piece of HVAC equipment this Job is permanently attached to; the
 * Event History section lists every visit (Event) against this Job,
 * newest first, each clickable to open its full record. "+ Schedule
 * Follow-Up" / "+ Schedule New Event" both open the same jb-event-modal
 * in create mode, auto-associated to whichever Job is already open --
 * no re-picking Customer/System/Job, per spec. */

const SAA_SYSTEM_TYPE_OPTION_PAIRS = SAA_SYSTEM_TYPE_OPTIONS.map((v) => [v, v]);
const SAA_SYSTEM_ORIENTATION_OPTION_PAIRS = [["", "—"]].concat(SAA_SYSTEM_ORIENTATION_OPTIONS.map((v) => [v, v]));

async function jbRenderSystemSection(job) {
  _jbSystem = job.system_id ? await saaSystemsFetchById(job.system_id) : null;

  const box = document.getElementById("jbd-system-box");
  if (!_jbSystem) {
    box.innerHTML = `<span class="muted" style="font-size:.85rem">No System on file for this job yet.</span>`;
  } else {
    const bits = [_jbSystem.manufacturer, _jbSystem.model_number ? `#${_jbSystem.model_number}` : null, _jbSystem.tonnage ? `${_jbSystem.tonnage}T` : null].filter(Boolean).join(" · ");
    box.innerHTML = `<div class="jb-system-name">${_jbSystem.system_name || "System"}</div>` +
      (bits ? `<div class="jb-system-meta">${bits}</div>` : "");
  }

  document.getElementById("jbd-sys-type").innerHTML = `<option value="">—</option>` + _jbOptionsHtml(SAA_SYSTEM_TYPE_OPTION_PAIRS, _jbSystem ? _jbSystem.system_type : "");
  document.getElementById("jbd-sys-orientation").innerHTML = _jbOptionsHtml(SAA_SYSTEM_ORIENTATION_OPTION_PAIRS, _jbSystem ? _jbSystem.system_orientation : "");
  document.getElementById("jbd-sys-name").value = (_jbSystem && _jbSystem.system_name) || "";
  document.getElementById("jbd-sys-manufacturer").value = (_jbSystem && _jbSystem.manufacturer) || "";
  document.getElementById("jbd-sys-model").value = (_jbSystem && _jbSystem.model_number) || "";
  document.getElementById("jbd-sys-serial").value = (_jbSystem && _jbSystem.serial_number) || "";
  document.getElementById("jbd-sys-tonnage").value = (_jbSystem && _jbSystem.tonnage) || "";
  document.getElementById("jbd-sys-refrigerant").value = (_jbSystem && _jbSystem.refrigerant) || "";
  document.getElementById("jbd-sys-install-date").value = (_jbSystem && _jbSystem.install_date) || "";
  document.getElementById("jbd-sys-location").value = (_jbSystem && _jbSystem.system_location) || "";
  document.getElementById("jbd-sys-warranty").value = (_jbSystem && _jbSystem.warranty_info) || "";
  document.getElementById("jbd-sys-status").textContent = "";
}

async function jbSaveSystem() {
  if (!_jbCurrentJob || !_jbSystem) return;
  const btn = document.getElementById("jbd-sys-save-btn");
  const msg = document.getElementById("jbd-sys-status");
  btn.disabled = true;
  const res = await saaSystemsUpdate(_jbSystem.id, {
    system_name: document.getElementById("jbd-sys-name").value.trim() || "System",
    system_type: document.getElementById("jbd-sys-type").value || null,
    manufacturer: document.getElementById("jbd-sys-manufacturer").value.trim() || null,
    model_number: document.getElementById("jbd-sys-model").value.trim() || null,
    serial_number: document.getElementById("jbd-sys-serial").value.trim() || null,
    tonnage: document.getElementById("jbd-sys-tonnage").value || null,
    refrigerant: document.getElementById("jbd-sys-refrigerant").value.trim() || null,
    install_date: document.getElementById("jbd-sys-install-date").value || null,
    system_location: document.getElementById("jbd-sys-location").value.trim() || null,
    system_orientation: document.getElementById("jbd-sys-orientation").value || null,
    warranty_info: document.getElementById("jbd-sys-warranty").value.trim() || null,
  });
  btn.disabled = false;
  if (res.ok) {
    // jbRenderSystemSection re-populates every field from the DB (and
    // clears jbd-sys-status itself, since it's also used when a fresh Job
    // is opened) -- so the "System saved." message has to be set AFTER
    // that call runs, not before, or this re-render wipes it immediately.
    await jbRenderSystemSection(_jbCurrentJob);
    msg.textContent = "System saved.";
    msg.style.color = "";
  } else {
    msg.textContent = res.error;
    msg.style.color = "#b3261e";
  }
}

function _jbEventTimeLabel(iso) {
  if (!iso) return "Unscheduled";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Unscheduled";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

async function jbRenderEventTimeline(job) {
  _jbEvents = await saaEventsFetchForJob(job.id);
  const list = document.getElementById("jbd-event-list");

  // Round 43 (2026-09-22): "Start Next Job" only makes sense from the
  // CURRENT Job for a Customer+System -- a historical Job's own banner
  // already points at the Event it was converted into, and its
  // Customer+System already has a different, newer current Job elsewhere.
  // Hiding these here avoids someone starting yet another Job from a
  // record that isn't the active one.
  const followupBtn = document.getElementById("jbd-schedule-followup-btn");
  const eventBtn = document.getElementById("jbd-schedule-event-btn");
  const isHistorical = job.is_current === false;
  if (followupBtn) followupBtn.hidden = isHistorical;
  if (eventBtn) eventBtn.hidden = isHistorical;

  if (!_jbEvents.length) {
    list.innerHTML = isHistorical
      ? `<li class="jb-event-empty" style="cursor:default;border:none;padding:4px 2px">This Job is historical — see the linked Event above for its ongoing history.</li>`
      : `<li class="jb-event-empty" style="cursor:default;border:none;padding:4px 2px">No events yet — use "Start Next Job" above once this Job's first visit is done.</li>`;
    return;
  }
  list.innerHTML = _jbEvents.map((e) => {
    const techNames = [e.technician, e.technician2, e.technician3].filter(Boolean).map((t) => t.name).join(", ");
    // Round 43: a chain event carries original_job_number when it was
    // itself produced by a conversion -- surfacing it here traces the
    // permanent history chain (spec items 10/26) without needing to open
    // each Event just to see where it came from.
    const originLine = e.original_job_number ? `<div class="jb-event-meta">Original Job: ${e.original_job_number}</div>` : "";
    return `
    <li data-event-id="${e.id}">
      <div class="jb-event-main">
        <div class="jb-event-title">
          <span>${saaEventTypeLabel(e.event_type)}</span>
          <span class="jb-event-badge evt-${e.event_status}">${saaEventStatusLabel(e.event_status)}</span>
        </div>
        <div class="jb-event-meta">${_jbEventTimeLabel(e.scheduled_start)}${techNames ? " · " + techNames : ""}${e.reason ? " · " + e.reason : ""}</div>
        ${originLine}
      </div>
    </li>`;
  }).join("");
  list.querySelectorAll("li[data-event-id]").forEach((li) => {
    li.addEventListener("click", () => {
      const ev = _jbEvents.find((e) => e.id === li.dataset.eventId);
      if (ev) jbOpenEventModal(ev);
    });
  });
}

function _jbEventTechOptionsHtml(selectedId) {
  return `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}"${t.id === selectedId ? " selected" : ""}>${t.name}</option>`).join("");
}

/** Opens jb-event-modal. Pass an existing Event object to edit it, or
 *  null to create a new one (used by both "+ Schedule Follow-Up" and
 *  "+ Schedule New Event" -- the only difference between them is the
 *  Event Type the form starts pre-set to). */
async function jbOpenEventModal(event, defaultType) {
  _jbEventModalMode = event ? "edit" : "create";
  _jbEventModalTarget = event || null;
  _jbePendingQuote = null; // scratch var from a previous create-mode session -- never carries across opens

  document.getElementById("jb-event-modal-title").textContent = event ? "Event" : "Schedule Event";
  document.getElementById("jb-event-modal-number").textContent = event ? event.event_number : "";
  document.getElementById("jbe-type").innerHTML = _jbOptionsHtml(SAA_EVENT_TYPE_OPTIONS, event ? event.event_type : (defaultType || "service_call"));
  document.getElementById("jbe-status").innerHTML = _jbOptionsHtml(SAA_EVENT_STATUS_OPTIONS, event ? event.event_status : "scheduled");
  document.getElementById("jbe-tech").innerHTML = _jbEventTechOptionsHtml(event ? event.assigned_technician_id : (_jbCurrentJob ? _jbCurrentJob.assigned_technician_id : ""));
  document.getElementById("jbe-tech2").innerHTML = _jbEventTechOptionsHtml(event ? event.assigned_technician_id_2 : "");
  // Round 42 Task 120, per Vijayan: "include all fields and logic in event
  // cards similar to job cards." -- Technician 3 (same optional-slot
  // pattern as Technician 2, no job default) and Priority (defaults from
  // the parent Job's own Priority on a brand-new Event, same as
  // Technician above already does).
  document.getElementById("jbe-tech3").innerHTML = _jbEventTechOptionsHtml(event ? event.assigned_technician_id_3 : "");
  document.getElementById("jbe-priority").innerHTML = _jbOptionsHtml(SAA_JOBS_PRIORITY_OPTIONS, event ? event.priority : (_jbCurrentJob ? _jbCurrentJob.priority : "normal"));

  const start = event && event.scheduled_start ? new Date(event.scheduled_start) : null;
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("jbe-date").value = start ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` : "";
  document.getElementById("jbe-time").value = start ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : "";

  // Completed Date/Time (Job Card parity): confirmed value from
  // completed_at when set, else an estimate from Scheduled Time + this
  // Event Type's usual duration -- see saaEventsGetCompletedTime.
  const completedInfo = await saaEventsGetCompletedTime(event || {});
  document.getElementById("jbe-completed-date").value = completedInfo.date;
  document.getElementById("jbe-completed-time").value = completedInfo.time;
  document.getElementById("jbe-completed-time-note").textContent = completedInfo.isEstimate ? "(estimated from schedule — confirm or edit)" : "";
  _jbEventCompletedAtOpen = { date: completedInfo.date, time: completedInfo.time };

  // Service Address/City/State/ZIP -- an Event's own value once set,
  // falling back to the parent Job's Service Address (both for an old
  // Event that predates these columns and for a brand-new one), same
  // fallback-from-Job pattern as Technician/Priority above.
  const jobFallback = _jbCurrentJob || {};
  document.getElementById("jbe-address").value = (event && event.service_address) || jobFallback.job_address || "";
  document.getElementById("jbe-city").value = (event && event.service_city) || jobFallback.job_city || "";
  document.getElementById("jbe-state").value = (event && event.service_state) || jobFallback.job_state || "TX";
  document.getElementById("jbe-zip").value = (event && event.service_zip) || jobFallback.job_zip || "";

  document.getElementById("jbe-reason").value = (event && event.reason) || "";
  document.getElementById("jbe-description").value = (event && event.description) || "";
  document.getElementById("jbe-tech-notes").value = (event && event.technician_notes) || "";
  document.getElementById("jbe-cust-notes").value = (event && event.customer_notes) || "";
  document.getElementById("jbe-work").value = (event && event.work_performed) || "";
  document.getElementById("jbe-parts").value = (event && event.parts_used) || "";
  document.getElementById("jbe-sig-name").value = (event && event.customer_signature_name) || "";
  document.getElementById("jbe-sig-date").value = (event && event.customer_signature_date) || "";
  document.getElementById("jb-event-status-msg").textContent = "";

  // Round 42 Task 121-124, per Vijayan: "event is once a full job ... all
  // information and control for old job should be passed to that
  // particular event." -- populate every new full-parity section
  // (Quote/Financials/Mileage/Photos/Receipts/Invoice & Payment/
  // Inspection/BOM link), same order the Job Card's own jbOpenDetail
  // populates its jbd-* equivalents.
  document.getElementById("jbe-quoted").value = (event && event.quoted_amount) || "";
  document.getElementById("jbe-approved").value = (event && event.approved_amount) || "";
  document.getElementById("jbe-cost-material").value = (event && event.actual_material_cost) || 0;
  document.getElementById("jbe-cost-labor").value = (event && event.actual_labor_cost) || 0;
  document.getElementById("jbe-cost-other").value = (event && event.other_cost) || 0;
  jbeComputeProfit();

  // The Event row itself (from saaEventsFetchForJob/saaEventsFetchById)
  // doesn't carry a joined linkedQuote -- fetch it here on open, same as
  // the Job Card's own job.linkedQuote is fetched by saaJobsFetchAll.
  if (event) {
    event.linkedQuote = event.linked_quote_id
      ? (await _saaClient.from("quotes").select("*").eq("id", event.linked_quote_id).maybeSingle()).data || null
      : null;
  }
  await jbeRenderQuoteSection(event);
  document.getElementById("jbe-quote-search").value = "";
  document.getElementById("jbe-quote-results").hidden = true;

  await jbeRenderMileageSection();
  await jbeRenderMileageSlot(2);
  await jbeRenderMileageSlot(3);

  _jbePhotos = (event && event.id) ? await saaPhotosFetchForEvent(event.id) : [];
  jbeRenderPhotoGrid();
  jbeRenderReceiptGrid();

  if (event && event.id) {
    const { data: invRows } = await _saaClient.from("invoices").select("*").eq("event_id", event.id).order("created_at", { ascending: false }).limit(1);
    _jbeCurrentInvoice = (invRows && invRows.length) ? invRows[0] : null;
    _jbeCurrentPayments = _jbeCurrentInvoice ? await saaJobsFetchPayments(_jbeCurrentInvoice.id) : [];
  } else {
    _jbeCurrentInvoice = null;
    _jbeCurrentPayments = [];
  }
  jbeRenderInvoiceBox(event, _jbeCurrentInvoice, _jbeCurrentPayments);

  _jbeInspectionResults = (event && Array.isArray(event.inspection_results)) ? event.inspection_results.slice() : [];
  jbeRenderInspectionSummary();

  jbeWireBomLink(event);

  document.getElementById("jb-event-modal").hidden = false;
}

function jbCloseEventModal() {
  document.getElementById("jb-event-modal").hidden = true;
  _jbEventModalTarget = null;
  _jbePendingQuote = null;
}

/** Round 42 Task 121-124: soft-deletes the open Event (marks it Cancelled
 *  via saaEventsUpdate, same status value SAA_EVENT_STATUS_OPTIONS already
 *  offers) rather than removing its row outright -- Events are otherwise
 *  treated as immutable history everywhere else in this app (Event
 *  History list, Mileage leg-chaining day-order, etc.), so a hard delete
 *  would leave holes in that chain. Flagged to Vijayan as the assumed
 *  behavior since his multiSelect answer on Checklist/Delete Event only
 *  picked the Checklist option. A brand-new, never-saved Event (no id yet)
 *  has nothing to delete -- just closes the modal. */
async function jbeDeleteCurrentEvent() {
  const event = _jbEventModalTarget;
  if (!event || !event.id) { jbCloseEventModal(); return; }
  const ok = await saaConfirm(
    `Delete event ${event.event_number || ""}? This marks it Cancelled in the Event History rather than erasing it -- its Mileage/Photos/Invoice records are kept. This can't easily be undone.`,
    { title: "Delete Event", okLabel: "Delete Event", cancelLabel: "Cancel" }
  );
  if (!ok) return;
  const res = await saaEventsUpdate(event.id, { event_status: "cancelled" });
  if (res.ok) {
    jbCloseEventModal();
    if (_jbCurrentJob) await jbRenderEventTimeline(_jbCurrentJob);
    _jbToast("Event deleted.");
  } else {
    document.getElementById("jb-event-status-msg").textContent = res.error;
  }
}

async function jbSaveEventModal() {
  if (!_jbCurrentJob) return;
  const btn = document.getElementById("jb-event-save-btn");
  const msg = document.getElementById("jb-event-status-msg");
  btn.disabled = true;

  const dateVal = document.getElementById("jbe-date").value;
  const timeVal = document.getElementById("jbe-time").value || "09:00";
  const scheduledStart = dateVal ? `${dateVal}T${timeVal}:00` : null;
  const eventType = document.getElementById("jbe-type").value;
  const eventStatus = document.getElementById("jbe-status").value;
  const technicianId = document.getElementById("jbe-tech").value || null;
  const technicianId2 = document.getElementById("jbe-tech2").value || null;
  const technicianId3 = document.getElementById("jbe-tech3").value || null;
  const priority = document.getElementById("jbe-priority").value;
  const serviceAddress = document.getElementById("jbe-address").value.trim() || null;
  const serviceCity = document.getElementById("jbe-city").value.trim() || null;
  const serviceState = document.getElementById("jbe-state").value.trim().toUpperCase() || null;
  const serviceZip = document.getElementById("jbe-zip").value.trim() || null;
  const reason = document.getElementById("jbe-reason").value.trim() || null;
  const description = document.getElementById("jbe-description").value.trim() || null;
  // Work-performed / notes / signature fields the modal also exposes --
  // real DB column names, since these only ever go through saaEventsUpdate
  // (directly on edit; as a same-turn follow-up patch on create, so
  // nothing typed into them is silently dropped either way).
  const detailFields = {
    technician_notes: document.getElementById("jbe-tech-notes").value.trim() || null,
    customer_notes: document.getElementById("jbe-cust-notes").value.trim() || null,
    work_performed: document.getElementById("jbe-work").value.trim() || null,
    parts_used: document.getElementById("jbe-parts").value.trim() || null,
    customer_signature_name: document.getElementById("jbe-sig-name").value.trim() || null,
    customer_signature_date: document.getElementById("jbe-sig-date").value || null,
    // Round 42 Task 121-124, per Vijayan: "Per-Event (separate costs per
    // visit)" -- Financials are plain columns on the events row, folded in
    // here alongside Notes/Signature since they're saved the exact same
    // way either way: immediately on an edit-mode saaEventsUpdate, or as
    // this same follow-up patch right after saaEventsCreateForJob below.
    quoted_amount: parseFloat(document.getElementById("jbe-quoted").value) || null,
    approved_amount: parseFloat(document.getElementById("jbe-approved").value) || null,
    actual_material_cost: parseFloat(document.getElementById("jbe-cost-material").value) || 0,
    actual_labor_cost: parseFloat(document.getElementById("jbe-cost-labor").value) || 0,
    other_cost: parseFloat(document.getElementById("jbe-cost-other").value) || 0,
  };

  let res;
  if (_jbEventModalMode === "edit" && _jbEventModalTarget) {
    res = await saaEventsUpdate(_jbEventModalTarget.id, Object.assign({}, detailFields, {
      event_type: eventType,
      event_status: eventStatus,
      scheduled_start: scheduledStart,
      scheduled_end: null,
      assigned_technician_id: technicianId,
      assigned_technician_id_2: technicianId2,
      assigned_technician_id_3: technicianId3,
      priority,
      service_address: serviceAddress,
      service_city: serviceCity,
      service_state: serviceState,
      service_zip: serviceZip,
      reason,
      description,
    }));
  } else {
    res = await saaEventsCreateForJob(_jbCurrentJob.id, {
      eventType, eventStatus, scheduledStart, scheduledEnd: null,
      technicianId, technicianId2, technicianId3, priority,
      serviceAddress, serviceCity, serviceState, serviceZip,
      reason, description,
    });
    if (res.ok) {
      // Nothing typed into the detail fields (Notes/Signature/Financials)
      // before saving a brand-new Event should be lost -- saaEventsCreateForJob's
      // own insert doesn't take these, so they're always applied as a
      // same-turn follow-up patch right after.
      await saaEventsUpdate(res.eventId, detailFields);
      // Round 42 Task 124: a Quote picked from the search box before this
      // Event had ever been saved (see jbeSearchCustomerQuotes) couldn't be
      // linked until just now, once the row actually exists.
      if (_jbePendingQuote) {
        const linkRes = await saaEventsLinkQuote(res.eventId, _jbePendingQuote.id);
        if (!linkRes.ok) _jbToast(linkRes.error, true);
        _jbePendingQuote = null;
      }
    }
  }

  // Completed Date/Time (Job Card parity, Round 42 Task 120): saaEventsUpdate
  // above only auto-stamps completed_at when event_status just CHANGED to
  // Completed. This covers the tech directly editing the Completed Date/Time
  // fields (correcting an auto-set or estimated value) -- only writes when
  // BOTH fields are present and at least one actually changed from what was
  // loaded, so an untouched (possibly estimated) value never overwrites a
  // precise auto-set timestamp on every ordinary Save.
  const eventIdForCompleted = res.ok ? (_jbEventModalTarget ? _jbEventModalTarget.id : res.eventId) : null;
  if (res.ok && eventIdForCompleted) {
    const completedDateVal = document.getElementById("jbe-completed-date").value;
    const completedTimeVal = document.getElementById("jbe-completed-time").value;
    const changed = completedDateVal !== _jbEventCompletedAtOpen.date || completedTimeVal !== _jbEventCompletedAtOpen.time;
    if (eventStatus === "completed" && completedDateVal && completedTimeVal && changed) {
      const ctRes = await saaEventsSetCompletedTime(eventIdForCompleted, completedDateVal, completedTimeVal);
      if (!ctRes.ok) _jbToast(ctRes.error, true);
    }
  }

  // Round 42 Task 124: Mileage -- only meaningful once the Event has a real
  // id (the primary/slot Mileage sections are locked until then, so there's
  // nothing typed here on a brand-new Event's first Save). Same "only
  // touch the row if the office actually typed something new" guard as the
  // Job Card's own jbSaveDetail, scoped to saaMileage*ForEvent instead of
  // *ForJob.
  const eventForMileage = _jbEventModalTarget;
  if (res.ok && eventForMileage && eventForMileage.id) {
    const mileageVal = document.getElementById("jbe-mileage-miles").value;
    if (mileageVal !== (_jbeMileageAtOpen.primary || "")) {
      const snap = _jbeMileageEventSnapshot();
      if (mileageVal.trim() === "") {
        await saaMileageDeleteForEvent(eventForMileage.id);
        _jbeMileageAtOpen.primary = "";
        document.getElementById("jbe-mileage-note").textContent = "";
      } else {
        const mRes = await saaMileageSetManualForEvent(snap, parseFloat(mileageVal));
        if (mRes.ok) {
          _jbeMileageAtOpen.primary = mileageVal;
          document.getElementById("jbe-mileage-note").textContent = "Entered manually.";
        } else {
          _jbToast(mRes.error, true);
        }
      }
    } else {
      saaMileageEnsureForEvent(_jbeMileageEventSnapshot());
    }
    for (const n of [2, 3]) {
      const techId = document.getElementById(`jbe-tech${n}`).value || null;
      if (!techId) continue;
      const milesEl = document.getElementById(`jbe-mileage${n}-miles`);
      const milesVal = milesEl.value;
      if (milesVal === (_jbeMileageAtOpen[n] || "")) continue;
      const snap = _jbeMileageEventSnapshot();
      if (milesVal.trim() === "") {
        await saaMileageDeleteForEvent(eventForMileage.id, techId);
        _jbeMileageAtOpen[n] = "";
        document.getElementById(`jbe-mileage${n}-note`).textContent = "";
      } else {
        const mRes = await saaMileageSetManualForEvent(snap, parseFloat(milesVal), techId);
        if (mRes.ok) {
          _jbeMileageAtOpen[n] = milesVal;
          document.getElementById(`jbe-mileage${n}-note`).textContent = "Entered manually.";
        } else {
          _jbToast(mRes.error, true);
        }
      }
    }
  }

  btn.disabled = false;
  if (res.ok) {
    msg.textContent = "";
    jbCloseEventModal();
    await jbRenderEventTimeline(_jbCurrentJob);
  } else {
    msg.textContent = res.error;
    msg.style.color = "#b3261e";
  }
}

async function jbOpenDetail(jobId) {
  const job = _jbAllJobs.find((j) => j.id === jobId);
  if (!job) return;
  clearTimeout(_jbAutosaveTimer); // cancel any pending autosave left over from whatever job was open before
  _jbCurrentJob = job;

  document.getElementById("jbd-title").textContent = job.title || saaJobTypeLabel(job.job_type);
  document.getElementById("jbd-jobnum").textContent = `${_jbJobNum(job)} · Received ${_jbFormatDate(job.created_at)}`;

  // Round 43 (2026-09-22): historical-Job banner. A converted Job's own
  // events.job_id gets re-pointed FORWARD onto the new current Job (so the
  // history-chain query keeps working from the current Job's side) --
  // which means the historical Job itself no longer "owns" any Event by
  // job_id. Its one link back to the history it's part of is
  // converted_to_event_id, captured at the moment of conversion.
  const historicalBanner = document.getElementById("jbd-historical-banner");
  if (job.is_current === false) {
    historicalBanner.hidden = false;
    document.getElementById("jbd-historical-event-num").textContent = "";
    const link = document.getElementById("jbd-historical-event-link");
    link.onclick = async (ev) => {
      ev.preventDefault();
      if (!job.converted_to_event_id) return;
      const linkedEvent = await saaEventsFetchById(job.converted_to_event_id);
      if (linkedEvent) jbOpenEventModal(linkedEvent);
    };
    if (job.converted_to_event_id) {
      saaEventsFetchById(job.converted_to_event_id).then((ev) => {
        if (ev) document.getElementById("jbd-historical-event-num").textContent = ev.event_number;
      });
    }
  } else {
    historicalBanner.hidden = true;
  }

  jbRenderCustomerBox(job);
  await jbRenderSystemSection(job);
  await jbRenderEventTimeline(job);

  document.getElementById("jbd-type").innerHTML = _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, job.job_type);
  document.getElementById("jbd-priority").innerHTML = _jbOptionsHtml(SAA_JOBS_PRIORITY_OPTIONS, job.priority);
  document.getElementById("jbd-status").innerHTML = _jbOptionsHtml(SAA_JOBS_STATUS_OPTIONS, job.status);
  document.getElementById("jbd-tech").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}"${t.id === job.assigned_technician_id ? " selected" : ""}>${t.name}</option>`).join("");
  // Round 25 (2026-09-14): optional Technician 2/3 -- same option list,
  // each pre-selected to whatever's on the job already.
  document.getElementById("jbd-tech2").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}"${t.id === job.assigned_technician_id_2 ? " selected" : ""}>${t.name}</option>`).join("");
  document.getElementById("jbd-tech3").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}"${t.id === job.assigned_technician_id_3 ? " selected" : ""}>${t.name}</option>`).join("");
  document.getElementById("jbd-mileage2-block").hidden = !job.assigned_technician_id_2;
  document.getElementById("jbd-mileage3-block").hidden = !job.assigned_technician_id_3;
  document.getElementById("jbd-scheduled").value = job.scheduled_date || "";
  document.getElementById("jbd-time").value = job.scheduled_time || "";
  document.getElementById("jbd-completed").value = job.completed_date || "";
  const _jbCompletedTime = await saaJobsGetCompletedTime(job);
  document.getElementById("jbd-completed-time").value = _jbCompletedTime.time;
  document.getElementById("jbd-completed-time-note").textContent = _jbCompletedTime.isEstimate ? "(estimated from schedule — confirm or edit)" : "";
  job._jbCompletedTimeAtOpen = _jbCompletedTime.time; // change-detection so Save doesn't re-stamp an unedited time
  document.getElementById("jbd-address").value = job.job_address || "";
  document.getElementById("jbd-city").value = job.job_city || "";
  document.getElementById("jbd-state").value = job.job_state || "TX";
  document.getElementById("jbd-zip").value = job.job_zip || "";

  document.getElementById("jbd-problem").value = job.problem_description || "";
  document.getElementById("jbd-findings").value = job.inspection_findings || "";
  document.getElementById("jbd-recommend").value = job.recommended_action || "";

  document.getElementById("jbd-quoted").value = job.quoted_amount || "";
  document.getElementById("jbd-approved").value = job.approved_amount || "";
  document.getElementById("jbd-cost-material").value = job.actual_material_cost || 0;
  document.getElementById("jbd-cost-labor").value = job.actual_labor_cost || 0;
  document.getElementById("jbd-cost-other").value = job.other_cost || 0;
  jbComputeProfit();
  ["jbd-quoted", "jbd-approved", "jbd-cost-material", "jbd-cost-labor", "jbd-cost-other"].forEach((id) => {
    document.getElementById(id).oninput = () => { jbComputeProfit(); jbScheduleAutosave(); };
  });

  document.getElementById("jbd-sig-name").value = job.customer_signature_name || "";
  document.getElementById("jbd-sig-date").value = job.customer_signature_date || "";
  document.getElementById("jbd-notes").value = job.notes || "";
  document.getElementById("jbd-status-msg").textContent = "";

  jbRenderQuoteSection(job);
  document.getElementById("jbd-quote-search").value = "";
  document.getElementById("jbd-quote-results").hidden = true;

  _jbEquipByType = job.customer_id ? await saaJobsFetchEquipmentByType(job.customer_id) : { condenser: null, coil: null, furnace: null };
  document.querySelectorAll(".jb-eq-block .jb-eq-fields").forEach((el) => { delete el.dataset.opened; });
  jbRenderAllEquipment();

  _jbCurrentInvoice = job.invoice || null;
  _jbCurrentPayments = job.invoice ? await saaJobsFetchPayments(job.invoice.id) : [];
  jbRenderInvoiceBox(job, _jbCurrentInvoice, _jbCurrentPayments);
  await jbRenderMileageSection(job);
  if (job.assigned_technician_id_2) await jbRenderMileageSlot(job, 2);
  if (job.assigned_technician_id_3) await jbRenderMileageSlot(job, 3);

  _jbPhotos = await saaPhotosFetch(job.id);
  jbRenderPhotoGrid();
  jbRenderReceiptGrid();
  _jbWarrantyFiles = await saaWarrantyFetch(job.id);
  jbRenderWarrantyList();
  _jbInspectionResults = Array.isArray(job.inspection_results) ? job.inspection_results.slice() : [];
  jbRenderInspectionSummary();

  jbWireBomLink(job);
  jbWireQuoteLink(job);

  document.getElementById("jb-detail-modal").hidden = false;
}

/** Round 26 (2026-09-14), per Vijayan: "Make data entry in job card as auto
 *  save instead of scrolling down and saving every time." jbScheduleAutosave
 *  (below) debounces a call to this same function -- it still does the
 *  exact full save (job fields, equipment, mileage, appointment sync) the
 *  "Save Job Card" button always has, just triggered automatically instead
 *  of by a click, so nothing about WHAT gets saved needed to change. Pass
 *  { silent: true } from the autosave path to skip the "Job Card saved."
 *  toast on every keystroke pause -- the inline status message next to the
 *  buttons still updates either way. Clearing the pending timer at the top
 *  means a manual Save click (or Close, which also calls this) can't be
 *  followed a moment later by a redundant autosave firing on top of it. */
async function jbSaveDetail(opts) {
  opts = opts || {};
  clearTimeout(_jbAutosaveTimer);
  const job = _jbCurrentJob;
  if (!job) return;
  const statusMsg = document.getElementById("jbd-status-msg");
  // Round 43: a historical Job (converted into an Event by a later visit)
  // is read-only -- it's a permanent snapshot of that visit's info, not
  // something still being worked. Block writes here rather than disabling
  // every individual field in the Job Card; the historical banner tells
  // the user why and links to the Event that now carries this history.
  if (job.is_current === false) {
    statusMsg.textContent = "This Job is historical (view its Event to make changes).";
    if (!opts.silent) _jbToast("This Job is historical and can't be edited. Open its linked Event instead.", true);
    return;
  }
  statusMsg.textContent = "Saving…";

  const patch = {
    job_type: document.getElementById("jbd-type").value,
    priority: document.getElementById("jbd-priority").value,
    status: document.getElementById("jbd-status").value,
    assigned_technician_id: document.getElementById("jbd-tech").value || null,
    // Round 25 (2026-09-14): optional 2nd/3rd technician.
    assigned_technician_id_2: document.getElementById("jbd-tech2").value || null,
    assigned_technician_id_3: document.getElementById("jbd-tech3").value || null,
    scheduled_date: document.getElementById("jbd-scheduled").value || null,
    scheduled_time: document.getElementById("jbd-time").value || null,
    completed_date: document.getElementById("jbd-completed").value || null,
    job_address: document.getElementById("jbd-address").value.trim() || null,
    job_city: document.getElementById("jbd-city").value.trim() || null,
    job_state: document.getElementById("jbd-state").value.trim().toUpperCase() || null,
    job_zip: document.getElementById("jbd-zip").value.trim() || null,
    problem_description: document.getElementById("jbd-problem").value.trim() || null,
    inspection_findings: document.getElementById("jbd-findings").value.trim() || null,
    recommended_action: document.getElementById("jbd-recommend").value.trim() || null,
    quoted_amount: parseFloat(document.getElementById("jbd-quoted").value) || null,
    approved_amount: parseFloat(document.getElementById("jbd-approved").value) || null,
    actual_material_cost: parseFloat(document.getElementById("jbd-cost-material").value) || 0,
    actual_labor_cost: parseFloat(document.getElementById("jbd-cost-labor").value) || 0,
    other_cost: parseFloat(document.getElementById("jbd-cost-other").value) || 0,
    customer_signature_name: document.getElementById("jbd-sig-name").value.trim() || null,
    customer_signature_date: document.getElementById("jbd-sig-date").value || null,
    notes: document.getElementById("jbd-notes").value.trim() || null,
  };

  const res = await saaJobsUpdateJob(job.id, patch);
  if (!res.ok) { statusMsg.textContent = res.error; return; }
  Object.assign(job, patch); // keep the open Job Card's in-memory copy in sync (e.g. so "Generate Invoice" right after Save sees the just-saved Approved Amount)

  // Completed Time (Round 6 item 6): saaJobsUpdateJob above only stamps
  // status_history.completed automatically when Status just CHANGED to
  // Completed. This covers the other case — the tech directly editing the
  // Completed Time field (correcting an auto-set or estimated time) without
  // touching Status — by only writing when the field actually changed from
  // what was loaded, so an untouched field never overwrites a precise
  // auto-set timestamp with a rounded HH:MM on every ordinary Save.
  const completedTimeVal = document.getElementById("jbd-completed-time").value;
  if (patch.status === "completed" && completedTimeVal && completedTimeVal !== job._jbCompletedTimeAtOpen) {
    const ctRes = await saaJobsSetCompletedTime(job.id, completedTimeVal);
    if (ctRes.ok) {
      job._jbCompletedTimeAtOpen = completedTimeVal;
      document.getElementById("jbd-completed-time-note").textContent = "";
    } else {
      _jbToast(ctRes.error, true);
    }
  }

  // Push Scheduled Date/Time/Technician onto the job's calendar appointment —
  // this is what makes saving here place (or move) it on the Dispatch Calendar grid.
  await saaJobsSyncAppointmentSchedule(job.id, {
    technicianId: patch.assigned_technician_id,
    technicianId2: patch.assigned_technician_id_2,
    technicianId3: patch.assigned_technician_id_3,
    scheduledDate: patch.scheduled_date,
    scheduledTime: patch.scheduled_time,
    jobType: patch.job_type,
  });

  // Save each unlocked equipment type's fields; a locked type is left
  // untouched so it can't be overwritten by accident.
  for (const [type] of SAA_EQUIPMENT_TYPES) {
    const existingRow = _jbEquipByType[type];
    if (existingRow && existingRow.locked) continue;
    const block = document.querySelector(`.jb-eq-block[data-eqtype="${type}"]`);
    const brand = block.querySelector(".jb-eq-brand").value.trim();
    const model = block.querySelector(".jb-eq-model").value.trim();
    const serial = block.querySelector(".jb-eq-serial").value.trim();
    const refrigerant = block.querySelector(".jb-eq-refrigerant").value.trim();
    const tonnage = block.querySelector(".jb-eq-tonnage").value.trim();
    const installYear = block.querySelector(".jb-eq-installyear").value.trim();
    const warranty = block.querySelector(".jb-eq-warranty").value;
    if (!existingRow && !brand && !model && !serial && !refrigerant && !tonnage && !installYear) continue; // nothing entered — don't create an empty row
    await saaJobsSaveEquipmentByType(job.customer_id, type, {
      brand, model, serialNumber: serial, refrigerantType: refrigerant,
      tonnage: tonnage || null, installYear: installYear || null, warrantyStatus: warranty,
    });
  }
  _jbEquipByType = await saaJobsFetchEquipmentByType(job.customer_id);
  jbRenderAllEquipment();

  // Refresh the Invoice & Payment box so its "Use Quoted/Actual Amount"
  // buttons and the vs-Quote flag pick up the Quoted/Approved/Actual Cost
  // values just saved above, instead of staying stuck at whatever they
  // were when the Job Card was first opened (round 7 follow-up,
  // 2026-09-13).
  if (_jbCurrentInvoice) jbRenderInvoiceBox(job, _jbCurrentInvoice, _jbCurrentPayments);

  // Mileage: only touch the row if the office actually typed something new
  // into Miles Driven — an untouched field (whether it came from an "auto"
  // calculation or was left blank) shouldn't be overwritten or stamped
  // 'manual' on every ordinary Save. Clearing a previously-set value
  // deletes the leg instead of writing a null.
  const mileageVal = document.getElementById("jbd-mileage-miles").value;
  if (mileageVal !== (job._jbMileageMilesAtOpen || "")) {
    const snap = _jbMileageSnapshot();
    if (mileageVal.trim() === "") {
      await saaMileageDeleteForJob(job.id);
      job._jbMileageMilesAtOpen = "";
      document.getElementById("jbd-mileage-note").textContent = "";
    } else {
      const mRes = await saaMileageSetManualForJob(snap, parseFloat(mileageVal));
      if (mRes.ok) {
        job._jbMileageMilesAtOpen = mileageVal;
        document.getElementById("jbd-mileage-note").textContent = "Entered manually.";
      } else {
        _jbToast(mRes.error, true);
      }
    }
  } else {
    // Round 11 follow-up (2026-09-13): "save miles for every job" -- Miles
    // Driven wasn't touched on this save (still blank, or still whatever it
    // was when the card opened), so make sure this job has an up-to-date
    // AUTO leg on file if it now has enough info for one -- e.g. a
    // technician/date/address just entered above, or a schedule change
    // saved elsewhere. Never overwrites a manually-set leg (same guard
    // "Calculate Miles" uses) and runs in the background so it can't slow
    // down Save Job Card; if the card is reopened before it finishes, the
    // number just shows up next time.
    saaMileageEnsureForJob(_jbMileageSnapshot());
  }

  // Technician 2/3 mileage (Round 25, 2026-09-14): opt-in only -- unlike
  // the primary leg above, an untouched/blank field here never triggers a
  // background auto-calculation (there's no saaMileageEnsureForJob-style
  // "else" branch), since these only exist for a technician who drove
  // separately and someone explicitly said so.
  for (const n of [2, 3]) {
    const techId = document.getElementById(`jbd-tech${n}`).value || null;
    if (!techId) continue;
    const milesEl = document.getElementById(`jbd-mileage${n}-miles`);
    const milesVal = milesEl.value;
    if (milesVal === (job[`_jbMileage${n}MilesAtOpen`] || "")) continue;
    const snap = _jbMileageSnapshot();
    if (milesVal.trim() === "") {
      await saaMileageDeleteForJob(job.id, techId);
      job[`_jbMileage${n}MilesAtOpen`] = "";
      document.getElementById(`jbd-mileage${n}-note`).textContent = "";
    } else {
      const mRes = await saaMileageSetManualForJob(snap, parseFloat(milesVal), techId);
      if (mRes.ok) {
        job[`_jbMileage${n}MilesAtOpen`] = milesVal;
        document.getElementById(`jbd-mileage${n}-note`).textContent = "Entered manually.";
      } else {
        _jbToast(mRes.error, true);
      }
    }
  }

  statusMsg.textContent = "Saved.";
  await jbLoadAll();
  if (!opts.silent) _jbToast("Job Card saved.");
}

/** Debounces a background jbSaveDetail() call so editing any tracked field
 *  in the open Job Card saves it ~1.2s after the tech/office stops typing
 *  or changes a dropdown/date -- no more scrolling down to "Save Job Card"
 *  after every field. Guarded on the modal actually being open so a timer
 *  can't outlive it (jbCloseDetail flushes with a real save first anyway,
 *  and jbSaveDetail clears any pending timer the instant it runs). */
function jbScheduleAutosave() {
  const modal = document.getElementById("jb-detail-modal");
  if (!_jbCurrentJob || !modal || modal.hidden) return;
  clearTimeout(_jbAutosaveTimer);
  const statusMsg = document.getElementById("jbd-status-msg");
  // Round 43: don't even show "Unsaved changes…" (let alone schedule a
  // save) on a historical Job -- jbSaveDetail would just reject it anyway,
  // but staying silent here avoids a misleading autosave countdown on a
  // card that's read-only.
  if (_jbCurrentJob.is_current === false) {
    if (statusMsg) statusMsg.textContent = "This Job is historical (view its Event to make changes).";
    return;
  }
  if (statusMsg) statusMsg.textContent = "Unsaved changes…";
  _jbAutosaveTimer = setTimeout(() => { jbSaveDetail({ silent: true }); }, 1200);
}

/** Round 43 (2026-09-22): replaces the retired "+ Schedule Follow-Up" /
 *  "+ Schedule New Event" buttons on the Job Card's Event History section.
 *  Per the new business rule there's only ever ONE current Job per
 *  Customer + System -- a follow-up visit is always a brand-new Job, which
 *  atomically converts this still-open one into a historical Event
 *  (saaJobsCreateForExistingSystem / saa_create_job_with_conversion), not
 *  a second Event bolted onto this same Job.
 *
 *  This is a one-click flow rather than reopening a full "+ New Job" form:
 *  the Customer + System are already fixed (this IS that Customer's
 *  System), so there's nothing to pick -- just confirm the conversion,
 *  carry over the sensible defaults (address, technician, priority, job
 *  type) from the job being closed out, and land straight in the new
 *  current Job's own card so the office can adjust anything that changed
 *  (new problem description, different date, etc). Deliberately doesn't
 *  reuse jobs.html's jb-new-modal/jbSaveNewJob, since that modal only
 *  exists in the DOM on the standalone Jobs List page -- the Job Card
 *  itself is embedded on several other pages (Calendar, and per the
 *  spec eventually Customer/System/Employee dashboard too) where that
 *  modal's markup isn't present. */
async function jbStartNextJob() {
  const job = _jbCurrentJob;
  if (!job || job.is_current === false) return; // buttons are hidden in this case; belt-and-suspenders
  const statusMsg = document.getElementById("jbd-status-msg");
  if (!job.system_id) {
    _jbToast("This job has no System on file yet -- add one (System section above) before starting the next job.", true);
    return;
  }
  const proceed = await saaConfirm(
    `Starting a new Job for this Customer + System will convert the current Job (${job.job_number || ""}) into a historical Event, and its full record (financials, photos, invoice, notes, etc.) is carried over. Continue?`,
    { title: "Start Next Job", okLabel: "Create New Job & Convert Previous Job", cancelLabel: "Cancel" }
  );
  if (!proceed) return;

  if (statusMsg) statusMsg.textContent = "Creating next job…";
  const res = await saaJobsCreateForExistingSystem(job.customer_id, job.system_id, {
    jobType: job.job_type, status: "new", title: job.title || "", priority: job.priority || "normal",
    jobAddress: job.job_address || null, jobCity: job.job_city || null, jobState: job.job_state || "TX", jobZip: job.job_zip || null,
    technicianId: job.assigned_technician_id || null, technicianId2: job.assigned_technician_id_2 || null, technicianId3: job.assigned_technician_id_3 || null,
    customerFirstName: job.customer ? job.customer.first_name : undefined,
  });
  if (!res.ok) {
    if (statusMsg) statusMsg.textContent = res.error;
    _jbToast(res.error, true);
    return;
  }
  _jbToast(res.convertedFromJobNumber ? `New Job created -- ${res.convertedFromJobNumber} is now a historical Event.` : "New Job created.");
  await jbLoadAll();
  await jbOpenDetail(res.jobId);
  if (typeof saaCalLoadAndRender === "function") await saaCalLoadAndRender(); // Job Card can be an overlay on the Calendar (Round 6 item 7) -- refresh the grid behind it
}

/** Save-and-exit: used by the Close (X) button, the Close button, and a
 *  click on the modal backdrop outside the card — so however the office
 *  leaves the Job Card, whatever they typed is kept. */
async function jbCloseDetail() {
  const modal = document.getElementById("jb-detail-modal");
  if (modal.hidden) return;
  if (_jbCurrentJob) await jbSaveDetail();
  modal.hidden = true;
  // Round 6 item 7: when the Job Card is an overlay on top of the Dispatch
  // Calendar, refresh the calendar grid behind it so a status/schedule
  // change just saved shows up immediately without the tech having to
  // reload. saaCalLoadAndRender only exists on calendar.html.
  if (typeof saaCalLoadAndRender === "function") await saaCalLoadAndRender();
}

/** Removes a job that turned out to be a duplicate (or was created in
 *  error) — deletes its appointment, photos, invoice/payments, and clears
 *  the job_id back-link on any quote that had been converted into it. */
async function jbDeleteCurrentJob() {
  if (!_jbCurrentJob) return;
  const ok = await saaConfirm(`Delete job ${_jbCurrentJob.job_number || ""} for ${_jbCurrentJob.customer ? _jbCustName(_jbCurrentJob.customer) : "this customer"}? This can't be undone.`, { title: "Delete job", okLabel: "Delete", cancelLabel: "Cancel" });
  if (!ok) return;
  const jobToDelete = _jbCurrentJob;
  const res = await saaJobsDeleteJob(jobToDelete.id);
  if (!res.ok) { document.getElementById("jbd-status-msg").textContent = "Error: " + res.error; return; }
  _jbCurrentJob = null;
  document.getElementById("jb-detail-modal").hidden = true;
  _jbToast("Job deleted.");
  await jbLoadAll();
  if (typeof saaCalLoadAndRender === "function") await saaCalLoadAndRender();
}

/* ============================== Wire up on load ============================== */

document.addEventListener("DOMContentLoaded", async () => {
  _jbTechnicians = await saaJobsFetchTechnicians();

  // Round 6 item 7: the Job Card (everything below this point) is now also
  // embedded on the Dispatch Calendar page so "View Full Job Record" can
  // open it as an overlay without navigating away — see calendar.js's
  // drawer-jobrecord-link handler. Only jobs.html has the Jobs List table
  // and the New Job popup, so that wiring is skipped everywhere else.
  const _jbIsFullPage = !!document.getElementById("jb-new-btn");
  if (_jbIsFullPage) {
    document.getElementById("jb-filter-type").innerHTML = `<option value="">All Job Types</option>` + _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, "");
    document.getElementById("jb-filter-status").innerHTML = `<option value="">All Statuses</option>` + _jbOptionsHtml(SAA_JOBS_STATUS_OPTIONS, "");
    document.getElementById("jb-filter-priority").innerHTML = `<option value="">All Priorities</option>` + _jbOptionsHtml(SAA_JOBS_PRIORITY_OPTIONS, "");
    document.getElementById("jb-filter-tech").innerHTML = `<option value="">All Technicians</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    document.getElementById("jbn-type").innerHTML = _jbOptionsHtml(SAA_JOBS_TYPE_OPTIONS, "");
    document.getElementById("jbn-tech").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    document.getElementById("jbn-tech2").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");
    document.getElementById("jbn-tech3").innerHTML = `<option value="">None</option>` + _jbTechnicians.map((t) => `<option value="${t.id}">${t.name}</option>`).join("");

    const _jbFilterIds = ["jb-search"].concat(_JB_COLUMNS.map((c) => c.filterId));
    _jbFilterIds.forEach((id) => {
      document.getElementById(id).addEventListener("input", jbRenderTable);
      document.getElementById(id).addEventListener("change", jbRenderTable);
    });
    // Round 43 (2026-09-22): Current/Historical/All filter -- standalone,
    // not part of _jbFilterIds/_JB_COLUMNS (see jbApplyFilters), defaults
    // to "Current Jobs" per spec item 23.
    const jbFilterCurrent = document.getElementById("jb-filter-current");
    if (jbFilterCurrent) jbFilterCurrent.addEventListener("change", jbRenderTable);

    document.querySelectorAll(".jb-sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        _jbSort = (_jbSort.key === key) ? { key, dir: -_jbSort.dir } : { key, dir: 1 };
        jbRenderTable();
      });
    });

    document.getElementById("jb-clear-filters-btn").addEventListener("click", () => {
      _jbFilterIds.forEach((id) => { document.getElementById(id).value = ""; });
      if (jbFilterCurrent) jbFilterCurrent.value = "current"; // "Clear Filters" restores the default view, not an unfiltered one -- same idea _JB_DEFAULT_SORT already follows below
      _jbSort = Object.assign({}, _JB_DEFAULT_SORT);
      jbRenderTable();
    });

    // Round 45 (2026-09-22): the old single Download button is now a
    // toggle for a 3-item menu (All / Jobs / Events) -- see
    // _jbToggleDownloadMenu and the jbDownload*Csv functions above.
    const jbDownloadBtn = document.getElementById("jb-download-btn");
    const jbDownloadWrap = document.getElementById("jb-download-wrap");
    if (jbDownloadBtn) {
      jbDownloadBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        _jbToggleDownloadMenu();
      });
      document.getElementById("jb-download-all-btn").addEventListener("click", () => { _jbToggleDownloadMenu(false); jbDownloadAllCsv(); });
      document.getElementById("jb-download-jobs-btn").addEventListener("click", () => { _jbToggleDownloadMenu(false); jbDownloadJobsCsv(); });
      document.getElementById("jb-download-events-btn").addEventListener("click", () => { _jbToggleDownloadMenu(false); jbDownloadEventsCsv(); });
      document.addEventListener("click", (e) => {
        if (jbDownloadWrap && !jbDownloadWrap.contains(e.target)) _jbToggleDownloadMenu(false);
      });
    }

    document.getElementById("jb-new-btn").addEventListener("click", jbOpenNewJobModal);
    document.getElementById("jbn-cancel-btn").addEventListener("click", () => { document.getElementById("jb-new-modal").hidden = true; });
    document.getElementById("jbn-save-btn").addEventListener("click", jbSaveNewJob);
    document.getElementById("jbn-newcust-use-btn").addEventListener("click", jbUseNewCustomer);
    document.getElementById("jbn-newcust-cancel-btn").addEventListener("click", () => {
      document.getElementById("jbn-newcust-form").hidden = true;
      document.getElementById("jbn-cust-results").hidden = false;
    });
    document.getElementById("jbn-cust-search").addEventListener("input", async (e) => {
      const q = e.target.value;
      if (!q.trim()) { document.getElementById("jbn-cust-results").hidden = true; return; }
      const results = await saaJobsSearchCustomers(q);
      jbRenderCustResults(results, q);
    });
    document.getElementById("jbn-from-quote-btn").addEventListener("click", () => {
      const wrap = document.getElementById("jbn-quote-search-wrap");
      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) document.getElementById("jbn-quote-search").focus();
    });
    document.getElementById("jbn-quote-search").addEventListener("input", (e) => {
      clearTimeout(_jbQuoteSearchTimer);
      const q = e.target.value;
      if (!q.trim()) { document.getElementById("jbn-quote-results").hidden = true; return; }
      _jbQuoteSearchTimer = setTimeout(async () => {
        const results = await saaJobsSearchQuotes(q);
        jbRenderQuoteResults(results, q);
      }, 200);
    });
  }

  // ---- Job Card wiring — present on both jobs.html and calendar.html ----
  document.getElementById("jbd-quote-search").addEventListener("input", (e) => {
    if (_jbCurrentJob) jbSearchCustomerQuotes(_jbCurrentJob, e.target.value);
  });
  // Round 6 follow-up: show this customer's saved quotes (up to 5, newest
  // first) the moment the field is focused, not only once something is
  // typed -- most of the time the office just wants to pick from a short
  // recent list rather than search by quote number/type.
  document.getElementById("jbd-quote-search").addEventListener("focus", (e) => {
    if (_jbCurrentJob && !e.target.value.trim()) jbSearchCustomerQuotes(_jbCurrentJob, "");
  });
  document.getElementById("jbd-save-btn").addEventListener("click", jbSaveDetail);
  document.getElementById("jbd-close-btn").addEventListener("click", jbCloseDetail);
  document.getElementById("jbd-delete-btn").addEventListener("click", jbDeleteCurrentJob);
  document.getElementById("jb-detail-close-btn").addEventListener("click", jbCloseDetail);

  // Round 26 (2026-09-14) autosave wiring -- every field jbSaveDetail's
  // patch actually reads (the Quoted/Approved/Cost fields are wired
  // separately above, alongside jbComputeProfit) plus every Equipment
  // field. These elements are static (present once in the page's HTML,
  // never recreated), so this is wired ONCE here rather than re-wired on
  // every jbOpenDetail -- jbScheduleAutosave itself doesn't care which job
  // is open, it just re-reads _jbCurrentJob when its debounce timer fires.
  // Deliberately excluded: Customer name/phone (own Save button, separate
  // customers-table save), the Quote search box (wired above), and
  // Invoice/Payment (their own Update Invoice/Record Payment buttons) --
  // none of those fields are part of jbSaveDetail's patch anyway.
  [
    "jbd-type", "jbd-priority", "jbd-status", "jbd-tech", "jbd-scheduled", "jbd-time",
    "jbd-completed", "jbd-completed-time", "jbd-address", "jbd-city", "jbd-state", "jbd-zip",
    "jbd-problem", "jbd-findings", "jbd-recommend", "jbd-sig-name", "jbd-sig-date", "jbd-notes",
    "jbd-mileage-miles",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", jbScheduleAutosave);
    el.addEventListener("change", jbScheduleAutosave);
  });
  document.querySelectorAll(".jb-eq-fields input, .jb-eq-fields select").forEach((el) => {
    el.addEventListener("input", jbScheduleAutosave);
    el.addEventListener("change", jbScheduleAutosave);
  });

  // Same duplicate-technician guard as the tech2/3 handler below, for the
  // primary Technician select.
  document.getElementById("jbd-tech").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val) {
      const others = [document.getElementById("jbd-tech2").value, document.getElementById("jbd-tech3").value];
      if (others.includes(val)) {
        _jbToast("That technician is already assigned to this job in another slot.", true);
        e.target.value = "";
      }
    }
  });

  // Round 25 (2026-09-14) Technician 2/3 wiring: picking a technician here
  // shows/loads that slot's own opt-in Mileage block; a slot left blank
  // hides it again (the saved mileage row, if any, is left alone -- only
  // clearing Miles Driven itself and saving deletes it). Also guards
  // against assigning the SAME technician to more than one slot on one
  // job, which wouldn't make sense on the calendar (one person can't have
  // two tracks for one appointment).
  [2, 3].forEach((n) => {
    document.getElementById(`jbd-tech${n}`).addEventListener("change", async (e) => {
      const val = e.target.value;
      if (val) {
        const others = [document.getElementById("jbd-tech").value, document.getElementById("jbd-tech2").value, document.getElementById("jbd-tech3").value]
          .filter((v, i) => v && i !== (n - 1));
        if (others.includes(val)) {
          _jbToast("That technician is already assigned to this job in another slot.", true);
          e.target.value = "";
          document.getElementById(`jbd-mileage${n}-block`).hidden = true;
          return;
        }
      }
      if (_jbCurrentJob) await jbRenderMileageSlot(_jbCurrentJob, n);
      jbScheduleAutosave();
    });
  });
  document.getElementById("jbd-mileage2-calc-btn").addEventListener("click", () => jbCalculateMileageSlot(2));
  document.getElementById("jbd-mileage3-calc-btn").addEventListener("click", () => jbCalculateMileageSlot(3));
  document.getElementById("jb-detail-modal").addEventListener("click", (e) => {
    if (e.target.id === "jb-detail-modal") jbCloseDetail(); // clicked the backdrop, not the card
  });
  jbWireEquipmentBlocks();

  document.getElementById("jbd-add-photos-btn").addEventListener("click", jbAddPhotos);
  document.getElementById("jbd-add-receipt-btn").addEventListener("click", jbAddReceipt);
  document.getElementById("jbd-open-inspection-btn").addEventListener("click", jbOpenInspectionModal);
  document.getElementById("jbd-warranty-input").addEventListener("change", (e) => {
    jbAddWarrantyFiles(e.target.files);
    e.target.value = ""; // allow re-selecting the same filename later
  });
  document.getElementById("jbd-mileage-calc-btn").addEventListener("click", jbCalculateMileage);
  document.getElementById("jbd-return-mileage-calc-btn").addEventListener("click", jbCalculateReturnMileage);
  // Recompute the "Trip: ..." context line (not the miles themselves) the
  // moment technician/date/address fields change, so it never shows a
  // stale route while the office is still filling out the card.
  ["jbd-tech", "jbd-scheduled", "jbd-address", "jbd-city", "jbd-state", "jbd-zip"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      if (_jbCurrentJob) _jbUpdateMileageContext();
    });
  });
  // Job Card quick-access row (Round 6 item 4) — same three actions as the
  // buttons already inside the card, just reachable without scrolling.
  document.getElementById("jbd-quick-checklist-btn").addEventListener("click", jbOpenInspectionModal);
  document.getElementById("jbd-quick-receipt-btn").addEventListener("click", jbAddReceipt);
  document.getElementById("jbd-quick-invoice-btn").addEventListener("click", jbQuickInvoice);
  document.getElementById("jb-insp-save-btn").addEventListener("click", jbSaveInspection);
  document.getElementById("jb-insp-close-btn").addEventListener("click", () => { document.getElementById("jb-inspection-modal").hidden = true; });

  // Round 42 (2026-09-19): System section + Event History timeline wiring.
  document.getElementById("jbd-sys-save-btn").addEventListener("click", jbSaveSystem);
  // Round 43: both buttons now drive the same "Start Next Job" flow (see
  // jbStartNextJob) -- the old "add a 2nd/3rd Event under this same still-
  // open Job" behavior is retired now that a Job is a single visit.
  document.getElementById("jbd-schedule-followup-btn").addEventListener("click", jbStartNextJob);
  document.getElementById("jbd-schedule-event-btn").addEventListener("click", jbStartNextJob);
  document.getElementById("jb-event-save-btn").addEventListener("click", jbSaveEventModal);
  document.getElementById("jb-event-close-btn").addEventListener("click", jbCloseEventModal);
  document.getElementById("jb-event-modal").addEventListener("click", (e) => {
    if (e.target.id === "jb-event-modal") jbCloseEventModal(); // clicked the backdrop, not the card
  });

  // Round 42 Task 120: same duplicate-technician guard as the Job Card's
  // own jbd-tech/jbd-tech2/jbd-tech3 wiring above -- one technician can't
  // hold two slots on the same Event any more than on the same Job.
  document.getElementById("jbe-tech").addEventListener("change", (e) => {
    const val = e.target.value;
    if (val) {
      const others = [document.getElementById("jbe-tech2").value, document.getElementById("jbe-tech3").value];
      if (others.includes(val)) {
        _jbToast("That technician is already assigned to this event in another slot.", true);
        e.target.value = "";
      }
    }
  });
  [2, 3].forEach((n) => {
    document.getElementById(`jbe-tech${n}`).addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) {
        const others = [document.getElementById("jbe-tech").value, document.getElementById("jbe-tech2").value, document.getElementById("jbe-tech3").value]
          .filter((v, i) => v && i !== (n - 1));
        if (others.includes(val)) {
          _jbToast("That technician is already assigned to this event in another slot.", true);
          e.target.value = "";
        }
      }
      // Round 42 Task 124: same show/hide/load-that-slot's-own-mileage
      // behavior as the Job Card's jbd-tech2/3 wiring above.
      jbeRenderMileageSlot(n);
    });
  });

  // Round 42 Task 122-124: full-parity Event modal sections (Quote/
  // Financials/Mileage/Photos/Receipts/Invoice & Payment/Inspection/BOM).
  document.getElementById("jbe-quote-search").addEventListener("input", (e) => jbeSearchCustomerQuotes(e.target.value));
  document.getElementById("jbe-quote-search").addEventListener("focus", (e) => {
    if (!e.target.value.trim()) jbeSearchCustomerQuotes("");
  });
  ["jbe-quoted", "jbe-approved", "jbe-cost-material", "jbe-cost-labor", "jbe-cost-other"].forEach((id) => {
    document.getElementById(id).addEventListener("input", jbeComputeProfit);
  });
  document.getElementById("jbe-mileage-calc-btn").addEventListener("click", jbeCalculateMileage);
  document.getElementById("jbe-return-mileage-calc-btn").addEventListener("click", jbeCalculateReturnMileage);
  document.getElementById("jbe-mileage2-calc-btn").addEventListener("click", () => jbeCalculateMileageSlot(2));
  document.getElementById("jbe-mileage3-calc-btn").addEventListener("click", () => jbeCalculateMileageSlot(3));
  // Recompute the Event modal's own "Trip: ..." context line the moment
  // technician/date/address fields change, same as the Job Card's own
  // jbd-tech/jbd-scheduled/etc. wiring does for _jbUpdateMileageContext.
  ["jbe-tech", "jbe-date", "jbe-address", "jbe-city", "jbe-state", "jbe-zip"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      if (_jbEventModalTarget && _jbEventModalTarget.id) jbeRenderMileageSection();
    });
  });
  document.getElementById("jbe-add-photos-btn").addEventListener("click", jbeAddPhotos);
  document.getElementById("jbe-add-receipt-btn").addEventListener("click", jbeAddReceipt);
  document.getElementById("jbe-open-inspection-btn").addEventListener("click", jbeOpenInspectionModal);
  document.getElementById("jbe-bom-btn").addEventListener("click", (e) => {
    if (!_jbEventModalTarget || !_jbEventModalTarget.id) {
      e.preventDefault();
      _jbToast("Save this Event first, then open its Bill of Material.", true);
    }
  });
  document.getElementById("jb-event-delete-btn").addEventListener("click", jbeDeleteCurrentEvent);

  if (_jbIsFullPage) {
    // Legacy deep link, kept for any bookmarked/saved jobs.html?job=<id>
    // link — Round 6 item 7 replaced the calendar's own link to this with
    // an in-place overlay (see calendar.js), so this path is no longer how
    // the calendar gets here, but an old link should still work.
    await jbLoadAll();
    const params = new URLSearchParams(window.location.search);
    const openId = params.get("job");
    // Round 44: an optional &event=<id> alongside ?job=<id> jumps straight
    // to that Event's own modal once the Job Card is open -- same deep-link
    // shape the Jobs List's own expand-row uses internally (jbOpenEventDirect),
    // just reachable from a URL too (e.g. pasted from elsewhere in the app).
    const openEventId = params.get("event");
    if (openId && _jbAllJobs.some((j) => j.id === openId)) {
      if (openEventId) jbOpenEventDirect(openId, openEventId);
      else jbOpenDetail(openId);
    }
  }
});
