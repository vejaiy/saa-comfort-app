/* ============================================================
   SAA Comfort Air LLC -- Service Call Checklist print (Round 68, 2026-09-28)
   Per Vijayan: "Add print button to print pdf of events service call
   checklist. No need to print pictures." and "...write 'Not Recorded' when
   printing" for anything the technician didn't touch. Same letterhead
   system and print-window approach as print-bom.js / print-quote.js
   (opens a window that calls window.print(); "Save as PDF" is the browser's
   own print dialog). Photos are never printed.
   Uses SAA_SVC_SECTIONS / saaSvcAnswerText from service-checklist.js.
   ============================================================ */

const SAA_SVC_PRINT_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _svcPrintEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _svcPrintStyle() {
  return `
  @page { size: letter; margin: 0.5in 0.55in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 11.5px; line-height: 1.35; margin: 0; }
  h1, h2, h3, h4 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 10px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .header .mark { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 36px; border-radius: 7px; background: #0f2439; color: #fff; font-weight: 800; font-size: .74rem; margin-bottom: 4px; }
  .header h1 { font-size: 1.15rem; color: #0f2439; }
  .header .sub, .header .contact { color: #55636e; font-size: .78rem; }
  .header .contact { text-align: right; }
  .title-row { display: flex; justify-content: space-between; align-items: baseline; margin: 4px 0 10px; }
  .title-row h2 { font-size: 1.3rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .title-row .prog { color: #55636e; font-size: .8rem; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin-bottom: 12px; }
  .meta .label { text-transform: uppercase; font-size: .62rem; letter-spacing: .4px; color: #55636e; font-weight: 700; }
  .meta .val { font-size: .86rem; }
  .meta .wide { grid-column: span 2; }
  section { margin-bottom: 12px; break-inside: auto; }
  section h3 { display: flex; justify-content: space-between; background: var(--sc); color: #fff; font-size: .8rem; text-transform: uppercase; letter-spacing: .5px; padding: 5px 9px; border-radius: 4px 4px 0 0; break-after: avoid; }
  section h3 small { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .95; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 8px; border-bottom: 1px solid #e3e9ed; vertical-align: top; }
  tr { break-inside: avoid; }
  td.q { width: 62%; }
  td.a { font-weight: 700; }
  td.a.nr { color: #8a97a3; font-weight: 400; font-style: italic; }
  td.a.yes { color: #1e7a3c; }
  td.a.no { color: #b3261e; }
  td.a.yes.flag, td.a.no.flag { color: #b3261e; }
  tr.flag td { background: #fdecea; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .72rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 14px; }
  section.pb { break-before: page; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1.4px solid #1a2733; border-radius: 2px; vertical-align: -1px; margin-right: 4px; }
  .box + .box, .yn-blank .box:not(:first-child) { margin-left: 8px; }
  .blank-line { display: inline-block; min-width: 110px; border-bottom: 1px solid #55636e; height: 12px; }
  .none { color: #55636e; font-style: italic; padding: 8px 4px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
}

function _svcBlankAnswer(item) {
  switch (item.t) {
    case "yn": return `<span class="yn-blank"><span class="box"></span>Yes <span class="box"></span>No</span>`;
    case "slider": return `<span class="blank-line"></span> ${_svcPrintEsc(item.unit || "")}`;
    case "ducts": return `<span class="blank-line"></span> in`;
    default: return `<span class="blank-line"></span>`;
  }
}

/** mode: all | answered | flagged | blank. Returns "" when a section has nothing to show. */
function _svcPrintSectionHtml(sec, ans, mode, pageBreak) {
  const rows = [];
  sec.items.forEach((item) => {
    if (item.t === "photo") return; // pictures are never printed
    if (mode !== "blank" && item.showIf && ans[item.showIf.k] !== item.showIf.v) return;
    if (mode === "blank") {
      rows.push(`<tr><td class="q">${_svcPrintEsc(item.q)}</td><td class="a">${_svcBlankAnswer(item)}</td></tr>`);
      return;
    }
    const a = saaSvcAnswerText(item, ans);
    if (mode === "answered" && !a.recorded) return;
    if (mode === "flagged" && !a.flag) return;
    const cls = !a.recorded ? "nr" : item.t === "yn" ? (ans[item.k] ? "yes" : "no") + (a.flag ? " flag" : "") : "";
    rows.push(`<tr${a.flag ? ' class="flag"' : ""}><td class="q">${_svcPrintEsc(item.q)}</td><td class="a ${cls}">${_svcPrintEsc(a.text)}</td></tr>`);
  });
  if (!rows.length) return "";
  const p = _svcProgress(sec, ans);
  const note = mode === "blank" ? "" : mode === "flagged" ? `<small>${rows.length} flagged</small>` : `<small>${p.done} of ${p.total} recorded</small>`;
  return `<section${pageBreak ? ' class="pb"' : ""} style="--sc:${sec.color}">
    <h3><span>${_svcPrintEsc(sec.title)}</span>${note}</h3>
    <table>${rows.join("")}</table>
  </section>`;
}

/**
 * opts: { eventNumber, jobNumber, customer, phone, address, technicians, date, answers }
 */
function printServiceChecklist(opts) {
  const info = SAA_SVC_PRINT_INFO;
  const ans = opts.answers || {};
  const t = _svcTotals(ans);
  // Round 75: print options -- which sections, and which questions.
  const po = Object.assign({ sections: SAA_SVC_SECTIONS.map((s) => s.key), mode: "all", pageBreaks: false }, opts.print || {});
  const chosen = SAA_SVC_SECTIONS.filter((s) => po.sections.includes(s.key));
  let first = true;
  let body = chosen.map((s) => {
    const h = _svcPrintSectionHtml(s, ans, po.mode, po.pageBreaks && !first);
    if (h) first = false;
    return h;
  }).join("");
  if (!body) body = `<div class="none">${po.mode === "flagged" ? "No flagged items in the selected sections." : "Nothing recorded in the selected sections."}</div>`;
  const titleNote = po.mode === "blank" ? " (blank form)" : po.mode === "flagged" ? " &mdash; flagged items" : po.mode === "answered" ? " &mdash; answered items" : "";
  const progNote = po.mode === "blank" ? "" : `${t.done} of ${t.total} items recorded`;
  const footNote = po.mode === "blank" ? "Fill in by hand." : po.mode === "all" ? 'Items marked "Not Recorded" were not filled in.' : (po.mode === "flagged" ? "Only answers needing attention are shown." : "Unanswered items are not shown.");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Service Call Checklist ${_svcPrintEsc(opts.eventNumber)} — ${info.name}</title>
<style>${_svcPrintStyle()}</style>
</head>
<body>
  <div class="header">
    <div><div class="mark">SAA</div><h1>${info.name}</h1><div class="sub">${info.license}</div></div>
    <div class="contact">${info.phone}<br>${info.email}<br>${info.address}</div>
  </div>
  <div class="rule"></div>
  <div class="title-row"><h2>Service Call Checklist${titleNote}</h2><span class="prog">${progNote}</span></div>
  <div class="meta">
    <div><div class="label">Event #</div><div class="val">${_svcPrintEsc(opts.eventNumber) || "&mdash;"}</div></div>
    <div><div class="label">Job #</div><div class="val">${_svcPrintEsc(opts.jobNumber) || "&mdash;"}</div></div>
    <div><div class="label">Date</div><div class="val">${_svcPrintEsc(opts.date) || "&mdash;"}</div></div>
    <div><div class="label">Customer</div><div class="val">${_svcPrintEsc(opts.customer) || "&mdash;"}${opts.phone ? ` &middot; ${_svcPrintEsc(typeof saaFormatPhone === "function" ? saaFormatPhone(opts.phone) : opts.phone)}` : ""}</div></div>
    <div class="wide"><div class="label">Service address</div><div class="val">${_svcPrintEsc(opts.address) || "&mdash;"}</div></div>
    <div class="wide"><div class="label">Technician(s)</div><div class="val">${_svcPrintEsc(opts.technicians) || "&mdash;"}</div></div>
  </div>
  ${body}
  <div class="footer"><span>Printed ${_svcPrintEsc(new Date().toLocaleString())}</span><span>${info.name} &middot; ${footNote}</span></div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };<\/script>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the checklist."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
