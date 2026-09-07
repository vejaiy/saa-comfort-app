/* Reusable Labor calculator — used standalone and embedded in the
   New Install / Replacement master quote builders. Requires
   pricing-data.js (LABOR_ROWS) and worksheet.js (fmtMoney) first. */
function initLaborWidget(mountEl) {
  mountEl.innerHTML = `
    <div class="worksheet-wrap">
      <table class="worksheet">
        <thead><tr><th>Role</th><th>Cost / Hr</th><th>Hours (Low)</th><th>Hours (High)</th><th>Total (Low)</th><th>Total (High)</th></tr></thead>
        <tbody class="lw-body"></tbody>
        <tfoot><tr><td colspan="4">Subtotal</td><td class="num lw-total-low">$0.00</td><td class="num lw-total-high">$0.00</td></tr></tfoot>
      </table>
    </div>`;
  const tbody = mountEl.querySelector(".lw-body");
  tbody.innerHTML = LABOR_ROWS.map((r, i) => `
    <tr data-row="${i}">
      <td class="item-name">${r.role}</td>
      <td class="num"><input type="number" step="any" class="lw-costhr" value="${r.costHr}"></td>
      <td class="num"><input type="number" step="any" class="lw-hourslow" value="${r.hoursLow}"></td>
      <td class="num"><input type="number" step="any" class="lw-hourshigh" value="${r.hoursHigh}"></td>
      <td class="num lw-total-row-low">${fmtMoney(r.costHr * r.hoursLow)}</td>
      <td class="num lw-total-row-high">${fmtMoney(r.costHr * r.hoursHigh)}</td>
    </tr>`).join("");

  function recalc() {
    let lowSum = 0, highSum = 0;
    tbody.querySelectorAll("tr").forEach(tr => {
      const costHr = parseFloat(tr.querySelector(".lw-costhr").value) || 0;
      const hoursLow = parseFloat(tr.querySelector(".lw-hourslow").value) || 0;
      const hoursHigh = parseFloat(tr.querySelector(".lw-hourshigh").value) || 0;
      const low = costHr * hoursLow, high = costHr * hoursHigh;
      tr.querySelector(".lw-total-row-low").textContent = fmtMoney(low);
      tr.querySelector(".lw-total-row-high").textContent = fmtMoney(high);
      lowSum += low; highSum += high;
    });
    mountEl.querySelector(".lw-total-low").textContent = fmtMoney(lowSum);
    mountEl.querySelector(".lw-total-high").textContent = fmtMoney(highSum);
    const totals = { low: lowSum, high: highSum };
    if (typeof mountEl._onTotal === "function") mountEl._onTotal(totals);
    return totals;
  }
  mountEl.addEventListener("input", recalc);
  recalc();
  return { getTotal: recalc, onTotal: (fn) => { mountEl._onTotal = fn; } };
}
