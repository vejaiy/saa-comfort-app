/* ============================================================
   SAA Comfort Air LLC — Global search (Round 113, Phase 2)
   One search box for every employee page. Finds Customers, Systems,
   Jobs, Events, Invoices and Quotes together and jumps to the record.
   Open it with the magnifier in the header, or press "/" or Ctrl/Cmd+K.

   Every word typed must match somewhere in the record (any order), so
   "sriram 2026" or "carrier 5 ton" both work. Phone numbers match
   on digits only ("2815551234" finds "(281) 555-1234").
   Data is loaded once per page (cached 60 s) and filtered in the browser.
   ============================================================ */
(function () {
  "use strict";
  var CACHE_MS = 60000, MAX_PER_GROUP = 6;
  var _data = null, _loadedAt = 0, _loading = null, _sel = -1, _results = [];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function digits(s) { return String(s || "").replace(/\D/g, ""); }
  function nameOf(c) { return c ? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.company_name || "") : ""; }
  function money(n) { return "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dt(d) { return d ? String(d).slice(0, 10) : ""; }
  function label(s) { return String(s || "").replace(/_/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }

  async function fetchTable(table, cols) {
    try {
      var r = await _saaClient.from(table).select(cols);
      return (r && r.data) || [];
    } catch (e) { return []; }
  }

  async function load() {
    if (_data && Date.now() - _loadedAt < CACHE_MS) return _data;
    if (_loading) return _loading;
    _loading = (async function () {
      var res = await Promise.all([
        fetchTable("customers", "id,first_name,last_name,company_name,phone,email,billing_address,billing_city,billing_zip,notes"),
        fetchTable("systems", "id,customer_id,system_name,system_type,manufacturer,model_number,serial_number,tonnage,refrigerant,system_location,notes"),
        fetchTable("jobs", "id,customer_id,system_id,job_number,title,job_type,status,job_address,job_city,job_zip,problem_description,scheduled_date,is_current,created_at"),
        fetchTable("events", "id,job_id,customer_id,system_id,event_number,event_type,event_status,reason,description,scheduled_start,service_address,service_city,service_zip,technician_notes,work_performed,parts_used"),
        fetchTable("invoices", "id,invoice_number,job_id,event_id,customer_id,issue_date,amount_total,discount,additional_charges,status,notes"),
        fetchTable("quotes", "id,quote_number,job_id,event_id,customer_id,quote_type,status,total,job_address,created_at")
      ]);
      var custById = {}; res[0].forEach(function (c) { custById[c.id] = c; });
      var jobById = {}; res[2].forEach(function (j) { jobById[j.id] = j; });
      _data = { customers: res[0], systems: res[1], jobs: res[2], events: res[3], invoices: res[4], quotes: res[5], custById: custById, jobById: jobById };
      _loadedAt = Date.now();
      return _data;
    })();
    try { return await _loading; } finally { _loading = null; }
  }

  // ---- matching -------------------------------------------------------
  function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }
  function matches(hay, digitHay, toks) {
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (hay.indexOf(t) >= 0) continue;
      var d = digits(t);
      if (d.length >= 3 && d === t.replace(/[\s()\-.+]/g, "") && digitHay.indexOf(d) >= 0) continue;
      return false;
    }
    return true;
  }
  function hl(text, toks) {
    var out = esc(text);
    toks.forEach(function (t) {
      if (t.length < 2) return;
      var re = new RegExp("(" + esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      out = out.replace(re, "<mark>$1</mark>");
    });
    return out;
  }

  function search(q) {
    var d = _data, toks = tokens(q), groups = [];
    if (!d || !toks.length) return groups;
    function cname(id) { return nameOf(d.custById[id]); }
    function run(kind, rows, build) {
      var hits = [];
      rows.forEach(function (r) {
        var b = build(r);
        var hay = b.hay.filter(Boolean).join(" ").toLowerCase();
        if (matches(hay, digits(b.hay.join(" ")), toks)) hits.push(b);
      });
      if (hits.length) groups.push({ kind: kind, total: hits.length, items: hits.slice(0, MAX_PER_GROUP) });
    }
    run("Customers", d.customers, function (c) {
      return {
        title: nameOf(c) || "(no name)",
        sub: [c.phone ? (window.saaFormatPhone ? saaFormatPhone(c.phone) : c.phone) : "", c.email, [c.billing_address, c.billing_city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        href: "customers.html?customer=" + encodeURIComponent(c.id),
        hay: [c.first_name, c.last_name, c.company_name, c.phone, c.email, c.billing_address, c.billing_city, c.billing_zip, c.notes]
      };
    });
    run("Systems", d.systems, function (s) {
      var cn = cname(s.customer_id);
      // open the system's current job (else its most recent job); no job -> the customer
      var jobs = d.jobs.filter(function (j) { return j.system_id === s.id; });
      var job = jobs.filter(function (j) { return j.is_current; })[0] || jobs.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })[0];
      return {
        title: [s.manufacturer, s.system_name || s.system_type, s.tonnage ? s.tonnage + " ton" : ""].filter(Boolean).join(" ") || "System",
        sub: [cn, s.model_number ? "Model " + s.model_number : "", s.serial_number ? "S/N " + s.serial_number : "", s.system_location].filter(Boolean).join(" · "),
        href: job ? "jobs.html?job=" + encodeURIComponent(job.id) : "customers.html?customer=" + encodeURIComponent(s.customer_id || ""),
        hay: [s.system_name, s.system_type, s.manufacturer, s.model_number, s.serial_number, s.tonnage, s.tonnage ? s.tonnage + " ton" : "", s.refrigerant, s.system_location, s.notes, cn]
      };
    });
    run("Jobs", d.jobs, function (j) {
      var cn = cname(j.customer_id);
      return {
        title: (j.job_number || "Job") + (j.title ? " — " + j.title : ""),
        sub: [cn, label(j.job_type), label(j.status), [j.job_address, j.job_city].filter(Boolean).join(", ")].filter(Boolean).join(" · "),
        href: "jobs.html?job=" + encodeURIComponent(j.id),
        hay: [j.job_number, j.title, j.job_type, j.status, j.job_address, j.job_city, j.job_zip, j.problem_description, cn]
      };
    });
    run("Events", d.events, function (e) {
      var cn = cname(e.customer_id), job = d.jobById[e.job_id];
      return {
        title: (e.event_number || "Event") + " — " + label(e.event_type),
        sub: [cn, dt(e.scheduled_start), label(e.event_status), job && job.job_number ? "Job " + job.job_number : "", e.reason].filter(Boolean).join(" · "),
        href: e.job_id ? "jobs.html?job=" + encodeURIComponent(e.job_id) + "&event=" + encodeURIComponent(e.id) : "jobs.html",
        hay: [e.event_number, e.event_type, e.event_status, e.reason, e.description, e.technician_notes, e.work_performed, e.parts_used, e.service_address, e.service_city, e.service_zip, job && job.job_number, cn]
      };
    });
    run("Invoices", d.invoices, function (v) {
      var cn = cname(v.customer_id), due = (Number(v.amount_total) || 0) - (Number(v.discount) || 0) + (Number(v.additional_charges) || 0);
      return {
        title: v.invoice_number || "Invoice",
        sub: [cn, money(due), label(v.status), dt(v.issue_date)].filter(Boolean).join(" · "),
        href: "invoices.html?q=" + encodeURIComponent(v.invoice_number || ""),
        hay: [v.invoice_number, v.status, v.notes, cn]
      };
    });
    run("Quotes", d.quotes, function (q) {
      var cn = cname(q.customer_id);
      return {
        title: q.quote_number || "Quote",
        sub: [cn, label(q.quote_type), q.total ? money(q.total) : "", label(q.status)].filter(Boolean).join(" · "),
        href: "quotes.html?q=" + encodeURIComponent(q.quote_number || ""),
        hay: [q.quote_number, q.quote_type, q.status, q.job_address, cn]
      };
    });
    return groups;
  }

  // ---- UI -------------------------------------------------------------
  var overlay, input, body, hint;
  function build() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "gs-overlay"; overlay.hidden = true;
    overlay.innerHTML =
      '<div class="gs-box" role="dialog" aria-modal="true" aria-label="Search everything">' +
      '<div class="gs-head"><input id="gs-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search customers, systems, jobs, events, invoices, quotes…" aria-label="Search everything">' +
      '<button type="button" class="gs-x" id="gs-close" aria-label="Close search">&times;</button></div>' +
      '<div class="gs-body" id="gs-body"></div>' +
      '<div class="gs-hint" id="gs-hint">Type a name, phone, address, job #, invoice #, model or serial. &uarr;&darr; to move, Enter to open, Esc to close.</div></div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector("#gs-input"); body = overlay.querySelector("#gs-body"); hint = overlay.querySelector("#gs-hint");
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector("#gs-close").addEventListener("click", close);
    var timer = null;
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(render, 90); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); var r = _results[_sel >= 0 ? _sel : 0]; if (r) go(r.href); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
  }
  function go(href) { window.location.href = href; }
  function move(delta) {
    if (!_results.length) return;
    _sel = (_sel + delta + _results.length) % _results.length;
    paintSel();
  }
  function paintSel() {
    var rows = body.querySelectorAll(".gs-row");
    rows.forEach(function (r, i) { r.classList.toggle("is-sel", i === _sel); });
    if (rows[_sel]) rows[_sel].scrollIntoView({ block: "nearest" });
  }
  async function render() {
    var q = input.value.trim();
    _results = []; _sel = -1;
    if (!q) { body.innerHTML = ""; hint.hidden = false; return; }
    hint.hidden = true;
    body.innerHTML = '<div class="gs-msg">Searching…</div>';
    await load();
    if (input.value.trim() !== q) return;            // a newer keystroke is already rendering
    var groups = search(q), toks = tokens(q), html = "";
    if (!groups.length) { body.innerHTML = '<div class="gs-msg">No matches for “' + esc(q) + '”.</div>'; return; }
    groups.forEach(function (g) {
      html += '<div class="gs-group"><div class="gs-gh">' + g.kind + ' <span>' + g.total + (g.total > g.items.length ? " (showing " + g.items.length + ")" : "") + '</span></div>';
      g.items.forEach(function (it) {
        _results.push(it);
        html += '<a class="gs-row" href="' + esc(it.href) + '" data-i="' + (_results.length - 1) + '"><span class="gs-t">' + hl(it.title, toks) + '</span><span class="gs-s">' + hl(it.sub, toks) + '</span></a>';
      });
      html += "</div>";
    });
    body.innerHTML = html;
    _sel = 0; paintSel();
    body.querySelectorAll(".gs-row").forEach(function (a) {
      a.addEventListener("mousemove", function () { _sel = Number(a.dataset.i); paintSel(); });
    });
  }
  function open(prefill) {
    build();
    overlay.hidden = false; document.documentElement.classList.add("gs-open");
    input.value = prefill || ""; body.innerHTML = ""; hint.hidden = false; _sel = -1; _results = [];
    load();                       // warm the cache while the person starts typing
    setTimeout(function () { input.focus(); input.select(); }, 20);
    if (prefill) render();
  }
  function close() {
    if (!overlay) return;
    overlay.hidden = true; document.documentElement.classList.remove("gs-open");
  }
  window.saaGlobalSearchOpen = open;
  window._saaGlobalSearch = { search: search, load: load, tokens: tokens };

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gs-open]");
    if (b) { e.preventDefault(); open(); }
  });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName || "").toLowerCase(), typing = tag === "input" || tag === "textarea" || tag === "select" || (e.target && e.target.isContentEditable);
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(); }
    else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(); }
  });
})();
