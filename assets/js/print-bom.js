/* ============================================================
   SAA Comfort Air LLC — Bill of Material / Order Form prints
   Same letterhead system as print-quote.js/print-invoice.js. Two
   documents share this file (Round 12, 2026-09-13 — "Add BOM button
   to create and print bill of material to order. Add order button
   in bill of material page. Order button will create order form
   with order number showing related quotation number and job
   number."):
     - printBillOfMaterial(opts): the itemized parts/materials list
       for a job, formatted to hand (or fax/email) to a supplier.
     - printBomOrderForm(opts): the Order raised against that Bill
       of Material — its own Order Number, plus the related Job
       Number and (when the job is linked to one) Quotation Number.
   ============================================================ */

const SAA_BOM_INFO = {
  name: "SAA Comfort Air LLC",
  phone: "713-955-6242",
  email: "saacomfortair@gmail.com",
  address: "27703 Yorkshire Brook Lane, Fulshear, TX 77441",
  license: "TDLR Lic #TACLB167405E",
};

function _saaBomPrintEsc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _saaBomPrintStyle() {
  return `
  @page { size: letter; margin: 0.55in 0.6in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2733; font-size: 12px; line-height: 1.4; margin: 0; }
  h1, h2, h3 { margin: 0; }
  .rule { border-top: 2px solid #1a6b5a; margin: 6px 0 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
  .header .mark { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 36px; border-radius: 7px; background: #0f2439; color: #fff; font-weight: 800; font-size: .74rem; letter-spacing: -0.2px; margin-bottom: 5px; }
  .header h1 { font-size: 1.2rem; color: #0f2439; }
  .header .sub { color: #55636e; font-size: .8rem; }
  .header .contact { text-align: right; font-size: .8rem; color: #55636e; }
  .title-row { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 14px; }
  .title-row h2 { font-size: 1.4rem; color: #1a6b5a; text-transform: uppercase; letter-spacing: .5px; }
  .meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; flex-wrap: wrap; }
  .meta-box { flex: 1; min-width: 140px; }
  .meta-box .label { text-transform: uppercase; font-size: .64rem; letter-spacing: .4px; color: #55636e; font-weight: 700; margin-bottom: 2px; }
  .meta-box .val { font-size: .88rem; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.items th { text-align: left; font-size: .66rem; text-transform: uppercase; letter-spacing: .3px; color: #55636e; border-bottom: 1px solid #cfd8de; padding: 5px 4px; }
  table.items td { padding: 7px 4px; border-bottom: 1px solid #e7ecef; vertical-align: top; }
  table.items td.num, table.items th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .summary { margin-top: 10px; width: 100%; max-width: 260px; margin-left: auto; }
  .summary-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: .88rem; }
  .summary-row.total { border-top: 2px solid #0f2439; font-weight: 800; font-size: 1.05rem; padding-top: 8px; margin-top: 4px; }
  .footer { display: flex; justify-content: space-between; color: #55636e; font-size: .74rem; border-top: 1px solid #cfd8de; padding-top: 6px; margin-top: 24px; }
  .muted { color: #55636e; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
}

function _saaBomPrintHeader(info) {
  return `<div class="header">
    <div>
      <div class="mark">SAA</div>
      <h1>${info.name}</h1>
      <div class="sub">${info.license}</div>
    </div>
    <div class="contact">${info.phone}<br>${info.email}<br>${info.address}</div>
  </div>
  <div class="rule"></div>`;
}

/** Builds the shared items table body for both documents. Round 12
 *  redesign (2026-09-13): "no need to populate cost, just populate qty
 *  and unit in order form which will be showed to shop to pull
 *  materials from shelf" -- neither document shows cost/pricing at all
 *  anymore, just what to pull and how many. */
function _saaBomItemsTable(items) {
  const rows = (items || []).map((it) => {
    const qty = Number(it.quantity != null ? it.quantity : it.qty) || 0;
    return `<tr>
      <td>${_saaBomPrintEsc(it.description || "")}${it.manual ? ' <span class="muted" style="font-size:.72rem">(added)</span>' : ""}</td>
      <td class="num">${qty || ""}</td>
      <td>${_saaBomPrintEsc(it.unit || "ea")}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="muted">No items listed.</td></tr>`;
  return { rows };
}

/**
 * opts: { bomNumber, jobNumber, customer, phone, address, jobTitle, items }
 */
function printBillOfMaterial(opts) {
  const info = SAA_BOM_INFO;
  const { rows } = _saaBomItemsTable(opts.items);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Bill of Material ${_saaBomPrintEsc(opts.bomNumber)} — ${info.name}</title>
<style>${_saaBomPrintStyle()}</style>
</head>
<body>
  ${_saaBomPrintHeader(info)}
  <div class="title-row"><h2>Bill of Material</h2></div>

  <div class="meta-row">
    <div class="meta-box"><div class="label">BOM #</div><div class="val">${_saaBomPrintEsc(opts.bomNumber) || "&mdash;"}</div></div>
    <div class="meta-box"><div class="label">Job #</div><div class="val">${_saaBomPrintEsc(opts.jobNumber) || "&mdash;"}</div></div>
    <div class="meta-box" style="text-align:right"><div class="label">Date</div><div class="val">${_saaBomPrintEsc(new Date().toLocaleDateString())}</div></div>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <div class="label">Job / Customer</div>
      <div class="val">${_saaBomPrintEsc(opts.customer) || "&mdash;"}</div>
      ${opts.phone ? `<div class="val" style="font-size:.82rem;color:#55636e;margin-top:2px">${_saaBomPrintEsc(saaFormatPhone(opts.phone))}</div>` : ""}
    </div>
    <div class="meta-box"><div class="label">Job Address</div><div class="val">${_saaBomPrintEsc(opts.address) || "&mdash;"}</div></div>
  </div>
  ${opts.jobTitle ? `<div class="meta-row"><div class="meta-box"><div class="label">Job</div><div class="val">${_saaBomPrintEsc(opts.jobTitle)}</div></div></div>` : ""}

  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    <div>${info.name} &mdash; Bill of Material ${_saaBomPrintEsc(opts.bomNumber)}</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the Bill of Material."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * opts: { orderNumber, orderDate, jobNumber, quoteNumber, supplier, customer, phone, address, items }
 */
function printBomOrderForm(opts) {
  const info = SAA_BOM_INFO;
  const { rows } = _saaBomItemsTable(opts.items);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Order ${_saaBomPrintEsc(opts.orderNumber)} — ${info.name}</title>
<style>${_saaBomPrintStyle()}</style>
</head>
<body>
  ${_saaBomPrintHeader(info)}
  <div class="title-row"><h2>Material Order</h2></div>

  <div class="meta-row">
    <div class="meta-box"><div class="label">Order #</div><div class="val">${_saaBomPrintEsc(opts.orderNumber) || "&mdash;"}</div></div>
    <div class="meta-box"><div class="label">Job #</div><div class="val">${_saaBomPrintEsc(opts.jobNumber) || "&mdash;"}</div></div>
    <div class="meta-box"><div class="label">Quotation #</div><div class="val">${_saaBomPrintEsc(opts.quoteNumber) || "&mdash;"}</div></div>
    <div class="meta-box" style="text-align:right"><div class="label">Order Date</div><div class="val">${_saaBomPrintEsc(opts.orderDate) || "&mdash;"}</div></div>
  </div>

  <div class="meta-row">
    <div class="meta-box"><div class="label">Order From (Supplier)</div><div class="val">${_saaBomPrintEsc(opts.supplier) || "&mdash;"}</div></div>
    <div class="meta-box">
      <div class="label">Job / Customer</div>
      <div class="val">${_saaBomPrintEsc(opts.customer) || "&mdash;"}</div>
      ${opts.phone ? `<div class="val" style="font-size:.82rem;color:#55636e;margin-top:2px">${_saaBomPrintEsc(saaFormatPhone(opts.phone))}</div>` : ""}
    </div>
    <div class="meta-box"><div class="label">Job Address</div><div class="val">${_saaBomPrintEsc(opts.address) || "&mdash;"}</div></div>
  </div>

  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="footer">
    <div>${info.name} &mdash; Order ${_saaBomPrintEsc(opts.orderNumber)}</div>
    <div>${info.address}</div>
  </div>

<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 150); };
</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to print the Order Form."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
