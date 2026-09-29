/* ============================================================
   SAA Comfort Air LLC -- Service Call Checklist (Round 68, 2026-09-28)

   Per Vijayan: "Add checklist to Service Call event. Every question should
   have yes/no toggle button. Toggle button should be greyed out as default.
   Once a option is selected it will toggle yes or no. ... Reword the
   questions so it is short and easier to read and answer while at service
   location. Time is of essence in field ... Unless user has no input for any
   line item, all selection and entry should be grayed out as default and
   write 'Not Recorded' when printing."

   The checklist lives on the Event (events.service_checklist, jsonb): a flat
   object keyed by item key. A missing key means Not Recorded -- defaults
   (Goodman, 130 psi, ...) are only SHOWN, greyed, and never stored until the
   technician touches that control. Everything autosaves ~0.5s after each
   tap. Model #s / OEM / orientation are also written to the Event's System
   (systems.outdoor_unit / coil / indoor_unit / furnace_air_handler /
   manufacturer / system_orientation). Serial-plate photos are taken with the
   shared camera modal and saved to the Event's photos.

   Depends on jobs.js globals (_jbEventModalTarget, _jbCurrentJob,
   _jbePhotos, _jbToast, jbeRenderPhotoGrid, jbRenderSystemSection),
   events-db.js, systems-db.js, job-photos-db.js and camera-capture.js.
   ============================================================ */

/* ---------------- Definition ---------------- */

const _svcYn = (k, q, tone) => ({ t: "yn", k, q, tone: tone || "good" });
const _svcPhoto = (k, q) => ({ t: "photo", k, q });
const _svcText = (k, q, extra) => Object.assign({ t: "text", k, q }, extra || {});
const _svcSel = (k, q, opts, extra) => Object.assign({ t: "select", k, q, opts }, extra || {});
const _svcSlider = (k, q, min, max, def, unit, extra) => Object.assign({ t: "slider", k, q, min, max, def, unit: unit || "" }, extra || {});

const _SVC_CABINETS = [["a", "A-Cabinet"], ["b", "B-Cabinet"], ["c", "C-Cabinet"], ["d", "D-Cabinet"]];
const _SVC_ORIENT = [["upflow", "Upflow"], ["downflow", "Downflow"], ["horizontal_left", "Horizontal left"], ["horizontal_right", "Horizontal right"]];

/** Drain / lineset / filter questions shared by the Coil and the Fan Coil. */
function _svcAirSide(p) {
  return [
    _svcYn(p + ".pan", "Secondary pan + float switch?"),
    _svcYn(p + ".trap", "Primary drain has P-trap & vent?"),
    _svcYn(p + ".sec_conn", "Secondary drain tied to line or switch?"),
    _svcYn(p + ".sec_clear", "Secondary drain line clear?"),
    _svcText(p + ".tube_s", "Suction tube size", { half: true, ph: '3/4"' }),
    _svcText(p + ".tube_l", "Liquid tube size", { half: true, ph: '3/8"' }),
    _svcYn(p + ".drop", "Both lines drop to coil?", "info"),
  ];
}

const SAA_SVC_SECTIONS = [
  {
    key: "cond", title: "Condenser", icon: "🌀", color: "#1a6fd1",
    items: [
      _svcPhoto("cond.photos", "Serial plate photos"),
      _svcSel("cond.oem", "OEM", [["carrier", "Carrier"], ["daikin", "Daikin"], ["goodman", "Goodman"], ["lennox", "Lennox"]], { def: "goodman", sys: "manufacturer" }),
      _svcText("cond.model", "Model #", { sys: "outdoor_unit", ph: "Condenser model number", caps: true }),
      _svcYn("cond.disc", "Disconnect OK, wires tight?"),
      _svcYn("cond.whip", "Whip OK & sized for amps?"),
      _svcYn("cond.temps", "Suction & liquid line temps checked?"),
      _svcSlider("cond.psi_s", "Suction pressure", 0, 670, 130, "psi", { big: true }),
      _svcSlider("cond.psi_l", "Liquid pressure", 0, 670, 350, "psi", { big: true }),
      _svcSlider("cond.sh", "Superheat", -20, 50, 15, "°F"),
      _svcSlider("cond.sc", "Subcool", -20, 50, 12, "°F"),
      _svcText("cond.tube_s", "Suction tube size", { half: true, ph: '3/4"' }),
      _svcText("cond.tube_l", "Liquid tube size", { half: true, ph: '3/8"' }),
      _svcYn("cond.anchor", "Unit anchored to pad?"),
      _svcSlider("cond.size", "OD unit size", 23, 48, 35, "in"),
      _svcYn("cond.door", "Fits through side door?"),
      _svcYn("cond.lift", "Must lift unit to replace?", "info"),
    ],
  },
  {
    key: "coil", title: "Coil", icon: "❄️", color: "#0f8a8a",
    items: [
      _svcPhoto("coil.photos", "Serial plate photos"),
      _svcText("coil.model", "Model #", { sys: "coil", ph: "Coil model number", caps: true }),
    ].concat(_svcAirSide("coil")).concat([
      _svcSel("coil.orient", "Orientation", _SVC_ORIENT, { def: "horizontal_left", sys: "system_orientation" }),
      _svcYn("coil.media", '4" media filter?', "info"),
      _svcYn("coil.stand", "Coil on heater stand?", "info"),
      _svcSel("coil.size", "Coil size", _SVC_CABINETS.concat([["slab", "Slab coil"]]), { def: "a" }),
      _svcSlider("coil.height", "Coil height", 12, 38, 25, "in"),
      _svcSel("coil.install", "Installed in", [["attic", "Attic"], ["closet", "Closet"], ["garage", "Garage"], ["basement", "Basement"]], { def: "attic" }),
      _svcYn("coil.attic", "Fits attic opening (no door removal)?"),
      _svcYn("coil.uvc", "UV-C light present?", "info"),
    ]),
  },
  {
    key: "fc", title: "Fan Coil", icon: "💨", color: "#7a3fc4",
    items: [
      _svcPhoto("fc.photos", "Serial plate photos"),
      _svcText("fc.model", "Model #", { sys: "indoor_unit", ph: "Fan coil model number", caps: true }),
    ].concat(_svcAirSide("fc")).concat([
      _svcSel("fc.orient", "Orientation", _SVC_ORIENT, { sys: "system_orientation" }),
      _svcYn("fc.media", '4" media filter?', "info"),
      _svcYn("fc.stand", "Fan coil on heater stand?", "info"),
      _svcSel("fc.size", "Fan coil size", _SVC_CABINETS),
      _svcSlider("fc.height", "Fan coil total height", 12, 38, 25, "in"),
      _svcYn("fc.heat", "Electric heat installed?", "info"),
      _svcText("fc.kw", "Heat size (kW)", { ph: "kW", showIf: { k: "fc.heat", v: true } }),
      _svcYn("fc.power", "Common power for fan coil & heat?", "info"),
      _svcYn("fc.attic", "Fits attic opening (no door removal)?"),
      _svcYn("fc.uvc", "UV-C light present?", "info"),
    ]),
  },
  {
    key: "furn", title: "Furnace", icon: "🔥", color: "#d9701a",
    items: [
      _svcPhoto("furn.photos", "Serial plate photos"),
      _svcText("furn.model", "Model #", { sys: "furnace_air_handler", ph: "Furnace model number", caps: true }),
      _svcSel("furn.flue", "Flue type", [["pvc", "PVC vent (90%)"], ["bvent", "B-vent (80%)"]]),
      _svcSel("furn.size", "Furnace size", _SVC_CABINETS),
      _svcYn("furn.gas", "Gas connections normal?"),
      _svcYn("furn.tap", "Speed tap checked?"),
      _svcYn("furn.stand", "Furnace on heater stand?", "info"),
      _svcYn("furn.lowv", "Low-voltage wiring OK?"),
    ],
  },
  {
    key: "plen", title: "Plenum", icon: "📦", color: "#a3446e",
    items: [
      _svcYn("plen.match", "Plenum sizes match cabinets?"),
      { t: "ducts", k: "plen.ducts", q: "Duct sizes", min: 4, max: 24, def: 12, addLabel: "+ Add duct", noun: "Duct" },
      _svcYn("plen.fresh", "Fresh air duct present?", "info"),
      { t: "ducts", k: "plen.fresh_sizes", q: "Fresh air duct size", min: 4, max: 24, def: 12, addLabel: "+ Add fresh air duct", noun: "Fresh air", showIf: { k: "plen.fresh", v: true } },
      _svcYn("plen.zone", "Zoning system?", "info"),
    ],
  },
];

const _SVC_ITEM_BY_KEY = {};
SAA_SVC_SECTIONS.forEach((s) => s.items.forEach((it) => { it.sec = s.key; _SVC_ITEM_BY_KEY[it.k] = it; }));

/* ---------------- Answer helpers (shared with the print) ---------------- */

function _svcEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function _svcVisible(item, ans) { return !item.showIf || ans[item.showIf.k] === item.showIf.v; }
function _svcRecorded(item, ans) {
  const v = ans[item.k];
  if (item.t === "ducts") return Array.isArray(v) && v.length > 0;
  if (item.t === "photo") return Array.isArray(v) && v.length > 0;
  return !(v === undefined || v === null || v === "");
}
function _svcOptLabel(item, val) {
  const o = (item.opts || []).find((x) => x[0] === val);
  return o ? o[1] : val;
}
/** Yes/No answer that deserves attention (the unfavourable answer). */
function _svcFlagged(item, v) {
  if (item.t !== "yn" || typeof v !== "boolean") return false;
  return (item.tone === "good" && v === false) || (item.tone === "bad" && v === true);
}
/** { recorded, text, flag } -- used by the print; unrecorded => "Not Recorded". */
function saaSvcAnswerText(item, ans) {
  if (!_svcRecorded(item, ans)) return { recorded: false, text: "Not Recorded", flag: false };
  const v = ans[item.k];
  switch (item.t) {
    case "yn": return { recorded: true, text: v ? "Yes" : "No", flag: _svcFlagged(item, v) };
    case "select": return { recorded: true, text: _svcOptLabel(item, v), flag: false };
    case "slider": return { recorded: true, text: `${v}${item.unit ? " " + item.unit : ""}`, flag: false };
    case "ducts": return { recorded: true, text: v.map((n) => n + '"').join(", "), flag: false };
    default: return { recorded: true, text: String(v), flag: false };
  }
}
function _svcProgress(sec, ans) {
  let done = 0, total = 0;
  sec.items.forEach((it) => {
    if (it.t === "photo" || !_svcVisible(it, ans)) return;
    total++;
    if (_svcRecorded(it, ans)) done++;
  });
  return { done, total };
}
function _svcTotals(ans) {
  let done = 0, total = 0;
  SAA_SVC_SECTIONS.forEach((s) => { const p = _svcProgress(s, ans); done += p.done; total += p.total; });
  return { done, total };
}

/* ---------------- Row markup ---------------- */

function _svcDuctRowHtml(item, i, val) {
  return `<div class="svc-duct" data-i="${i}">
    <span class="svc-duct-n">${_svcEsc(item.noun)} ${i + 1}</span>
    <button type="button" class="svc-step" data-d="-1" aria-label="Smaller">&minus;</button>
    <input type="range" class="svc-range" min="${item.min}" max="${item.max}" step="1" value="${val}">
    <button type="button" class="svc-step" data-d="1" aria-label="Larger">+</button>
    <output class="svc-val">${val}"</output>
    <button type="button" class="svc-duct-x" aria-label="Remove">&times;</button>
  </div>`;
}
function _svcDuctListHtml(item, ans) {
  const list = Array.isArray(ans[item.k]) ? ans[item.k] : [];
  return list.map((v, i) => _svcDuctRowHtml(item, i, v)).join("") || `<span class="svc-none">Not recorded</span>`;
}
function _svcThumbsHtml(item, ans) {
  const ids = Array.isArray(ans[item.k]) ? ans[item.k] : [];
  const photos = (typeof _jbePhotos !== "undefined" ? _jbePhotos : []).filter((p) => ids.includes(p.id));
  return photos.map((p) => `<div class="svc-thumb"><img src="${_svcEsc(p.url)}" alt="Serial plate"><button type="button" class="svc-thumb-x" data-id="${_svcEsc(p.id)}" aria-label="Delete photo">&times;</button></div>`).join("");
}

function _svcRowHtml(item, ans) {
  const rec = _svcRecorded(item, ans);
  const v = ans[item.k];
  const hid = _svcVisible(item, ans) ? "" : " hidden";
  const k = _svcEsc(item.k);
  const q = _svcEsc(item.q);
  switch (item.t) {
    case "yn": {
      const cls = v === true ? " is-set is-yes" : v === false ? " is-set is-no" : "";
      const flag = _svcFlagged(item, v) ? " is-flag" : "";
      return `<div class="svc-row svc-yn tone-${item.tone}${cls}${flag}" data-k="${k}" data-t="yn"${hid}>
        <div class="svc-q">${q}</div>
        <div class="svc-toggle" role="group" aria-label="${q}">
          <button type="button" class="svc-no" data-v="0" aria-pressed="${v === false}">No</button>
          <button type="button" class="svc-yes" data-v="1" aria-pressed="${v === true}">Yes</button>
        </div>
      </div>`;
    }
    case "select": {
      const ph = item.def ? `${_svcOptLabel(item, item.def)} (default)` : "Select…";
      return `<div class="svc-row svc-sel${rec ? " is-set" : ""}" data-k="${k}" data-t="select"${hid}>
        <label class="svc-q" for="svc-f-${k}">${q}</label>
        <select id="svc-f-${k}" class="svc-sel-input${rec ? "" : " is-unset"}">
          <option value=""${rec ? "" : " selected"}>${_svcEsc(ph)}</option>
          ${item.opts.map(([val, lab]) => `<option value="${_svcEsc(val)}"${v === val ? " selected" : ""}>${_svcEsc(lab)}</option>`).join("")}
        </select>
      </div>`;
    }
    case "text":
      return `<div class="svc-row svc-text${item.half ? " svc-half" : ""}${rec ? " is-set" : ""}" data-k="${k}" data-t="text"${hid}>
        <label class="svc-q" for="svc-f-${k}">${q}</label>
        <input id="svc-f-${k}" type="text" class="svc-in" value="${_svcEsc(rec ? v : "")}" placeholder="${_svcEsc(item.ph || "")}" autocomplete="off" autocorrect="off" spellcheck="false"${item.caps ? ' autocapitalize="characters"' : ""}>
      </div>`;
    case "slider": {
      const shown = rec ? v : item.def;
      const stepsBig = item.big ? `<button type="button" class="svc-step svc-step-big" data-d="-10" aria-label="Minus 10">&minus;10</button>` : "";
      const stepsBigUp = item.big ? `<button type="button" class="svc-step svc-step-big" data-d="10" aria-label="Plus 10">+10</button>` : "";
      return `<div class="svc-row svc-slider${rec ? " is-set" : ""}" data-k="${k}" data-t="slider"${hid}>
        <div class="svc-q">${q}${item.unit ? ` <span class="svc-unit">(${_svcEsc(item.unit)})</span>` : ""}
          <button type="button" class="svc-clear" aria-label="Clear" title="Clear (Not Recorded)"${rec ? "" : " hidden"}>&times;</button></div>
        <div class="svc-sl">
          ${stepsBig}<button type="button" class="svc-step" data-d="-1" aria-label="Minus 1">&minus;</button>
          <input type="range" class="svc-range" min="${item.min}" max="${item.max}" step="1" value="${shown}">
          <button type="button" class="svc-step" data-d="1" aria-label="Plus 1">+</button>${stepsBigUp}
          <output class="svc-val">${shown}</output>
        </div>
      </div>`;
    }
    case "ducts":
      return `<div class="svc-row svc-ducts${rec ? " is-set" : ""}" data-k="${k}" data-t="ducts"${hid}>
        <div class="svc-q">${q} <span class="svc-unit">(in)</span></div>
        <div class="svc-duct-list">${_svcDuctListHtml(item, ans)}</div>
        <button type="button" class="btn btn-ghost btn-sm svc-add">${_svcEsc(item.addLabel)}</button>
      </div>`;
    case "photo":
      return `<div class="svc-row svc-photo" data-k="${k}" data-t="photo"${hid}>
        <div class="svc-q">${q}</div>
        <button type="button" class="btn btn-navy btn-sm svc-cam">📷 Take photo</button>
        <div class="svc-thumbs">${_svcThumbsHtml(item, ans)}</div>
      </div>`;
  }
  return "";
}

function _svcBodyHtml(ans) {
  return SAA_SVC_SECTIONS.map((s) => {
    const p = _svcProgress(s, ans);
    return `<section class="svc-sec" id="svc-sec-${s.key}" data-sec="${s.key}" style="--sc:${s.color}">
      <h4 class="svc-sec-h"><span>${s.icon} ${_svcEsc(s.title)}</span><span class="svc-sec-count" id="svc-count-${s.key}">${p.done}/${p.total}</span></h4>
      <div class="svc-grid">${s.items.map((it) => _svcRowHtml(it, ans)).join("")}</div>
    </section>`;
  }).join("");
}

/* ---------------- State ---------------- */

let _svcEvent = null;
let _svcAnswers = {};
let _svcTimer = null;
let _svcChain = Promise.resolve();
let _svcSysPending = {};
let _svcSysTouched = false;

function _svcSetState(state, text) {
  const el = document.getElementById("svc-save-state");
  if (!el) return;
  el.className = "svc-save-state" + (state ? " is-" + state : "");
  el.textContent = text || "";
}

function _svcSysValue(item, val) {
  if (val === undefined || val === null || val === "") return null;
  if (item.k === "cond.oem") return _svcOptLabel(item, val);
  if (item.sys === "system_orientation") return val === "upflow" ? "Upflow" : val === "downflow" ? "Downflow" : "Horizontal";
  return String(val).trim() || null;
}

function _svcQueueSave() {
  _svcSetState("pending", "Unsaved changes…");
  clearTimeout(_svcTimer);
  _svcTimer = setTimeout(() => { _svcTimer = null; _svcChain = _svcChain.then(_svcSaveNow).catch(() => {}); }, 500);
}

async function _svcSaveNow() {
  const ev = _svcEvent;
  if (!ev || !ev.id) return;
  _svcSetState("saving", "Saving…");
  const snapshot = JSON.parse(JSON.stringify(_svcAnswers));
  const res = await saaEventsUpdate(ev.id, { service_checklist: snapshot });
  if (!res.ok) { _svcSetState("error", "Not saved: " + res.error); return; }
  ev.service_checklist = snapshot;
  if (typeof _jbEventModalTarget !== "undefined" && _jbEventModalTarget && _jbEventModalTarget.id === ev.id) _jbEventModalTarget.service_checklist = snapshot;

  // Model #s / OEM / orientation go to the System too (only when actually set;
  // clearing an answer never blanks what's already on the System).
  const patch = {};
  Object.keys(_svcSysPending).forEach((k) => {
    const item = _SVC_ITEM_BY_KEY[k];
    const val = item ? _svcSysValue(item, snapshot[k]) : null;
    if (val) patch[item.sys] = val;
  });
  _svcSysPending = {};
  const systemId = ev.system_id || (typeof _jbCurrentJob !== "undefined" && _jbCurrentJob ? _jbCurrentJob.system_id : null);
  // Round 69: brand / model numbers belong to the Condenser / Coil / Furnace
  // cards (System & Equipment is one section, entered once); the System's own
  // manufacturer / model columns are only a mirror of those. So they are
  // written to the equipment cards first, and mirrored to the System below.
  const eqPatch = {};
  const put = (type, col, v) => { if (v) (eqPatch[type] = eqPatch[type] || {})[col] = v; };
  put("condenser", "brand", patch.manufacturer);
  put("condenser", "model", patch.outdoor_unit);
  put("coil", "model", patch.coil);
  put("furnace", "model", patch.indoor_unit);
  put("furnace", "model", patch.furnace_air_handler);
  const customerId = ev.customer_id || (typeof _jbCurrentJob !== "undefined" && _jbCurrentJob ? _jbCurrentJob.customer_id : null);
  if (customerId && typeof saaJobsPatchEquipmentByType === "function") {
    for (const type of Object.keys(eqPatch)) {
      const er = await saaJobsPatchEquipmentByType(customerId, type, eqPatch[type], systemId);
      if (!er.ok) { _svcSetState("error", "Saved, but equipment not updated: " + er.error); return; }
      _svcSysTouched = true;
    }
  }
  if (Object.keys(patch).length && systemId && typeof saaSystemsUpdate === "function") {
    const sr = await saaSystemsUpdate(systemId, patch);
    if (!sr.ok) { _svcSetState("error", "Saved, but System not updated: " + sr.error); return; }
    _svcSysTouched = true;
  }
  _svcSetState("saved", "All changes saved");
}

async function _svcFlush() {
  if (_svcTimer) { clearTimeout(_svcTimer); _svcTimer = null; _svcChain = _svcChain.then(_svcSaveNow).catch(() => {}); }
  await _svcChain;
}

/* ---------------- Live updates ---------------- */

function _svcRefreshCounts() {
  SAA_SVC_SECTIONS.forEach((s) => {
    const p = _svcProgress(s, _svcAnswers);
    const c = document.getElementById(`svc-count-${s.key}`);
    if (c) c.textContent = `${p.done}/${p.total}`;
    const tab = document.getElementById(`svc-tab-${s.key}`);
    if (tab) {
      tab.querySelector(".svc-tab-n").textContent = `${p.done}/${p.total}`;
      tab.classList.toggle("is-done", p.total > 0 && p.done === p.total);
    }
  });
  const t = _svcTotals(_svcAnswers);
  const el = document.getElementById("svc-total");
  if (el) el.textContent = `${t.done} of ${t.total} answered`;
  const bar = document.getElementById("svc-bar-fill");
  if (bar) bar.style.width = (t.total ? Math.round((t.done / t.total) * 100) : 0) + "%";
}

function _svcSyncRow(row) {
  const item = _SVC_ITEM_BY_KEY[row.dataset.k];
  if (!item) return;
  const v = _svcAnswers[item.k];
  const rec = _svcRecorded(item, _svcAnswers);
  switch (item.t) {
    case "yn":
      row.classList.toggle("is-set", typeof v === "boolean");
      row.classList.toggle("is-yes", v === true);
      row.classList.toggle("is-no", v === false);
      row.classList.toggle("is-flag", _svcFlagged(item, v));
      row.querySelector(".svc-no").setAttribute("aria-pressed", String(v === false));
      row.querySelector(".svc-yes").setAttribute("aria-pressed", String(v === true));
      break;
    case "select": {
      row.classList.toggle("is-set", rec);
      const sel = row.querySelector("select");
      sel.classList.toggle("is-unset", !rec);
      sel.value = rec ? v : "";
      break;
    }
    case "text":
      row.classList.toggle("is-set", rec);
      break;
    case "slider": {
      row.classList.toggle("is-set", rec);
      const shown = rec ? v : item.def;
      row.querySelector(".svc-range").value = shown;
      row.querySelector(".svc-val").textContent = shown;
      row.querySelector(".svc-clear").hidden = !rec;
      break;
    }
    case "ducts":
      row.classList.toggle("is-set", rec);
      row.querySelector(".svc-duct-list").innerHTML = _svcDuctListHtml(item, _svcAnswers);
      break;
    case "photo":
      row.querySelector(".svc-thumbs").innerHTML = _svcThumbsHtml(item, _svcAnswers);
      break;
  }
}

/** Record (or clear, with undefined/""/[]) one answer, then update the UI + save. */
function _svcSet(k, val) {
  const item = _SVC_ITEM_BY_KEY[k];
  const empty = val === undefined || val === null || val === "" || (Array.isArray(val) && !val.length);
  if (empty) delete _svcAnswers[k]; else _svcAnswers[k] = val;
  if (item && item.sys) _svcSysPending[k] = true;
  const row = document.querySelector(`#jb-svc-body .svc-row[data-k="${k}"]`);
  if (row && document.activeElement !== row.querySelector(".svc-in")) _svcSyncRow(row);
  else if (row) row.classList.toggle("is-set", !empty);
  // Rows that depend on this answer (e.g. kW box, fresh-air sizes).
  document.querySelectorAll("#jb-svc-body .svc-row").forEach((r) => {
    const it = _SVC_ITEM_BY_KEY[r.dataset.k];
    if (it && it.showIf && it.showIf.k === k) r.hidden = !_svcVisible(it, _svcAnswers);
  });
  _svcRefreshCounts();
  _svcQueueSave();
}

/* ---------------- Interactions ---------------- */

function _svcClamp(item, n) { return Math.max(item.min, Math.min(item.max, n)); }

function _svcOnBodyClick(e) {
  const row = e.target.closest(".svc-row");
  if (!row) return;
  const item = _SVC_ITEM_BY_KEY[row.dataset.k];
  if (!item) return;

  const tog = e.target.closest(".svc-toggle button");
  if (tog) {
    const want = tog.dataset.v === "1";
    _svcSet(item.k, _svcAnswers[item.k] === want ? undefined : want); // tapping the chosen side again clears it
    return;
  }
  const step = e.target.closest(".svc-step");
  if (step) {
    const d = parseInt(step.dataset.d, 10);
    if (item.t === "ducts") {
      const duct = step.closest(".svc-duct");
      const i = parseInt(duct.dataset.i, 10);
      const list = (_svcAnswers[item.k] || []).slice();
      list[i] = _svcClamp(item, list[i] + d);
      _svcSet(item.k, list);
    } else {
      const cur = _svcRecorded(item, _svcAnswers) ? _svcAnswers[item.k] : item.def;
      _svcSet(item.k, _svcClamp(item, cur + d));
    }
    return;
  }
  if (e.target.closest(".svc-clear")) { _svcSet(item.k, undefined); return; }
  if (e.target.closest(".svc-add")) {
    _svcSet(item.k, (_svcAnswers[item.k] || []).concat([item.def]));
    return;
  }
  const dx = e.target.closest(".svc-duct-x");
  if (dx) {
    const i = parseInt(dx.closest(".svc-duct").dataset.i, 10);
    const list = (_svcAnswers[item.k] || []).slice();
    list.splice(i, 1);
    _svcSet(item.k, list);
    return;
  }
  if (e.target.closest(".svc-cam")) { _svcTakePhoto(item); return; }
  const tx = e.target.closest(".svc-thumb-x");
  if (tx) _svcDeletePhoto(item, tx.dataset.id);
}

function _svcOnBodyInput(e) {
  const row = e.target.closest(".svc-row");
  if (!row) return;
  const item = _SVC_ITEM_BY_KEY[row.dataset.k];
  if (!item) return;
  if (e.target.classList.contains("svc-range")) {
    const n = parseInt(e.target.value, 10);
    if (item.t === "ducts") {
      const duct = e.target.closest(".svc-duct");
      const i = parseInt(duct.dataset.i, 10);
      const list = (_svcAnswers[item.k] || []).slice();
      list[i] = n;
      _svcAnswers[item.k] = list;
      duct.querySelector(".svc-val").textContent = n + '"';
      _svcQueueSave();
    } else {
      // In place only -- re-rendering the slider mid-drag would drop the drag.
      _svcAnswers[item.k] = n;
      row.classList.add("is-set");
      row.querySelector(".svc-val").textContent = n;
      row.querySelector(".svc-clear").hidden = false;
      _svcRefreshCounts();
      _svcQueueSave();
    }
  } else if (e.target.classList.contains("svc-in")) {
    const val = e.target.value.trim();
    if (val) _svcAnswers[item.k] = e.target.value; else delete _svcAnswers[item.k];
    if (item.sys) _svcSysPending[item.k] = true;
    row.classList.toggle("is-set", !!val);
    _svcRefreshCounts();
    _svcQueueSave();
  }
}

function _svcOnBodyChange(e) {
  if (!e.target.classList.contains("svc-sel-input")) return;
  const row = e.target.closest(".svc-row");
  _svcSet(row.dataset.k, e.target.value);
}

async function _svcTakePhoto(item) {
  const ev = _svcEvent;
  if (!ev || !ev.id) return;
  saaCamOpen(async (blobs) => {
    const ids = (_svcAnswers[item.k] || []).slice();
    let ok = 0;
    for (const blob of blobs) {
      const res = await saaPhotosUpload(ev.job_id, blob, null, "general", ev.id);
      if (res.ok) {
        _jbePhotos.push(res.photo);
        ids.push(res.photo.id);
        ok++;
      } else {
        _jbToast(res.error, true);
      }
    }
    if (ok) {
      _svcSet(item.k, ids);
      if (typeof jbeRenderPhotoGrid === "function") jbeRenderPhotoGrid();
      _jbToast(`${ok} photo${ok === 1 ? "" : "s"} saved to this event.`);
    }
  }, `${(SAA_SVC_SECTIONS.find((s) => s.key === item.sec) || {}).title || ""} serial plate`);
}

async function _svcDeletePhoto(item, id) {
  const photo = _jbePhotos.find((p) => p.id === id);
  if (!photo) return;
  const res = await saaPhotosDelete(photo);
  if (!res.ok) { _jbToast(res.error, true); return; }
  _jbePhotos = _jbePhotos.filter((p) => p.id !== id);
  _svcSet(item.k, (_svcAnswers[item.k] || []).filter((x) => x !== id));
  if (typeof jbeRenderPhotoGrid === "function") jbeRenderPhotoGrid();
}

function _svcOnScroll() {
  const card = document.querySelector("#jb-svc-modal .svc-card");
  if (!card) return;
  const cardTop = card.getBoundingClientRect().top;
  let active = SAA_SVC_SECTIONS[0].key;
  SAA_SVC_SECTIONS.forEach((s) => {
    const el = document.getElementById(`svc-sec-${s.key}`);
    if (el && el.getBoundingClientRect().top - cardTop < 150) active = s.key;
  });
  SAA_SVC_SECTIONS.forEach((s) => document.getElementById(`svc-tab-${s.key}`).classList.toggle("is-active", s.key === active));
}

/* ---------------- Open / close ---------------- */

function saaSvcOpen() {
  const ev = (typeof _jbEventModalTarget !== "undefined") ? _jbEventModalTarget : null;
  if (!ev || !ev.id) { _jbToast("Create this event first, then fill in the checklist.", true); return; }
  _svcEvent = ev;
  _svcAnswers = JSON.parse(JSON.stringify(ev.service_checklist || {}));
  _svcSysPending = {};
  _svcSysTouched = false;

  const job = typeof _jbCurrentJob !== "undefined" ? _jbCurrentJob : null;
  const cust = job && job.customer ? _jbCustName(job.customer) : "";
  const addr = [ev.service_address || (job && job.job_address), ev.service_city || (job && job.job_city)].filter(Boolean).join(", ");
  document.getElementById("svc-head-sub").textContent = [ev.event_number, cust, addr].filter(Boolean).join(" · ");
  document.getElementById("svc-tabs").innerHTML = SAA_SVC_SECTIONS.map((s) =>
    `<button type="button" class="svc-tab" id="svc-tab-${s.key}" data-sec="${s.key}" style="--sc:${s.color}">${s.icon} ${_svcEsc(s.title)} <span class="svc-tab-n"></span></button>`).join("");
  document.getElementById("jb-svc-body").innerHTML = _svcBodyHtml(_svcAnswers);
  _svcRefreshCounts();
  _svcSetState("saved", "Changes save automatically");
  document.getElementById("jb-svc-modal").hidden = false;
  document.querySelector("#jb-svc-modal .svc-card").scrollTop = 0;
  _svcOnScroll();
}

async function saaSvcClose() {
  const modal = document.getElementById("jb-svc-modal");
  if (!modal || modal.hidden) return;
  await _svcFlush();
  modal.hidden = true;
  _svcEvent = null;
  if (typeof saaSvcRefreshEventSection === "function") saaSvcRefreshEventSection();
  if (_svcSysTouched && typeof _jbCurrentJob !== "undefined" && _jbCurrentJob) {
    if (typeof jbRenderSystemSection === "function") jbRenderSystemSection(_jbCurrentJob);
    if (typeof jbReloadEquipment === "function") jbReloadEquipment(); // Round 69: refresh the Condenser / Coil / Furnace cards
  }
  _svcSysTouched = false;
}

/* ---------------- Event card section ---------------- */

/** Shows/hides the Event card's "Service Call Checklist" section (Service
 *  Call events only) and refreshes its progress chips. */
function saaSvcRefreshEventSection() {
  const sec = document.getElementById("jbe-svc-section");
  if (!sec) return;
  const typeSel = document.getElementById("jbe-type");
  const isService = typeSel && typeSel.value === "service_call";
  sec.hidden = !isService;
  if (!isService) return;
  const ev = (typeof _jbEventModalTarget !== "undefined") ? _jbEventModalTarget : null;
  const saved = !!(ev && ev.id);
  const ans = (ev && ev.service_checklist) || {};
  const t = _svcTotals(ans);
  document.getElementById("jbe-svc-progress").textContent = `${t.done}/${t.total}`;
  document.getElementById("jbe-svc-chips").innerHTML = SAA_SVC_SECTIONS.map((s) => {
    const p = _svcProgress(s, ans);
    return `<span class="svc-chip${p.total && p.done === p.total ? " is-done" : ""}" style="--sc:${s.color}">${s.icon} ${_svcEsc(s.title)} <b>${p.done}/${p.total}</b></span>`;
  }).join("");
  document.getElementById("jbe-svc-open-btn").disabled = !saved;
  document.getElementById("jbe-svc-print-btn").disabled = !saved;
  document.getElementById("jbe-svc-hint").textContent = saved
    ? (t.done ? "Tap to continue the checklist." : "Tap to start. Every answer saves as you go.")
    : "Create this event first, then fill in the checklist.";
}

/* ---------------- Print ---------------- */

function saaSvcPrint() {
  const modalOpen = _svcEvent && !document.getElementById("jb-svc-modal").hidden;
  const ev = modalOpen ? _svcEvent : ((typeof _jbEventModalTarget !== "undefined") ? _jbEventModalTarget : null);
  if (!ev || !ev.id) { _jbToast("Create this event first.", true); return; }
  const ans = modalOpen ? _svcAnswers : (ev.service_checklist || {});
  const job = typeof _jbCurrentJob !== "undefined" ? _jbCurrentJob : null;
  const cust = job && job.customer ? job.customer : null;
  const techs = [ev.technician, ev.technician2, ev.technician3].filter(Boolean).map((t) => t.name);
  if (!techs.length && job) {
    // Event may not be hydrated with technician objects -- fall back to ids.
    const ids = [ev.assigned_technician_id, ev.assigned_technician_id_2, ev.assigned_technician_id_3].filter(Boolean);
    (typeof _jbTechnicians !== "undefined" ? _jbTechnicians : []).forEach((t) => { if (ids.includes(t.id)) techs.push(t.name); });
  }
  const addr = [ev.service_address || (job && job.job_address), ev.service_city || (job && job.job_city), ev.service_state || (job && job.job_state), ev.service_zip || (job && job.job_zip)].filter(Boolean).join(", ");
  let when = "";
  const wc = typeof saaEventsWallClock === "function" ? saaEventsWallClock(ev.scheduled_start) : null;
  if (wc) when = wc.local.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  printServiceChecklist({
    eventNumber: ev.event_number || "",
    jobNumber: job ? (job.job_number || "") : "",
    customer: cust ? _jbCustName(cust) : "",
    phone: cust ? cust.phone : "",
    address: addr,
    technicians: techs.join(", "),
    date: when,
    answers: ans,
  });
}

/* ---------------- Wire up ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("jb-svc-modal");
  if (!modal) return;
  const body = document.getElementById("jb-svc-body");
  body.addEventListener("click", _svcOnBodyClick);
  body.addEventListener("input", _svcOnBodyInput);
  body.addEventListener("change", _svcOnBodyChange);
  document.getElementById("svc-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".svc-tab");
    if (!tab) return;
    const el = document.getElementById(`svc-sec-${tab.dataset.sec}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  modal.querySelector(".svc-card").addEventListener("scroll", _svcOnScroll, { passive: true });
  document.getElementById("svc-done-btn").addEventListener("click", saaSvcClose);
  document.getElementById("svc-done-bottom-btn").addEventListener("click", saaSvcClose);
  document.getElementById("svc-print-btn").addEventListener("click", saaSvcPrint);
  modal.addEventListener("click", (e) => { if (e.target === modal) saaSvcClose(); });

  const openBtn = document.getElementById("jbe-svc-open-btn");
  if (openBtn) openBtn.addEventListener("click", saaSvcOpen);
  const printBtn = document.getElementById("jbe-svc-print-btn");
  if (printBtn) printBtn.addEventListener("click", saaSvcPrint);
  const typeSel = document.getElementById("jbe-type");
  if (typeSel) typeSel.addEventListener("change", saaSvcRefreshEventSection);
});
