/* ============================================================
   SAA Comfort Air LLC — SAA-Tools / SAA-Supplies data layer
   Backs the employee Tool List page (tool-list.html). Three tables:

   - tool_supply_purchases: a historical ledger, one row per line
     item ever bought for the shop's own tools/supplies (NOT billed
     to a specific job — those go through Bill of Material instead).
     Backfilled from the July/Aug/Sept 2026 receipts reconciliations
     plus 4 Amazon order screenshots found in Gmail. A negative
     qty/item_total row is a return.
   - tool_inventory: current quantity-on-hand, one row per distinct
     item, seeded by netting the ledger above (purchases minus
     matched returns) as of the Sept 2026 reconciliation.
     quantity_on_hand is the source of truth going forward — it is
     NOT recomputed live from the ledger, so using a tool/supply up
     or restocking it means editing the number here by hand.
   - tool_shopping_list (Round 53, 2026-09-25): tools/supplies still
     NEEDED but not yet bought — a manual wishlist, separate from the
     two tables above. Marking an item purchased just flips its
     status; the actual purchase (vendor, price, receipt #) still
     gets entered separately in tool_supply_purchases once it happens.

   Requires auth.js to have already created the shared _saaClient.
   ============================================================ */

/* ---- Purchase ledger: reads ---- */

async function saaToolPurchasesFetchAll({ type, search, dateFrom, dateTo } = {}) {
  let query = _saaClient.from("tool_supply_purchases").select("*");
  if (type) query = query.eq("type", type);
  if (dateFrom) query = query.gte("purchase_date", dateFrom);
  if (dateTo) query = query.lte("purchase_date", dateTo);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  let rows = data || [];
  const q = (search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.item_name, r.vendor, r.category, r.receipt_order_number, r.notes].some((s) => (s || "").toLowerCase().includes(q))
    );
  }
  return rows.sort((a, b) => b.purchase_date.localeCompare(a.purchase_date) || (a.item_name || "").localeCompare(b.item_name || ""));
}

/* ---- Purchase ledger: writes ---- */

async function saaToolPurchaseAdd(patch) {
  const qty = patch.qty === "" || patch.qty == null ? 1 : Number(patch.qty);
  const unitPrice = patch.unit_price === "" || patch.unit_price == null ? null : Number(patch.unit_price);
  const itemTotal = patch.item_total === "" || patch.item_total == null
    ? (unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null)
    : Number(patch.item_total);
  const { data, error } = await _saaClient.from("tool_supply_purchases").insert({
    purchase_date: patch.purchase_date,
    vendor: patch.vendor || null,
    item_name: patch.item_name,
    category: patch.category || null,
    type: patch.type,
    qty,
    unit_price: unitPrice,
    item_total: itemTotal,
    sales_tax: patch.sales_tax === "" || patch.sales_tax == null ? null : Number(patch.sales_tax),
    receipt_order_number: patch.receipt_order_number || null,
    source_month: patch.purchase_date ? patch.purchase_date.slice(0, 7) : null,
    notes: patch.notes || null,
  }).select("*").single();
  return error ? { ok: false, error: error.message } : { ok: true, row: data };
}

async function saaToolPurchaseDelete(id) {
  const { error } = await _saaClient.from("tool_supply_purchases").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ---- Stock counts: reads ---- */

async function saaToolInventoryFetchAll({ type, search } = {}) {
  let query = _saaClient.from("tool_inventory").select("*");
  if (type) query = query.eq("type", type);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  let rows = data || [];
  const q = (search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => [r.item_name, r.category, r.notes].some((s) => (s || "").toLowerCase().includes(q)));
  }
  return rows.sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.item_name.localeCompare(b.item_name));
}

/* ---- Stock counts: writes ---- */

async function saaToolInventoryAdd(patch) {
  const { data, error } = await _saaClient.from("tool_inventory").insert({
    item_name: patch.item_name,
    category: patch.category || null,
    type: patch.type,
    quantity_on_hand: patch.quantity_on_hand === "" || patch.quantity_on_hand == null ? 0 : Number(patch.quantity_on_hand),
    unit_of_measure: patch.unit_of_measure || null,
    last_purchase_date: patch.last_purchase_date || null,
    notes: patch.notes || null,
  }).select("*").single();
  return error ? { ok: false, error: error.message } : { ok: true, row: data };
}

/** Direct stock adjustment — used by the inline "Qty on Hand" field on
 *  the Tool List page. Every edit here is a deliberate count correction
 *  by whoever is looking at the actual shelf/truck, so it just overwrites
 *  the number rather than trying to reconcile against the ledger. */
async function saaToolInventoryUpdateQty(id, quantityOnHand) {
  const { data, error } = await _saaClient
    .from("tool_inventory")
    .update({ quantity_on_hand: Number(quantityOnHand), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, row: data };
}

async function saaToolInventoryDelete(id) {
  const { error } = await _saaClient.from("tool_inventory").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ---- Tools to Buy (shopping list): reads ---- */

async function saaToolShoppingListFetchAll({ type, search, includePurchased } = {}) {
  let query = _saaClient.from("tool_shopping_list").select("*");
  if (type) query = query.eq("type", type);
  if (!includePurchased) query = query.eq("status", "to_buy");
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  let rows = data || [];
  const q = (search || "").trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      [r.item_name, r.specification, r.brand, r.category, r.notes].some((s) => (s || "").toLowerCase().includes(q))
    );
  }
  return rows.sort((a, b) => {
    // To-buy items first (newest-added first within each group), purchased
    // items (when shown) trail behind, most-recently-purchased first.
    if (a.status !== b.status) return a.status === "to_buy" ? -1 : 1;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

/* ---- Tools to Buy: writes ---- */

async function saaToolShoppingListAdd(patch) {
  const { data, error } = await _saaClient.from("tool_shopping_list").insert({
    item_name: patch.item_name,
    specification: patch.specification || null,
    brand: patch.brand || null,
    qty: patch.qty === "" || patch.qty == null ? 1 : Number(patch.qty),
    category: patch.category || null,
    type: patch.type || "tools",
    estimated_price: patch.estimated_price === "" || patch.estimated_price == null ? null : Number(patch.estimated_price),
    priority: patch.priority || null,
    status: "to_buy",
    notes: patch.notes || null,
  }).select("*").single();
  return error ? { ok: false, error: error.message } : { ok: true, row: data };
}

async function saaToolShoppingListMarkPurchased(id, purchased) {
  const { data, error } = await _saaClient.from("tool_shopping_list").update({
    status: purchased ? "purchased" : "to_buy",
    purchased_date: purchased ? new Date().toISOString().slice(0, 10) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  return error ? { ok: false, error: error.message } : { ok: true, row: data };
}

async function saaToolShoppingListDelete(id) {
  const { error } = await _saaClient.from("tool_shopping_list").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
