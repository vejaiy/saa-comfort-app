/* ============================================================
   SAA Comfort Air LLC — Condenser price list data layer (Round 93)

   The Condenser worksheet (Condenser page + the Create Quote page's
   Condenser section) picks Brand / Tonnage / Stage and fills the
   "Condenser unit" Unit $ from this list, so the price list IS the
   condenser price used in quotations. It lives in the Supabase table
   condenser_prices (brand, tonnage, stage, price, sort_order; price NULL
   = "N/A" -- that brand doesn't offer that stage) and is edited on the
   Condenser page's "Price List" tab when market prices change.

   CONDENSER_PRICES (pricing-data.js) is the shared in-memory copy. It
   starts as the factory default from Condenser_Cost.xlsx (or the last
   list cached in this browser), and saaCondenserLoadPrices() replaces its
   contents IN PLACE with the database list, so every worksheet already
   holding a reference sees the new numbers. window.SAA_CONDENSER_READY is
   a promise that always resolves once that load attempt has finished
   (pages wait on it before restoring a saved quote).

   Requires auth.js (shared _saaClient) and pricing-data.js.
   ============================================================ */

const SAA_CONDENSER_CACHE_KEY = "saa_condenser_prices_v1";
const SAA_CONDENSER_STAGES = ["Single stage", "Variable Speed"];

function _saaCondenserReplaceList(rows) {
  CONDENSER_PRICES.length = 0;
  rows.forEach((r) => CONDENSER_PRICES.push(r));
}

function _saaCondenserNormalize(r) {
  const price = r.price === null || r.price === undefined || r.price === "" ? null : Number(r.price);
  return {
    id: r.id || null,
    brand: r.brand,
    tonnage: Number(r.tonnage),
    stage: r.stage,
    price: price !== null && isFinite(price) ? price : null,
    sort_order: Number(r.sort_order) || 0,
  };
}

// Cached copy from the last successful load (so a worksheet renders with
// the latest prices even before the network answers).
try {
  const cached = JSON.parse(localStorage.getItem(SAA_CONDENSER_CACHE_KEY) || "null");
  if (Array.isArray(cached) && cached.length) _saaCondenserReplaceList(cached.map(_saaCondenserNormalize));
} catch (e) { /* no cache / storage blocked -- keep the factory default */ }

/** Rows straight from the database, ordered, or null on error/empty. */
async function saaCondenserFetchRows() {
  if (typeof _saaClient === "undefined") return null;
  const { data, error } = await _saaClient.from("condenser_prices").select("*").order("sort_order", { ascending: true });
  if (error) { console.error(error); return null; }
  return (data || []).map(_saaCondenserNormalize);
}

/** Loads the database list into CONDENSER_PRICES (in place) + the cache.
 *  Falls back silently to whatever is already there when offline/empty. */
async function saaCondenserLoadPrices() {
  try {
    const rows = await saaCondenserFetchRows();
    if (rows && rows.length) {
      _saaCondenserReplaceList(rows);
      try { localStorage.setItem(SAA_CONDENSER_CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* ignore */ }
      return true;
    }
  } catch (e) { console.error(e); }
  return false;
}

/** Keeps the shared in-memory list + cache in step after the Price List
 *  tab edits something (rows = the full current list). */
function saaCondenserSetLocalList(rows) {
  _saaCondenserReplaceList(rows.map(_saaCondenserNormalize));
  try { localStorage.setItem(SAA_CONDENSER_CACHE_KEY, JSON.stringify(CONDENSER_PRICES)); } catch (e) { /* ignore */ }
}

/** Matching price for a combination, or null (also null for N/A). */
function saaCondenserPrice(brand, tonnage, stage) {
  const hit = CONDENSER_PRICES.find((r) =>
    r.brand === brand && Number(r.tonnage) === Number(tonnage) && r.stage === stage);
  return hit && hit.price !== null && hit.price !== undefined ? Number(hit.price) : null;
}

async function saaCondenserUpdatePrice(id, price) {
  const val = price === null || price === "" || price === undefined ? null : Number(price);
  const { error } = await _saaClient.from("condenser_prices")
    .update({ price: val, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function saaCondenserInsert({ brand, tonnage, stage, price }) {
  const rows = (await saaCondenserFetchRows()) || [];
  const next = rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  const val = price === null || price === "" || price === undefined ? null : Number(price);
  const { data, error } = await _saaClient.from("condenser_prices")
    .insert({ brand, tonnage: Number(tonnage), stage, price: val, sort_order: next }).select().single();
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? "That brand / tonnage / stage is already on the list." : error.message };
  return { ok: true, row: _saaCondenserNormalize(data) };
}

async function saaCondenserDelete(id) {
  const { error } = await _saaClient.from("condenser_prices").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

window.SAA_CONDENSER_READY = saaCondenserLoadPrices();
