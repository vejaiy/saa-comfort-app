/* ============================================================
   SAA Comfort Air LLC — printable Tool List (Stock Counts)
   Same letterhead system as print-mileage-summary.js and print-bom.js.
   Round 37 (2026-09-17), per Vijayan's annotated Tool List dashboard-card
   screenshot: "Add 'print tool list' button to print in pdf" -- opens a
   formatted, letterhead print of whatever Stock Counts rows are currently
   on screen (respects the page's own Type/search filters, same as the
   on-screen table does). Printing to PDF is just the browser's own "Save
   as PDF" print destination, same as every other print function here.
   ============================================================ */

const SAA_TOOL_LIST_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _saaToolListEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * opts: { generatedOn, filterNote, rows: [{ item_name, category, type,
 *         quantity_on_hand, unit_of_measure, last_purchase_date, notes }] }
 */
function printToolList(opts) {
  const info = SAA_TOOL_LIST_INFO;
  const rowsHtml = (opts.rows || []).length
    ? opts.rows.map((r) => `
        <tr>
          <td>${_saaToolListEsc(r.item_name)}</td>
          <td>${_saaToolListEsc(r.category)}</td>
          <td>${_saaToolListEsc(r.type === "tools" ? "Tools" : r.type === "supplies" ? "Supplies" : r.type)}</td>
          <td class="num">${_saaToolListEsc(r.quantity_on_hand)}${r.unit_of_measure ? " " + _saaToolListEsc(r.unit_of_measure) : ""}</td>
          <td>${_saaToolListEsc(r.last_purchase_date)}</td>
          <td>${_saaToolListEsc(r.notes)}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="muted">No items on the stock list.</td></tr>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Tool List — ${info.name}</title>
<style>
  @page { size: letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 12px; line-height: 1.4; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header h1 { font-size: 1.2rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .8rem; }
  .header .contact { text-align: right; font-size: .8rem; color: #55636e; }
  .title-row { margin: 6px 0 14px; }
  .title-row h2 { font-size: 1.4rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .title-row .sub { color: #55636e; font-size: .84rem; margin-top: 2px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { text-align: left; font-size: .66rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 5px 4px; }
  table.items td { padding: 7px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  table.items td.num, table.items th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .muted { color: #55636e; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .74rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 24px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

  <div class="header">
    <div>
      <h1>${info.name}</h1>
      <div class="sub">${info.license}</div>
    </div>
    <div class="contact">
      ${info.phone}<br>
      ${info.email}<br>
      ${info.address}
    </div>
  </div>
  <div class="rule"></div>

  <div class="title-row">
    <h2>Tool List — Stock Counts</h2>
    <div class="sub">Generated ${_saaToolListEsc(opts.generatedOn)}${opts.filterNote ? " &mdash; " + _saaToolListEsc(opts.filterNote) : ""}</div>
  </div>

  <table class="items">
    <thead><tr><th>Item</th><th>Category</th><th>Type</th><th class="num">Qty on Hand</th><th>Last Purchased</th><th>Notes</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="footer">
    <div>${info.name} &mdash; Tool List</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the Tool List."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
