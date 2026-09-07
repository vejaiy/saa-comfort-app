/* Reusable Plenum Change calculator — used standalone and embedded in the
   New Install / Replacement master quote builders. Requires pricing-data.js
   and worksheet.js to be loaded first. */
function initPlenumWidget(mountEl) {
  mountEl.innerHTML = `
    <h4 style="font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.3px">Plenum Selection</h4>
    <div class="worksheet-wrap" style="margin-bottom:18px">
      <table class="worksheet">
        <thead><tr><th>Equipment</th><th>Plenum Type</th><th>Cabinet Size</th><th>Spec</th><th>Qty</th><th>Unit Price</th><th>Ext.</th></tr></thead>
        <tbody class="pw-body"></tbody>
      </table>
    </div>
    <h4 style="font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.3px">Duct Collars</h4>
    <div class="pw-collars" style="margin-bottom:18px"></div>
    <h4 style="font-size:.85rem;color:var(--muted);text-transform:uppercase;letter-spacing:.3px">Labor</h4>
    <div class="worksheet-wrap" style="margin-bottom:18px">
      <table class="worksheet">
        <thead><tr><th>Technicians</th><th>Rate/Hr</th><th>Hours</th><th>Total</th></tr></thead>
        <tbody><tr>
          <td><input type="number" class="pw-techs" value="1" step="1"></td>
          <td class="num"><input type="number" class="pw-rate" value="50" step="any"></td>
          <td class="num"><input type="number" class="pw-hours" value="2" step="any"></td>
          <td class="num pw-labor-total">$100.00</td>
        </tr></tbody>
      </table>
    </div>
    <div class="totals-strip">
      <div class="total-box grand"><div class="label">Plenum Change Total</div><div class="value pw-grand-total">$0.00</div></div>
    </div>`;

  function plenumOptions(eq) { return [...new Set(PLENUM_TYPES.filter(p => p.equipment === eq).map(p => p.type))]; }
  function cabinetOptions(eq, type) { return PLENUM_TYPES.filter(p => p.equipment === eq && p.type === type); }
  function buildRow(eq, defaultType, defaultCab, label) {
    const typeOpts = plenumOptions(eq).map(t => `<option value="${t}"${t === defaultType ? " selected" : ""}>${t}</option>`).join("");
    return `<tr data-eq="${eq}" data-defcab="${defaultCab}">
      <td class="item-name">${label}</td>
      <td><select class="pw-type">${typeOpts}</select></td>
      <td><select class="pw-cab"></select></td>
      <td class="spec pw-spec"></td>
      <td><input type="number" class="pw-qty" value="1" step="1" style="width:60px"></td>
      <td class="num pw-price">$0.00</td>
      <td class="num pw-ext">$0.00</td>
    </tr>`;
  }
  const body = mountEl.querySelector(".pw-body");
  body.innerHTML = buildRow("CCoil", "Insulated SM", "A", "Coil Cabinet") + buildRow("Furnace", "Sheetmetal", "D", "Furnace Cabinet");

  function populateCabinets(tr) {
    const eq = tr.dataset.eq, type = tr.querySelector(".pw-type").value;
    const cabSel = tr.querySelector(".pw-cab");
    cabSel.innerHTML = cabinetOptions(eq, type).map(o => `<option value="${o.cabinet}">${o.cabinet} — ${o.size}</option>`).join("");
    cabSel.value = tr.dataset.defcab in Object.fromEntries(cabinetOptions(eq, type).map(o => [o.cabinet, 1])) ? tr.dataset.defcab : cabSel.value;
  }
  body.querySelectorAll("tr").forEach(tr => {
    populateCabinets(tr);
    tr.querySelector(".pw-type").addEventListener("change", () => { populateCabinets(tr); recalc(); });
  });

  const collarRows = DUCT_COLLARS.map(c => ({ item: `Duct collar ${c.size}`, unit: "EA", price: c.price, qty: 0 }));
  const collarDefaults = { '6"': 4, '8"': 3, '10"': 3, '12"': 1, '16"': 0 };
  collarRows.forEach(r => { const key = r.item.replace("Duct collar ", ""); r.qty = collarDefaults[key] || 0; });
  const collarMount = mountEl.querySelector(".pw-collars");
  collarMount.id = mountEl.id + "-collars";
  const collarTable = renderFlatPriceTable(collarMount, collarRows);
  collarMount.addEventListener("input", recalc);

  function recalc() {
    let plenumSum = 0;
    body.querySelectorAll("tr").forEach(tr => {
      const eq = tr.dataset.eq, type = tr.querySelector(".pw-type").value, cab = tr.querySelector(".pw-cab").value;
      const match = PLENUM_TYPES.find(p => p.equipment === eq && p.type === type && p.cabinet === cab);
      const qty = parseFloat(tr.querySelector(".pw-qty").value) || 0;
      const price = match ? match.price : 0, ext = price * qty;
      tr.querySelector(".pw-spec").textContent = match ? match.spec : "";
      tr.querySelector(".pw-price").textContent = fmtMoney(price);
      tr.querySelector(".pw-ext").textContent = fmtMoney(ext);
      plenumSum += ext;
    });
    const collarSum = collarTable.getTotals().total;
    const techs = parseFloat(mountEl.querySelector(".pw-techs").value) || 0;
    const rate = parseFloat(mountEl.querySelector(".pw-rate").value) || 0;
    const hours = parseFloat(mountEl.querySelector(".pw-hours").value) || 0;
    const labor = techs * rate * hours;
    mountEl.querySelector(".pw-labor-total").textContent = fmtMoney(labor);
    const total = plenumSum + collarSum + labor;
    mountEl.querySelector(".pw-grand-total").textContent = fmtMoney(total);
    if (typeof mountEl._onTotal === "function") mountEl._onTotal(total);
    return total;
  }
  mountEl.addEventListener("input", recalc);
  mountEl.addEventListener("change", recalc);
  recalc();
  return { getTotal: recalc, onTotal: (fn) => { mountEl._onTotal = fn; } };
}
