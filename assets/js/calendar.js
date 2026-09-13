/* ============================================================
   SAA Comfort Air LLC — Dispatch Calendar
   The operational center: technician rows, drag-and-drop
   rescheduling (time / technician / both in one move, plus
   dragging an appointment's right edge to change its end time),
   Day/Week/Month views, the New Service popup with fast customer
   search, an Unscheduled Jobs queue, a Job Details drawer, and
   one-click follow-up scheduling. See calendar-db.js for all
   Supabase access.

   Day view is the only one with technician tracks and drag-and-
   drop (that's where minute-level dispatch precision matters);
   Week and Month are agenda-style overviews for seeing the spread
   of work at a glance — clicking a day in either jumps to Day view
   for that date. Filters and recurring-maintenance suggestions are
   still out of scope for this pass.
   ============================================================ */

const SAA_CAL_DAY_START_HOUR = 7;
const SAA_CAL_DAY_END_HOUR = 19; // exclusive
const SAA_CAL_SLOT_MINUTES = 30;
const SAA_CAL_TOTAL_MINUTES = (SAA_CAL_DAY_END_HOUR - SAA_CAL_DAY_START_HOUR) * 60;

const SAA_CAL_FOLLOWUP_TYPES = [
  ["call", "Call customer"],
  ["return_visit", "Return visit"],
  ["check_repair", "Check repair"],
  ["maintenance_reminder", "Maintenance reminder"],
  ["estimate_follow_up", "Estimate follow-up"],
];

let saaCalCurrentDate = "";
let saaCalViewMode = "day"; // "day" | "week" | "month"
let saaCalTechnicians = [];
let saaCalAppointmentTypes = [];
let saaCalTypesByKey = {};
let saaCalScheduled = [];
let saaCalUnscheduled = [];
let saaCalSelectedTypeKey = null;
let saaCalSelectedCustomer = null;
let saaCalDrawerAppt = null;
let saaCalDragPayload = null;
let saaCalToastTimer = null;
let saaCalSearchTimer = null;

function _saaCalEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _saaCalDateObjToStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function saaCalTodayStr() { return _saaCalDateObjToStr(new Date()); }

/* ---- naive wall-clock time strings — see calendar-db.js header note.
   We never round-trip through `new Date(x).toISOString()` for a stored
   value: we build "<date>T<HH>:<MM>:00" ourselves and read the HH:MM
   back out with a regex, so what the dispatcher picks is exactly what
   redisplays, with no timezone-conversion surprises. ---- */
function saaCalTimeStr(dateStr, minutesFromMidnight) {
  const hh = String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0");
  const mm = String(minutesFromMidnight % 60).padStart(2, "0");
  return `${dateStr}T${hh}:${mm}:00`;
}
function saaCalMinutesFromTimeStr(s) {
  const m = String(s || "").match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function saaCalFormatClock(minutes) {
  if (minutes == null) return "";
  let h = Math.floor(minutes / 60), mm = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ampm}`;
}
function saaCalFormatClock24(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function saaCalFormatDateLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}
function saaCalFormatShortDate(dateStr) {
  if (!dateStr) return "";
  const datePart = String(dateStr).slice(0, 10);
  const d = new Date(datePart + "T12:00:00");
  if (isNaN(d.getTime())) return datePart;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function saaCalPct(minutes) {
  return Math.max(0, Math.min(100, ((minutes - SAA_CAL_DAY_START_HOUR * 60) / SAA_CAL_TOTAL_MINUTES) * 100));
}

function saaCalShowToast(msg) {
  const el = document.getElementById("cal-toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(saaCalToastTimer);
  saaCalToastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function saaCalCustName(customer) {
  return [customer && customer.first_name, customer && customer.last_name].filter(Boolean).join(" ") || "Unknown";
}

/* ============================== INIT ============================== */

async function saaCalInit() {
  saaCalCurrentDate = saaCalTodayStr();
  document.getElementById("cal-date-input").value = saaCalCurrentDate;
  saaCalUpdateDateLabel();

  saaCalTechnicians = await saaCalFetchTechnicians();
  saaCalAppointmentTypes = await saaCalFetchAppointmentTypes();
  saaCalTypesByKey = Object.fromEntries(saaCalAppointmentTypes.map((t) => [t.key, t]));

  const fuAssign = document.getElementById("fu-assign");
  fuAssign.innerHTML = '<option value="Office">Office</option>' + saaCalTechnicians.map((t) => `<option value="${_saaCalEsc(t.name)}">${_saaCalEsc(t.name)}</option>`).join("");

  const row = document.getElementById("cal-followup-type-row");
  row.innerHTML = SAA_CAL_FOLLOWUP_TYPES.map(([k, l], i) => `<label><input type="radio" name="fu-type" value="${k}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("");

  saaCalWireStaticHandlers();
  await saaCalLoadAndRender();
}

function saaCalSetDate(dateStr) {
  saaCalCurrentDate = dateStr;
  document.getElementById("cal-date-input").value = dateStr;
  saaCalUpdateDateLabel();
  saaCalLoadAndRender();
}
function saaCalShiftDate(deltaDays) {
  const d = new Date(saaCalCurrentDate + "T12:00:00");
  d.setDate(d.getDate() + deltaDays);
  saaCalSetDate(_saaCalDateObjToStr(d));
}

/** Prev/Next button behavior depends on which view is showing: a day at
 *  a time in Day view, a week at a time in Week view, a month at a time
 *  in Month view. dir is -1 (back) or 1 (forward). */
function saaCalNavigate(dir) {
  if (saaCalViewMode === "day") { saaCalShiftDate(dir); return; }
  if (saaCalViewMode === "week") { saaCalShiftDate(dir * 7); return; }
  const d = new Date(saaCalCurrentDate + "T12:00:00");
  d.setMonth(d.getMonth() + dir, 1); // land on the 1st first so e.g. Jan 31 -> Feb doesn't overflow into March
  saaCalSetDate(_saaCalDateObjToStr(d));
}

function saaCalUpdateDateLabel() {
  const label = document.getElementById("cal-date-label");
  if (saaCalViewMode === "week") {
    const start = _saaCalWeekStart(saaCalCurrentDate);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    label.textContent = `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  } else if (saaCalViewMode === "month") {
    const d = new Date(saaCalCurrentDate + "T12:00:00");
    label.textContent = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else {
    label.textContent = saaCalFormatDateLabel(saaCalCurrentDate);
  }
}

/** Switches between Day / Week / Month. Day view alone has technician
 *  tracks + drag-and-drop; Week/Month share one agenda-style container. */
function saaCalSetView(mode) {
  if (saaCalViewMode === mode) return;
  saaCalViewMode = mode;
  document.querySelectorAll(".cal-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === mode));
  document.getElementById("cal-day-view-wrap").hidden = mode !== "day";
  document.getElementById("cal-altview-wrap").hidden = mode === "day";
  saaCalUpdateDateLabel();
  saaCalLoadAndRender();
}

function _saaCalWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  return d;
}
async function saaCalFetchWeekRange(dateStr) {
  const start = _saaCalWeekStart(dateStr);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return saaCalFetchRangeData(_saaCalDateObjToStr(start), _saaCalDateObjToStr(end));
}
async function saaCalFetchMonthRange(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const gridStart = new Date(d.getFullYear(), d.getMonth(), 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridEnd.getDate() + 42);
  return saaCalFetchRangeData(_saaCalDateObjToStr(gridStart), _saaCalDateObjToStr(gridEnd));
}

async function saaCalLoadAndRender() {
  if (saaCalViewMode === "day") {
    const data = await saaCalFetchDayData(saaCalCurrentDate);
    saaCalTechnicians = data.technicians;
    saaCalScheduled = data.scheduled;
    saaCalUnscheduled = data.unscheduled;
    saaCalRenderSummaryStrip();
    saaCalRenderUnscheduledQueue();
    saaCalRenderDayGrid();
    return;
  }
  const [rangeData, unscheduled] = await Promise.all([
    saaCalViewMode === "week" ? saaCalFetchWeekRange(saaCalCurrentDate) : saaCalFetchMonthRange(saaCalCurrentDate),
    saaCalFetchUnscheduled(),
  ]);
  saaCalTechnicians = rangeData.technicians;
  saaCalScheduled = rangeData.scheduled;
  saaCalUnscheduled = unscheduled;
  saaCalRenderSummaryStrip();
  saaCalRenderUnscheduledQueue();
  if (saaCalViewMode === "week") saaCalRenderWeekView(saaCalScheduled);
  else saaCalRenderMonthView(saaCalScheduled);
}

/* ============================== WEEK / MONTH VIEWS ============================== */

function saaCalRenderWeekView(scheduled) {
  const wrap = document.getElementById("cal-altview-wrap");
  const weekStart = _saaCalWeekStart(saaCalCurrentDate);
  const todayStr = saaCalTodayStr();
  let html = '<div class="cal-week-grid">';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart); d.setDate(d.getDate() + i);
    const dateStr = _saaCalDateObjToStr(d);
    const dayAppts = scheduled
      .filter((a) => String(a.start_datetime || "").slice(0, 10) === dateStr)
      .sort((a, b) => saaCalMinutesFromTimeStr(a.start_datetime) - saaCalMinutesFromTimeStr(b.start_datetime));
    const cardsHtml = dayAppts.length ? dayAppts.map((a) => {
      const type = saaCalTypesByKey[a.job.job_type] || {};
      const startMin = saaCalMinutesFromTimeStr(a.start_datetime);
      return `<div class="cal-week-appt st-${a.status}" data-appt-id="${a.id}">
        <span class="t">${saaCalFormatClock(startMin)}</span>
        <span class="n">${type.icon || ""} ${_saaCalEsc(saaCalCustName(a.customer))}</span>
        <span class="tech">${a.technician ? _saaCalEsc(a.technician.name) : "Unassigned"}</span>
      </div>`;
    }).join("") : '<div class="cal-week-empty">Nothing scheduled</div>';
    html += `<div class="cal-week-day${dateStr === todayStr ? " is-today" : ""}" data-date="${dateStr}">
      <div class="cal-week-daylabel" data-date="${dateStr}">${d.toLocaleDateString("en-US", { weekday: "short" })} <span>${d.getDate()}</span></div>
      <div class="cal-week-daybody">${cardsHtml}</div>
    </div>`;
  }
  html += "</div>";
  wrap.innerHTML = html;
  // Round 11 follow-up (2026-09-13): clicking ANYWHERE in a day's box
  // opens that day's Day view, not just the small "Sun 13" label --
  // mirrors saaCalRenderMonthView's .cal-month-cell click handler below,
  // including its guard so clicking an actual appointment card still
  // opens that job instead of navigating away.
  wrap.querySelectorAll(".cal-week-day").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".cal-week-appt")) return;
      saaCalSetView("day");
      saaCalSetDate(el.dataset.date);
    });
  });
  wrap.querySelectorAll(".cal-week-appt").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); saaCalOpenJobDrawer(el.dataset.apptId); });
  });
}

function saaCalRenderMonthView(scheduled) {
  const wrap = document.getElementById("cal-altview-wrap");
  const cur = new Date(saaCalCurrentDate + "T12:00:00");
  const month = cur.getMonth();
  const todayStr = saaCalTodayStr();
  const gridStart = new Date(cur.getFullYear(), month, 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const byDate = {};
  scheduled.forEach((a) => {
    const ds = String(a.start_datetime || "").slice(0, 10);
    (byDate[ds] = byDate[ds] || []).push(a);
  });

  let html = '<div class="cal-month-head">' + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div>${d}</div>`).join("") + "</div>";
  html += '<div class="cal-month-grid">';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(d.getDate() + i);
    const dateStr = _saaCalDateObjToStr(d);
    const inMonth = d.getMonth() === month;
    const dayAppts = (byDate[dateStr] || []).sort((a, b) => saaCalMinutesFromTimeStr(a.start_datetime) - saaCalMinutesFromTimeStr(b.start_datetime));
    const shown = dayAppts.slice(0, 3);
    const moreCount = dayAppts.length - shown.length;
    const chips = shown.map((a) => {
      const type = saaCalTypesByKey[a.job.job_type] || {};
      return `<div class="cal-month-chip st-${a.status}" data-appt-id="${a.id}">${type.icon || ""} ${_saaCalEsc(saaCalCustName(a.customer))}</div>`;
    }).join("") + (moreCount > 0 ? `<div class="cal-month-more">+${moreCount} more</div>` : "");
    html += `<div class="cal-month-cell${inMonth ? "" : " is-outside"}${dateStr === todayStr ? " is-today" : ""}" data-date="${dateStr}">
      <div class="cal-month-daynum">${d.getDate()}</div>
      <div class="cal-month-chips">${chips}</div>
    </div>`;
  }
  html += "</div>";
  wrap.innerHTML = html;
  wrap.querySelectorAll(".cal-month-cell").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".cal-month-chip")) return;
      saaCalSetView("day");
      saaCalSetDate(el.dataset.date);
    });
  });
  wrap.querySelectorAll(".cal-month-chip").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); saaCalOpenJobDrawer(el.dataset.apptId); });
  });
}

/* ============================== SUMMARY STRIP ============================== */

function saaCalRenderSummaryStrip() {
  const counts = { scheduled: 0, en_route: 0, on_site: 0, waiting_parts: 0, completed: 0 };
  saaCalScheduled.forEach((a) => { if (a.status in counts) counts[a.status]++; });
  const items = [
    ["scheduled", counts.scheduled, "Scheduled"],
    ["en_route", counts.en_route, "En Route"],
    ["on_site", counts.on_site, "On Site"],
    ["waiting_parts", counts.waiting_parts, "Waiting for Parts"],
    ["completed", counts.completed, "Completed"],
  ];
  let html = items.map(([k, n, label]) => `<div class="cal-stat"><span class="dot" style="background:var(--st-${k})"></span>${n} ${label}</div>`).join("");
  html += `<div class="cal-stat"><span class="dot" style="background:#9aa7b2"></span>${saaCalUnscheduled.length} Unassigned</div>`;
  document.getElementById("cal-summary-strip").innerHTML = html;
}

/* ============================== UNSCHEDULED QUEUE ============================== */

function saaCalRenderUnscheduledQueue() {
  document.getElementById("cal-unscheduled-count").textContent = saaCalUnscheduled.length;
  const wrap = document.getElementById("cal-unscheduled-row");
  if (!saaCalUnscheduled.length) {
    wrap.innerHTML = '<div class="cal-unscheduled-empty">Nothing waiting — every job is on the board.</div>';
    return;
  }
  wrap.innerHTML = saaCalUnscheduled.map((a) => {
    const type = saaCalTypesByKey[a.job.job_type] || {};
    return `<div class="cal-unassigned-card priority-${a.job.priority || "normal"}" draggable="true" data-appt-id="${a.id}">
      <div class="name">${type.icon || ""} ${_saaCalEsc(saaCalCustName(a.customer))}</div>
      <div class="meta">${_saaCalEsc(a.job.title || type.label || "")}</div>
    </div>`;
  }).join("");
}

/* ============================== DAY GRID ============================== */

function saaCalHourLabelsHtml() {
  let out = "";
  for (let h = SAA_CAL_DAY_START_HOUR; h < SAA_CAL_DAY_END_HOUR; h++) {
    out += `<div class="hr-label">${saaCalFormatClock(h * 60).replace(":00", "")}</div>`;
  }
  return out;
}

function saaCalTechStatusLabel(techId) {
  const appts = saaCalScheduled.filter((a) => a.technician_id === techId);
  if (appts.some((a) => a.status === "on_site")) return "🟣 On Site";
  if (appts.some((a) => a.status === "en_route")) return "🔵 En Route";
  if (appts.length && appts.every((a) => a.status === "completed" || a.status === "cancelled")) return "🟢 Done";
  if (!appts.length) return "⚪ Available";
  return "🟡 Scheduled";
}

/**
 * Two appointments on the same technician can legitimately overlap after a
 * dispatcher confirms "Move Anyway" on a conflict — the calendar must still
 * show both rather than silently stacking one on top of the other. This
 * does simple greedy interval-graph coloring per technician track: each
 * appointment gets a lane number, and overlapping appointments never share
 * a lane, so the track splits into horizontal bands only when it needs to.
 */
function saaCalAssignLanes(appts) {
  const items = appts
    .map((a) => ({ appt: a, start: saaCalMinutesFromTimeStr(a.start_datetime), end: saaCalMinutesFromTimeStr(a.end_datetime) }))
    .sort((a, b) => a.start - b.start);
  const laneEnds = [];
  items.forEach((it) => {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); }
    else { laneEnds[lane] = it.end; }
    it.lane = lane;
  });
  const totalLanes = laneEnds.length || 1;
  return items.map((it) => ({ appt: it.appt, lane: it.lane, totalLanes }));
}

function saaCalApptCardHtml(appt, lane, totalLanes) {
  const type = saaCalTypesByKey[appt.job.job_type] || {};
  const startMin = saaCalMinutesFromTimeStr(appt.start_datetime);
  const endMin = saaCalMinutesFromTimeStr(appt.end_datetime);
  const left = saaCalPct(startMin);
  const width = Math.max(saaCalPct(endMin) - left, 3);
  const n = totalLanes || 1;
  const vertical = n > 1
    ? `top:calc(6px + ${lane} * ((100% - 12px) / ${n}));height:calc((100% - 12px) / ${n} - 3px);bottom:auto;`
    : "";
  return `<div class="appt-card st-${appt.status}" draggable="true" data-appt-id="${appt.id}" style="left:${left}%;width:${width}%;${vertical}" title="${_saaCalEsc(saaCalCustName(appt.customer))} — ${_saaCalEsc(appt.job.title || "")}">
    <div class="appt-title">${type.icon || ""} ${_saaCalEsc(saaCalCustName(appt.customer))}</div>
    <div class="appt-sub">${_saaCalEsc(appt.job.title || type.label || "")}</div>
    <div class="appt-resize-handle" title="Drag to change the end time"></div>
  </div>`;
}

function saaCalTechTrackHtml(tech) {
  const techAppts = saaCalScheduled.filter((a) => a.technician_id === tech.id);
  const cards = saaCalAssignLanes(techAppts).map(({ appt, lane, totalLanes }) => saaCalApptCardHtml(appt, lane, totalLanes)).join("");
  return `<div class="cal-tech-row">
    <div class="cal-tech-label"><div>${_saaCalEsc(tech.name)}</div><div class="tech-status">${saaCalTechStatusLabel(tech.id)}</div></div>
    <div class="cal-tech-track" data-tech-id="${tech.id}">${cards}</div>
  </div>`;
}

function saaCalRenderDayGrid() {
  document.getElementById("cal-grid-hours-row").innerHTML = saaCalHourLabelsHtml();
  const body = document.getElementById("cal-grid-body");
  if (!saaCalTechnicians.length) {
    body.innerHTML = '<div class="cal-unscheduled-empty" style="padding:16px">No active technicians on file.</div>';
    return;
  }
  body.innerHTML = saaCalTechnicians.map(saaCalTechTrackHtml).join("");

  saaCalTechnicians.forEach((tech) => {
    const track = body.querySelector(`.cal-tech-track[data-tech-id="${tech.id}"]`);
    if (!track) return;

    track.addEventListener("click", (e) => {
      if (e.target.closest(".appt-card")) return;
      const rect = track.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      let minutes = SAA_CAL_DAY_START_HOUR * 60 + Math.round((pct * SAA_CAL_TOTAL_MINUTES) / SAA_CAL_SLOT_MINUTES) * SAA_CAL_SLOT_MINUTES;
      minutes = Math.max(SAA_CAL_DAY_START_HOUR * 60, Math.min(minutes, SAA_CAL_DAY_END_HOUR * 60 - SAA_CAL_SLOT_MINUTES));
      saaCalOpenNewServicePopup({ technicianId: tech.id, startMinutes: minutes });
    });

    track.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; track.classList.add("drop-hover"); });
    track.addEventListener("dragleave", () => track.classList.remove("drop-hover"));
    track.addEventListener("drop", (e) => {
      e.preventDefault();
      track.classList.remove("drop-hover");
      const rect = track.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      let minutes = SAA_CAL_DAY_START_HOUR * 60 + Math.round((pct * SAA_CAL_TOTAL_MINUTES) / SAA_CAL_SLOT_MINUTES) * SAA_CAL_SLOT_MINUTES;
      minutes = Math.max(SAA_CAL_DAY_START_HOUR * 60, Math.min(minutes, SAA_CAL_DAY_END_HOUR * 60 - SAA_CAL_SLOT_MINUTES));
      saaCalHandleDrop(tech.id, minutes);
    });
  });

  body.querySelectorAll(".appt-resize-handle").forEach((handle) => {
    handle.addEventListener("mousedown", saaCalStartResize);
    // A plain click (no drag) on the handle shouldn't also open the Job
    // Details drawer via the document-level .appt-card click handler below.
    handle.addEventListener("click", (e) => e.stopPropagation());
  });
}

/* ============================== RESIZE (drag right edge = change end time) ============================== */

/**
 * Dragging an appointment card's right-edge handle changes its end time
 * (duration) without moving its start time or technician. Implemented
 * with plain mouse events rather than HTML5 drag-and-drop — that's what
 * the whole-card move above uses, and layering another native drag
 * source inside a draggable="true" card would fight it — so the handle's
 * mousedown disables the card's native dragging for the gesture instead.
 */
function saaCalStartResize(e) {
  e.preventDefault();
  e.stopPropagation();
  const card = e.target.closest(".appt-card");
  if (!card) return;
  const appt = saaCalScheduled.find((a) => a.id === card.dataset.apptId);
  if (!appt) return;
  const track = card.closest(".cal-tech-track");
  if (!track) return;
  const trackRect = track.getBoundingClientRect();

  card.draggable = false;
  card.classList.add("resizing");
  const startMin = saaCalMinutesFromTimeStr(appt.start_datetime);
  const origEndMin = saaCalMinutesFromTimeStr(appt.end_datetime);
  let newEndMin = origEndMin;

  function onMove(ev) {
    const pct = (ev.clientX - trackRect.left) / trackRect.width;
    let minutes = SAA_CAL_DAY_START_HOUR * 60 + Math.round((pct * SAA_CAL_TOTAL_MINUTES) / SAA_CAL_SLOT_MINUTES) * SAA_CAL_SLOT_MINUTES;
    minutes = Math.max(startMin + SAA_CAL_SLOT_MINUTES, Math.min(minutes, SAA_CAL_DAY_END_HOUR * 60));
    newEndMin = minutes;
    const leftPct = saaCalPct(startMin);
    const widthPct = Math.max(saaCalPct(newEndMin) - leftPct, 3);
    card.style.width = widthPct + "%";
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    card.draggable = true;
    card.classList.remove("resizing");
    if (newEndMin !== origEndMin) saaCalFinishResize(appt, newEndMin);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

async function saaCalFinishResize(appt, newEndMin) {
  const res = await saaCalUpdateAppointmentSchedule({
    appointmentId: appt.id,
    jobId: appt.job_id,
    technicianId: appt.technician_id,
    startDatetime: appt.start_datetime,
    endDatetime: saaCalTimeStr(saaCalCurrentDate, newEndMin),
  });
  if (res.ok) {
    await saaCalLoadAndRender();
    saaCalShowToast(`Appointment now ends at ${saaCalFormatClock(newEndMin)}`);
  } else {
    alert("Error: " + res.error);
    await saaCalLoadAndRender();
  }
}

/* ============================== DRAG & DROP ============================== */

document.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".appt-card");
  if (card) {
    saaCalDragPayload = { kind: "scheduled", id: card.dataset.apptId };
    e.dataTransfer.setData("text/plain", card.dataset.apptId);
    e.dataTransfer.effectAllowed = "move";
    // Pin the drag image's hotspot to the box's top-left corner instead of
    // wherever inside the card the dispatcher happened to grab it — that's
    // what makes the appointment land exactly under the cursor on drop
    // (the drop math below reads the cursor position as the box's left
    // edge) instead of appearing to land "off" from where it was dropped.
    if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(card, 0, 0);
    card.classList.add("dragging");
    return;
  }
  const uCard = e.target.closest(".cal-unassigned-card");
  if (uCard) {
    saaCalDragPayload = { kind: "unscheduled", id: uCard.dataset.apptId };
    e.dataTransfer.setData("text/plain", uCard.dataset.apptId);
    e.dataTransfer.effectAllowed = "move";
    if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(uCard, 0, 0);
    uCard.classList.add("drag-ghost");
  }
});
document.addEventListener("dragend", () => {
  document.querySelectorAll(".appt-card.dragging").forEach((el) => el.classList.remove("dragging"));
  document.querySelectorAll(".cal-unassigned-card.drag-ghost").forEach((el) => el.classList.remove("drag-ghost"));
});

async function saaCalHandleDrop(techId, startMinutes) {
  const payload = saaCalDragPayload;
  saaCalDragPayload = null;
  if (!payload) return;
  const source = payload.kind === "scheduled"
    ? saaCalScheduled.find((a) => a.id === payload.id)
    : saaCalUnscheduled.find((a) => a.id === payload.id);
  if (!source) return;

  const type = saaCalTypesByKey[source.job.job_type] || {};
  const durationMin = source.start_datetime && source.end_datetime
    ? saaCalMinutesFromTimeStr(source.end_datetime) - saaCalMinutesFromTimeStr(source.start_datetime)
    : (type.default_duration_minutes || 60);
  const endMinutes = startMinutes + durationMin;

  const conflict = saaCalScheduled.find((a) =>
    a.id !== source.id &&
    a.technician_id === techId &&
    a.status !== "cancelled" &&
    saaCalMinutesFromTimeStr(a.start_datetime) < endMinutes &&
    saaCalMinutesFromTimeStr(a.end_datetime) > startMinutes
  );

  const techName = (saaCalTechnicians.find((t) => t.id === techId) || {}).name || "technician";

  const doMove = async () => {
    const res = await saaCalUpdateAppointmentSchedule({
      appointmentId: source.id,
      jobId: source.job_id,
      technicianId: techId,
      startDatetime: saaCalTimeStr(saaCalCurrentDate, startMinutes),
      endDatetime: saaCalTimeStr(saaCalCurrentDate, endMinutes),
    });
    if (res.ok) {
      await saaCalLoadAndRender();
      saaCalShowToast(`Appointment moved to ${techName} – ${saaCalFormatClock(startMinutes)}`);
    } else {
      alert("Error: " + res.error);
    }
  };

  if (conflict) {
    const custName = saaCalCustName(conflict.customer);
    document.getElementById("cal-conflict-detail").textContent =
      `${techName} already has ${custName}, ${saaCalFormatClock(saaCalMinutesFromTimeStr(conflict.start_datetime))} – ${saaCalFormatClock(saaCalMinutesFromTimeStr(conflict.end_datetime))}.`;
    document.getElementById("cal-conflict-modal").hidden = false;
    document.getElementById("cal-conflict-confirm-btn").onclick = async () => {
      document.getElementById("cal-conflict-modal").hidden = true;
      await doMove();
    };
    document.getElementById("cal-conflict-cancel-btn").onclick = () => {
      document.getElementById("cal-conflict-modal").hidden = true;
    };
  } else {
    await doMove();
  }
}

/* ============================== NEW SERVICE POPUP ============================== */

function saaCalRenderTypeGrid() {
  const grid = document.getElementById("ns-type-grid");
  grid.innerHTML = saaCalAppointmentTypes.map((t) => `<div class="cal-type-btn" data-key="${t.key}"><span class="ic">${t.icon}</span>${_saaCalEsc(t.label)}</div>`).join("");
  grid.querySelectorAll(".cal-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      saaCalSelectedTypeKey = btn.dataset.key;
      grid.querySelectorAll(".cal-type-btn").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });
}
function saaCalRenderPriorityRow(defaultP) {
  const row = document.getElementById("ns-priority-row");
  const opts = [["normal", "Normal"], ["high", "High"], ["emergency", "🚨 Emergency"]];
  row.innerHTML = opts.map(([k, l]) => `<div class="cal-priority-btn${k === defaultP ? " active" : ""}" data-p="${k}">${l}</div>`).join("");
  row.querySelectorAll(".cal-priority-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      row.querySelectorAll(".cal-priority-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}
function saaCalGetSelectedPriority() {
  const active = document.querySelector("#ns-priority-row .cal-priority-btn.active");
  return active ? active.dataset.p : "normal";
}

function saaCalOpenNewServicePopup(ctx) {
  ctx = ctx || {};
  saaCalSelectedCustomer = null;
  saaCalSelectedTypeKey = null;
  document.getElementById("ns-cust-search").value = "";
  document.getElementById("ns-selected-cust").hidden = true;
  document.getElementById("ns-cust-results").hidden = true;
  document.getElementById("ns-newcust-form").hidden = true;
  ["ns-newcust-first", "ns-newcust-last", "ns-newcust-phone", "ns-newcust-address", "ns-newcust-city", "ns-newcust-zip"].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("ns-title").value = "";
  document.getElementById("ns-status").textContent = "";
  saaCalRenderTypeGrid();
  saaCalRenderPriorityRow("normal");

  const techSelect = document.getElementById("ns-tech");
  techSelect.innerHTML = '<option value="">Unassigned (add to queue)</option>' + saaCalTechnicians.map((t) => `<option value="${t.id}">${_saaCalEsc(t.name)}</option>`).join("");
  techSelect.value = ctx.technicianId || "";
  document.getElementById("ns-time").value = ctx.startMinutes != null ? saaCalFormatClock24(ctx.startMinutes) : "09:00";

  document.getElementById("cal-newsvc-modal").hidden = false;
  document.getElementById("ns-cust-search").focus();
}

function saaCalRenderCustResults(results, query) {
  const box = document.getElementById("ns-cust-results");
  const addNewHtml = `<div class="cal-cust-result add-new" id="ns-add-new-cust">+ Add "${_saaCalEsc(query || "new customer")}" as a new customer</div>`;
  if (!results.length) {
    box.innerHTML = `<div class="cal-cust-result muted">No matches.</div>${addNewHtml}`;
    box.hidden = false;
    document.getElementById("ns-add-new-cust").addEventListener("click", () => saaCalOpenNewCustomerForm(query));
    return;
  }
  box.innerHTML = results.map((r, i) => {
    const c = r.customer;
    const lastFirst = [c.last_name, c.first_name].filter(Boolean).join(", ") || saaCalCustName(c);
    const equipLine = r.equipment ? `${r.equipment.brand || ""} ${r.equipment.tonnage ? r.equipment.tonnage + " Ton" : ""}`.trim() : "";
    const warrantyLine = r.equipment ? (r.equipment.warranty_status === "active" ? "Active" : r.equipment.warranty_status === "expired" ? "Expired" : "Unknown") : "";
    const lastServiceRaw = r.lastJob ? (r.lastJob.completed_date || (r.lastJob.created_at || "").slice(0, 10)) : "";
    const lastServiceLine = lastServiceRaw ? saaCalFormatShortDate(lastServiceRaw) : "";
    const metaParts = [];
    if (lastServiceLine) metaParts.push("Last Service: " + lastServiceLine);
    if (equipLine) metaParts.push("Equipment: " + equipLine);
    if (warrantyLine) metaParts.push("Warranty: " + warrantyLine);
    const addrLine = [c.billing_address, [c.billing_city, c.billing_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return `<div class="cal-cust-result" data-idx="${i}">
      <div class="name">${_saaCalEsc(lastFirst)}</div>
      ${addrLine ? `<div class="addr">${_saaCalEsc(addrLine)}</div>` : ""}
      ${c.phone ? `<div class="phone">${_saaCalEsc(saaFormatPhone(c.phone))}</div>` : ""}
      ${metaParts.length ? `<div class="svc-meta">${_saaCalEsc(metaParts.join(" · "))}</div>` : ""}
    </div>`;
  }).join("") + addNewHtml;
  box.hidden = false;
  document.getElementById("ns-add-new-cust").addEventListener("click", () => saaCalOpenNewCustomerForm(query));
  box.querySelectorAll(".cal-cust-result[data-idx]").forEach((el) => {
    el.addEventListener("click", () => saaCalSelectCustomer(results[parseInt(el.dataset.idx, 10)]));
  });
}

function saaCalSelectCustomer(result) {
  saaCalSelectedCustomer = result;
  document.getElementById("ns-cust-results").hidden = true;
  document.getElementById("ns-newcust-form").hidden = true;
  const c = result.customer;
  const equipLine = result.equipment ? `${result.equipment.brand || ""} ${result.equipment.tonnage ? result.equipment.tonnage + " Ton" : ""}`.trim() : "No equipment on file";
  const warrantyLine = result.equipment ? (result.equipment.warranty_status === "active" ? "Active" : result.equipment.warranty_status === "expired" ? "Expired" : "Unknown") : "—";
  const box = document.getElementById("ns-selected-cust");
  const addrLine = [c.billing_address, [c.billing_city, c.billing_zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  box.innerHTML = `<div class="name">${_saaCalEsc(saaCalCustName(c))}${result.isNew ? ' <span class="muted" style="font-weight:400;font-size:.76rem">(new customer)</span>' : ""}</div>
    <div class="row">📍 ${_saaCalEsc(addrLine || "No address on file")}</div>
    <div class="row">📞 ${_saaCalEsc(c.phone ? saaFormatPhone(c.phone) : "—")}</div>
    <div class="row">🔧 ${_saaCalEsc(equipLine)}</div>
    <div class="row">🛡️ Warranty: ${_saaCalEsc(warrantyLine)}</div>`;
  box.hidden = false;
  document.getElementById("ns-cust-search").value = saaCalCustName(c);
}

/** Search found nobody — reveal the compact "new customer" mini-form.
 *  Best-guess prefill from what was typed: a phone-number-shaped query
 *  goes to Phone; otherwise it's a name, split on whitespace so "John
 *  Smith" correctly fills First=John/Last=Smith, and a single word (the
 *  common case while still typing a name) fills First name rather than
 *  Last — every field stays editable regardless. Previously this always
 *  dropped the whole query into Last Name and left First Name blank,
 *  even for a single word, which is backwards for the common case of
 *  starting to type someone's first name. */
function saaCalOpenNewCustomerForm(query) {
  document.getElementById("ns-cust-results").hidden = true;
  const q = (query || "").trim();
  const looksLikePhone = /^[\d\s\-().]{7,}$/.test(q);
  let first = "", last = "";
  if (!looksLikePhone && q) {
    const parts = q.split(/\s+/);
    if (parts.length > 1) { first = parts[0]; last = parts.slice(1).join(" "); }
    else { first = q; }
  }
  document.getElementById("ns-newcust-first").value = first;
  document.getElementById("ns-newcust-last").value = last;
  document.getElementById("ns-newcust-phone").value = looksLikePhone ? q : "";
  document.getElementById("ns-newcust-address").value = "";
  document.getElementById("ns-newcust-city").value = "";
  document.getElementById("ns-newcust-zip").value = "";
  document.getElementById("ns-newcust-form").hidden = false;
  document.getElementById("ns-newcust-first").focus();
}

function saaCalUseNewCustomer() {
  const first = document.getElementById("ns-newcust-first").value.trim();
  const last = document.getElementById("ns-newcust-last").value.trim();
  const phone = document.getElementById("ns-newcust-phone").value.trim();
  const address = document.getElementById("ns-newcust-address").value.trim();
  const city = document.getElementById("ns-newcust-city").value.trim();
  const zip = document.getElementById("ns-newcust-zip").value.trim();
  if (!first && !last && !phone) {
    document.getElementById("ns-status").textContent = "Enter at least a name or phone number for the new customer.";
    return;
  }
  saaCalSelectCustomer({
    isNew: true,
    customer: { first_name: first || null, last_name: last || null, phone: phone || null, billing_address: address || null, billing_city: city || null, billing_zip: zip || null },
    equipment: null,
    lastJob: null,
  });
}

/* ============================== JOB DETAILS DRAWER ============================== */

function saaCalCloseDrawer() {
  document.getElementById("cal-drawer-overlay").hidden = true;
  document.getElementById("cal-drawer").hidden = true;
  saaCalDrawerAppt = null;
}

async function saaCalOpenJobDrawer(apptId) {
  const appt = saaCalScheduled.find((a) => a.id === apptId) || saaCalUnscheduled.find((a) => a.id === apptId);
  if (!appt) return;
  saaCalDrawerAppt = appt;
  const type = saaCalTypesByKey[appt.job.job_type] || {};
  const custName = saaCalCustName(appt.customer);
  const startMin = saaCalMinutesFromTimeStr(appt.start_datetime);
  const endMin = saaCalMinutesFromTimeStr(appt.end_datetime);
  const timeStr = (startMin != null && endMin != null) ? `${saaCalFormatClock(startMin)} – ${saaCalFormatClock(endMin)}` : "Not yet scheduled";
  const jobNum = appt.job.job_number || ("J-" + String(appt.job_id || "").slice(0, 8).toUpperCase());
  const address = appt.customer.billing_address || appt.job.job_address || "—";
  const phone = appt.customer.phone || "";

  document.getElementById("drawer-title").textContent = `${custName} – ${appt.job.title || type.label || ""}`;
  document.getElementById("drawer-jobnum").textContent = jobNum;
  document.getElementById("drawer-jobrecord-link").href = "jobs.html?job=" + encodeURIComponent(appt.job_id || "");
  document.getElementById("drawer-address").textContent = address;
  document.getElementById("drawer-phone").textContent = phone ? saaFormatPhone(phone) : "—";
  document.getElementById("drawer-phone-link").href = phone ? "tel:" + phone.replace(/\D/g, "") : "#";
  document.getElementById("drawer-navigate-link").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
  document.getElementById("drawer-tech").textContent = appt.technician ? appt.technician.name : "Unassigned";
  document.getElementById("drawer-time").textContent = timeStr;
  document.getElementById("drawer-status-select").value = appt.status;
  document.getElementById("drawer-equipment").textContent = "Loading…";

  document.getElementById("cal-followup-box").hidden = appt.status !== "completed";
  document.getElementById("cal-followup-form").hidden = true;
  document.getElementById("cal-followup-start-btn").hidden = false;

  document.getElementById("cal-drawer-overlay").hidden = false;
  document.getElementById("cal-drawer").hidden = false;

  try {
    const equip = appt.job.customer_id ? await saaCalFetchLatestEquipment(appt.job.customer_id) : null;
    document.getElementById("drawer-equipment").textContent = equip
      ? `${equip.brand || ""} ${equip.tonnage ? equip.tonnage + " Ton" : ""} ${equip.refrigerant_type || ""}${equip.install_year ? " · Installed " + equip.install_year : ""}`.trim()
      : "No equipment on file yet.";
  } catch (e) {
    document.getElementById("drawer-equipment").textContent = "No equipment on file yet.";
  }
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".appt-card, .cal-unassigned-card");
  if (card) saaCalOpenJobDrawer(card.dataset.apptId);
});

/* ============================== STATIC HANDLERS (wired once) ============================== */

function saaCalWireStaticHandlers() {
  document.getElementById("cal-prev-btn").addEventListener("click", () => saaCalNavigate(-1));
  document.getElementById("cal-next-btn").addEventListener("click", () => saaCalNavigate(1));
  document.getElementById("cal-today-btn").addEventListener("click", () => saaCalSetDate(saaCalTodayStr()));
  document.getElementById("cal-date-input").addEventListener("change", (e) => saaCalSetDate(e.target.value));
  document.getElementById("cal-new-service-btn").addEventListener("click", () => saaCalOpenNewServicePopup({}));
  document.querySelectorAll(".cal-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => saaCalSetView(btn.dataset.view));
  });

  document.getElementById("ns-cust-search").addEventListener("input", (e) => {
    clearTimeout(saaCalSearchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { document.getElementById("ns-cust-results").hidden = true; return; }
    saaCalSearchTimer = setTimeout(async () => {
      try {
        const results = await saaCalSearchCustomers(q);
        saaCalRenderCustResults(results, q);
      } catch (err) { /* silent — search is best-effort */ }
    }, 200);
  });

  document.getElementById("ns-save-btn").addEventListener("click", async () => {
    const status = document.getElementById("ns-status");
    if (!saaCalSelectedCustomer) { status.textContent = "Search for and select a customer first."; return; }
    if (!saaCalSelectedTypeKey) { status.textContent = "Pick a service type."; return; }
    const techId = document.getElementById("ns-tech").value || null;
    const timeVal = document.getElementById("ns-time").value;
    let startDatetime = null, endDatetime = null;
    if (techId && timeVal) {
      const [hh, mm] = timeVal.split(":").map(Number);
      const startMinutes = hh * 60 + mm;
      const type = saaCalTypesByKey[saaCalSelectedTypeKey] || {};
      const dur = type.default_duration_minutes || 60;
      startDatetime = saaCalTimeStr(saaCalCurrentDate, startMinutes);
      endDatetime = saaCalTimeStr(saaCalCurrentDate, startMinutes + dur);
    }
    status.textContent = "Saving…";
    const sc = saaCalSelectedCustomer;
    const res = await saaCalCreateJobWithAppointment({
      customerId: sc.isNew ? null : sc.customer.id,
      newCustomer: sc.isNew ? { firstName: sc.customer.first_name, lastName: sc.customer.last_name, phone: sc.customer.phone, address: sc.customer.billing_address, city: sc.customer.billing_city, zip: sc.customer.billing_zip } : null,
      title: document.getElementById("ns-title").value.trim(),
      appointmentTypeKey: saaCalSelectedTypeKey,
      priority: saaCalGetSelectedPriority(),
      technicianId: techId,
      startDatetime, endDatetime,
      jobAddress: sc.customer.billing_address || null,
      // Round 7: carry the customer's City/ZIP onto the new job too, not
      // just the freeform Address string -- this is what makes the Job
      // Card's separate City/State/ZIP fields show up already filled
      // instead of needing the office to retype what's already in the
      // address, and what was causing ZIP in particular to sit blank
      // (there was previously no field to even capture it here).
      jobCity: sc.customer.billing_city || null,
      jobZip: sc.customer.billing_zip || null,
    });
    if (res.ok) {
      document.getElementById("cal-newsvc-modal").hidden = true;
      await saaCalLoadAndRender();
      saaCalShowToast(techId && startDatetime ? "Appointment scheduled." : "Added to Unscheduled Jobs.");
    } else {
      status.textContent = "Error: " + res.error;
    }
  });
  document.getElementById("ns-cancel-btn").addEventListener("click", () => { document.getElementById("cal-newsvc-modal").hidden = true; });

  document.getElementById("ns-newcust-use-btn").addEventListener("click", saaCalUseNewCustomer);
  document.getElementById("ns-newcust-cancel-btn").addEventListener("click", () => {
    document.getElementById("ns-newcust-form").hidden = true;
    document.getElementById("ns-cust-search").focus();
  });

  document.getElementById("cal-drawer-close-btn").addEventListener("click", saaCalCloseDrawer);
  document.getElementById("cal-drawer-overlay").addEventListener("click", saaCalCloseDrawer);

  // Round 6 item 7: "View Full Job Record" opens the Job Card as an overlay
  // right here instead of navigating to jobs.html, so the Dispatch Calendar
  // stays in the background — unlike opening the same Job Card FROM the
  // Jobs page, which is a normal same-page modal there, this deliberately
  // doesn't change what URL/page is underneath. jobs.js/jobs-db.js/etc. are
  // loaded on calendar.html for exactly this (see gen_calendar.py).
  document.getElementById("drawer-jobrecord-link").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!saaCalDrawerAppt || !saaCalDrawerAppt.job_id) return;
    const jobId = saaCalDrawerAppt.job_id;
    saaCalCloseDrawer();
    await jbLoadAll();
    jbOpenDetail(jobId);
  });

  document.getElementById("drawer-status-select").addEventListener("change", async (e) => {
    const newStatus = e.target.value;
    const res = await saaCalUpdateAppointmentStatus({ appointmentId: saaCalDrawerAppt.id, jobId: saaCalDrawerAppt.job_id, status: newStatus });
    if (res.ok) {
      saaCalDrawerAppt.status = newStatus;
      document.getElementById("cal-followup-box").hidden = newStatus !== "completed";
      await saaCalLoadAndRender();
    } else {
      alert("Error: " + res.error);
    }
  });

  document.getElementById("drawer-cancel-btn").addEventListener("click", async () => {
    const res = await saaCalUpdateAppointmentStatus({ appointmentId: saaCalDrawerAppt.id, jobId: saaCalDrawerAppt.job_id, status: "cancelled" });
    if (res.ok) { saaCalCloseDrawer(); await saaCalLoadAndRender(); }
  });

  document.getElementById("drawer-reschedule-btn").addEventListener("click", () => {
    const techSel = document.getElementById("ra-tech");
    techSel.innerHTML = '<option value="">Unassigned</option>' + saaCalTechnicians.map((t) => `<option value="${t.id}">${_saaCalEsc(t.name)}</option>`).join("");
    techSel.value = saaCalDrawerAppt.technician_id || "";
    const startMin = saaCalMinutesFromTimeStr(saaCalDrawerAppt.start_datetime);
    document.getElementById("ra-time").value = startMin != null ? saaCalFormatClock24(startMin) : "09:00";
    document.getElementById("ra-status").textContent = "";
    document.getElementById("cal-reassign-modal").hidden = false;
  });
  document.getElementById("ra-save-btn").addEventListener("click", async () => {
    const techId = document.getElementById("ra-tech").value || null;
    const timeVal = document.getElementById("ra-time").value;
    const [hh, mm] = timeVal.split(":").map(Number);
    const startMinutes = hh * 60 + mm;
    const type = saaCalTypesByKey[saaCalDrawerAppt.job.job_type] || {};
    const existingDur = (saaCalDrawerAppt.start_datetime && saaCalDrawerAppt.end_datetime)
      ? saaCalMinutesFromTimeStr(saaCalDrawerAppt.end_datetime) - saaCalMinutesFromTimeStr(saaCalDrawerAppt.start_datetime)
      : (type.default_duration_minutes || 60);
    const res = await saaCalUpdateAppointmentSchedule({
      appointmentId: saaCalDrawerAppt.id,
      jobId: saaCalDrawerAppt.job_id,
      technicianId: techId,
      startDatetime: saaCalTimeStr(saaCalCurrentDate, startMinutes),
      endDatetime: saaCalTimeStr(saaCalCurrentDate, startMinutes + existingDur),
    });
    if (res.ok) {
      document.getElementById("cal-reassign-modal").hidden = true;
      saaCalCloseDrawer();
      await saaCalLoadAndRender();
    } else {
      document.getElementById("ra-status").textContent = "Error: " + res.error;
    }
  });
  document.getElementById("ra-cancel-btn").addEventListener("click", () => { document.getElementById("cal-reassign-modal").hidden = true; });

  document.getElementById("cal-followup-start-btn").addEventListener("click", () => {
    document.getElementById("cal-followup-form").hidden = false;
    document.getElementById("cal-followup-start-btn").hidden = true;
    const d = new Date(); d.setDate(d.getDate() + 3);
    document.getElementById("fu-date").value = _saaCalDateObjToStr(d);
    document.getElementById("fu-time").value = "10:00";
    document.getElementById("fu-status").textContent = "";
  });
  document.getElementById("fu-save-btn").addEventListener("click", async () => {
    const typeEl = document.querySelector('input[name="fu-type"]:checked');
    const status = document.getElementById("fu-status");
    if (!typeEl) { status.textContent = "Pick a follow-up type."; return; }
    status.textContent = "Saving…";
    const res = await saaCalCreateFollowUp({
      jobId: saaCalDrawerAppt.job_id,
      appointmentId: saaCalDrawerAppt.id,
      followUpType: typeEl.value,
      dueDate: document.getElementById("fu-date").value,
      dueTime: document.getElementById("fu-time").value,
      assignedTo: document.getElementById("fu-assign").value,
    });
    status.textContent = res.ok ? "Follow-up scheduled." : ("Error: " + res.error);
    if (res.ok) {
      document.getElementById("cal-followup-form").hidden = true;
      document.getElementById("cal-followup-start-btn").hidden = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("cal-grid-body")) saaCalInit();
});
