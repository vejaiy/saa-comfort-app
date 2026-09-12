/* ============================================================
   SAA Comfort Air LLC — pricing data
   Ported from System_Replacement_Material_Cost.xlsx.
   Edit the numbers below to update prices across the whole site —
   every worksheet page reads from this one file.

   2026-09-08: collapsed from low/high estimate ranges to a single
   fixed price per item (previous "low" values kept as the price;
   the old "high" contingency numbers were dropped). "optional"
   (Yes/Check/Optional) became a plain included:true/false default —
   true = counted by default, false = technician toggles it on when
   the job needs it.
   ============================================================ */

/* ---- Equipment price-by-tonnage tables (source: Replacement!P6:S13, P18:S30) ---- */
const CONDENSER_TONNAGE = [
  { tonnage: 1.5, desc: "Single speed condenser", price: 2000 },
  { tonnage: 2,   desc: "Single speed condenser", price: 2200 },
  { tonnage: 2.5, desc: "Single speed condenser", price: 2300 },
  { tonnage: 3,   desc: "Single speed condenser", price: 2500 },
  { tonnage: 3.5, desc: "Single speed condenser", price: 2800 },
  { tonnage: 4,   desc: "Single speed condenser", price: 3100 },
  { tonnage: 5,   desc: "Single speed condenser", price: 3500 },
  { tonnage: 6,   desc: "Single speed condenser", price: 5000 },
];

const COIL_TONNAGE = [
  { tonnage: 1.5, desc: "Cased Coil", price: 750 },
  { tonnage: 2,   desc: "Cased Coil", price: 850 },
  { tonnage: 2.5, desc: "Cased Coil", price: 1000 },
  { tonnage: 3,   desc: "Cased Coil", price: 1000 },
  { tonnage: 3.5, desc: "Cased Coil", price: 1300 },
  { tonnage: 4,   desc: "Cased Coil", price: 1400 },
  { tonnage: 5,   desc: "Cased Coil", price: 1500 },
  { tonnage: 6,   desc: "Cased Coil", price: 1800 },
];

/* ---- Furnace tiers (sheet had no source data — starter tiers, edit freely) ---- */
const FURNACE_TIERS = [
  { id: "80std", label: "80% AFUE — single-stage (standard)", price: 1500 },
  { id: "96two", label: "96% AFUE — two-stage",               price: 2400 },
  { id: "96mod", label: "96% AFUE — variable-speed / modulating", price: 3200 },
];

/* ---- Installation access / complexity zones (source: New Install!P34:S40) ---- */
const ZONES = [
  { id: 1, label: "Zone 1 — Attic/horizontal, easy access",              multiplier: 1.00, note: "Minimal material modification" },
  { id: 2, label: "Zone 2 — Attic/horizontal, moderate access",          multiplier: 1.10, note: "Additional plenum/drain/support allowance" },
  { id: 3, label: "Zone 3 — Closet/vertical, moderate access",           multiplier: 1.05, note: "Plenum and drain adaptation allowance" },
  { id: 4, label: "Zone 4 — Closet, tight/restricted access",            multiplier: 1.20, note: "More fabrication/support material" },
  { id: 5, label: "Zone 5 — Difficult access / structural modification", multiplier: 1.35, note: "Higher plenum, drain and support allowance" },
];

/* ---- Condenser Change worksheet (source: 'Condenser Change' rows 4-21) ----
   group: MATERIALS | ACCESSORIES   included: true (counted by default) | false (technician toggles on)
   tonnageLinked: true -> row's price is driven by the tonnage picker */
const CONDENSER_MATERIALS = [
  { group: "MATERIALS",   category: "Equipment",    item: "3-ton condenser unit (size below)", unit: "EA", qty: 1, price: 2500, spec: "AHRI-matched, 208/230V-1ph — confirm refrigerant type (R-410A vs A2L R-454B)", notes: "New outdoor condensing unit sized to match the existing coil/furnace.", included: true, tonnageLinked: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Refrigerant charge", unit: "OZ", qty: 0.08, price: 200, spec: "R-410A or A2L per system, ~8-10 lb typical for 3-ton", notes: "Refrigerant weighed to nameplate spec, adjusted for line length.", included: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "POE refrigerant oil", unit: "OZ", qty: 1, price: 20, spec: "POE, viscosity per condenser OEM spec", notes: "Compatible lubricant added per manufacturer spec.", included: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Line-set flare nuts / couplings", unit: "EA", qty: 0, price: 15, spec: "Match existing line-set OD (3/8\" & 3/4\" typical 3-ton)", notes: "Reconnects line set to new condenser fittings.", included: false },
  { group: "MATERIALS",   category: "Brazing",      item: "Nitrogen (job usage)", unit: "OZ", qty: 1, price: 15, spec: "Per-job cylinder rental/fill portion", notes: "Purge gas during brazing and pressure test.", included: true },
  { group: "MATERIALS",   category: "Electrical",   item: "Electrical whip", unit: "EA", qty: 0, price: 35, spec: "Sized to unit MCA/MOCP, typically 10/3 or 8/3 AWG", notes: "Power connection from disconnect to condenser.", included: false },
  { group: "MATERIALS",   category: "Electrical",   item: "Disconnect switch", unit: "EA", qty: 0, price: 40, spec: "Non-fused pull-out, 60A, weatherproof", notes: "Local electrical disconnect at the condenser.", included: false },
  { group: "MATERIALS",   category: "Installation", item: "Condenser pad", unit: "EA", qty: 0, price: 60, spec: "Composite, 36\"x36\"x3\" or equivalent", notes: "Level composite/concrete base for the new unit.", included: false },
  { group: "MATERIALS",   category: "Installation", item: "Pad shims / leveling material", unit: "Bag", qty: 0, price: 10, spec: "Composite shims, assorted thickness", notes: "Fine-levels the pad on uneven ground.", included: false },
  { group: "MATERIALS",   category: "Electrical",   item: "Wire nuts / tape / anti-oxidant compound", unit: "Bag", qty: 1, price: 15, spec: "UL-listed connectors, anti-oxidant paste", notes: "Electrical connection finishing, incl. aluminum whip prep.", included: true },
  { group: "MATERIALS",   category: "Equipment",    item: "Liquid-line filter drier", unit: "EA", qty: 1, price: 50, spec: "Sized to line OD and system tonnage", notes: "Replaced any time the system is opened; mandatory after contamination/burnout.", included: true },
  { group: "ACCESSORIES", category: "Accessory",    item: "Hard start kit", unit: "EA", qty: 0, price: 60, spec: "Single-phase, sized to compressor RLA", notes: "Reduces compressor inrush current; recommended on long line runs or weak supply.", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Whole-unit surge protector", unit: "EA", qty: 0, price: 80, spec: "Line-side, condenser-rated", notes: "Protects condenser electronics from grid/storm surges.", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Low-ambient control kit", unit: "EA", qty: 0, price: 70, spec: "Fan-cycling switch or head-pressure control", notes: "Enables reliable operation below manufacturer's rated ambient minimum.", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Compressor crankcase heater", unit: "EA", qty: 0, price: 50, spec: "Wrap-style, sized to compressor", notes: "Prevents refrigerant migration into the compressor in cold weather (if not factory-included).", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Sound blanket / compressor cover", unit: "EA", qty: 0, price: 90, spec: "Universal fit, weatherproof", notes: "Reduces operating noise — common customer request.", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Condenser security cage", unit: "EA", qty: 0, price: 150, spec: "Powder-coated steel, ground-anchored", notes: "Theft deterrent for the outdoor unit.", included: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Line-set cover / channel kit", unit: "EA", qty: 0, price: 45, spec: "10 ft kit, paintable PVC", notes: "Cosmetic cover for exposed exterior line set.", included: false },
];

/* ---- Coil Change worksheet (source: 'Coil Change' rows 2-33) ---- */
const COIL_MATERIALS = [
  { group: "MATERIALS", category: "Refrigeration",   item: "Evaporator coil – matched replacement (size below)", unit: "EA", qty: 1, price: 1000, notes: "OEM/matched coil; size and refrigerant dependent", included: true, tonnageLinked: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "TXV / metering device", unit: "EA", qty: 0, price: 80, notes: "If not supplied with coil or replacement is required", included: false },
  { group: "MATERIALS", category: "Refrigeration",   item: "Filter-drier", unit: "EA", qty: 0, price: 50, notes: "Replace when refrigeration circuit is opened", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant R-410A ($200/25lb allowance)", unit: "OZ", qty: 0.08, price: 200, spec: "EPA-approved, dual-port, R-410A/A2L rated", notes: "Allowance only; use actual refrigerant and charge requirement", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Nitrogen / pressure-test allowance", unit: "LOT", qty: 1, price: 15, notes: "Purging and pressure testing", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 3/8\"", unit: "FT", qty: 0.25, price: 20, notes: "Couplings, elbows and brazing material", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 1\"", unit: "FT", qty: 0.25, price: 40, included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper fittings", unit: "Bag", qty: 1, price: 30, notes: "Couplings, elbows and brazing material", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper brazing alloy", unit: "LOT", qty: 1, price: 5, notes: "Couplings, elbows and brazing material", included: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant pipe insulation", unit: "8FT", qty: 2, price: 24, notes: "Replace disturbed insulation", included: true },
  { group: "MATERIALS", category: "Air Distribution", item: "Duct mastic / approved sealant", unit: "EA", qty: 1, price: 15, notes: "Seal disturbed duct joints", included: true },
  { group: "MATERIALS", category: "Air Distribution", item: "UL-181 foil tape", unit: "Roll", qty: 0.5, price: 15, notes: "Approved duct sealing tape", included: true },
  { group: "MATERIALS", category: "Air Distribution", item: "Zip ties for duct branches", unit: "Pack", qty: 0.25, price: 50, notes: "2ft to 3ft long zip ties for ducting", included: false },
  { group: "MATERIALS", category: "Air Distribution", item: "Air filter", unit: "EA", qty: 1, price: 40, included: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC tube 3/4\", 8ft", unit: "EA", qty: 1, price: 10, notes: "Typically PVC/CPVC; verify existing installation", included: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" elbow", unit: "Bag", qty: 1, price: 6, included: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" straight", unit: "Bag", qty: 1, price: 6, included: true },
  { group: "MATERIALS", category: "Drainage",         item: "P-trap / condensate trap", unit: "EA", qty: 1, price: 15, notes: "Configuration dependent", included: true },
  { group: "MATERIALS", category: "Drainage",         item: "Cleanout / vent fittings", unit: "LOT", qty: 1, price: 10, notes: "For serviceability and drain configuration", included: true },
  { group: "MATERIALS", category: "Safety",           item: "Primary drain float/overflow switch", unit: "EA", qty: 1, price: 25, notes: "Safety shutoff; application dependent", included: false },
  { group: "MATERIALS", category: "Equipment Support", item: "Structural support / hanging hardware", unit: "LOT", qty: 1, price: 75, notes: "Angles, rods, brackets, anchors", included: false },
  { group: "MATERIALS", category: "Equipment Support", item: "Vibration isolation pads", unit: "Set", qty: 0, price: 20, notes: "Where applicable", included: false },
  { group: "MATERIALS", category: "Electrical",       item: "Low-voltage wire/connectors", unit: "LOT", qty: 1, price: 15, notes: "For safety switches/controls", included: true },
  { group: "MATERIALS", category: "Electrical",       item: "Wire nuts", unit: "Bag", qty: 1, price: 10, notes: "Miscellaneous electrical material for furnace/EEV/switch connections", included: true },
  { group: "MATERIALS", category: "Electrical",       item: "Electric conduit", unit: "Bag", qty: 0, price: 10, included: false },
  { group: "MATERIALS", category: "Electrical",       item: "Wire cover", unit: "Bag", qty: 0, price: 10, included: false },
  { group: "MATERIALS", category: "Electrical",       item: "Conduit fitting with strain relief", unit: "EA", qty: 1, price: 1, included: true },
  { group: "MATERIALS", category: "Electrical",       item: "Wire terminals", unit: "EA", qty: 4, price: 1, included: true },
  { group: "MATERIALS", category: "Cleaning",         item: "Cleaning/sanitizing materials", unit: "LOT", qty: 1, price: 15, notes: "Coil/pan/drain area", included: true },
  { group: "MATERIALS", category: "Permits",          item: "Permit/inspection allowance", unit: "LOT", qty: 1, price: 50, notes: "Local jurisdiction dependent", included: false },
  { group: "MATERIALS", category: "Disposable",       item: "Old equipment disposal fee / plastic packaging recycle fee", unit: "EA", qty: 1, price: 150, included: false },
  { group: "MATERIALS", category: "Cleaning",         item: "Bucket", unit: "EA", qty: 1, price: 15, included: true },
];

/* ---- Furnace Change worksheet — starter list (no source sheet data; edit freely) ---- */
const FURNACE_MATERIALS = [
  { group: "MATERIALS", category: "Equipment",  item: "Furnace unit (tier below)", unit: "EA", qty: 1, price: 1500, notes: "Sized to duct system and BTU load", included: true, tierLinked: true },
  { group: "MATERIALS", category: "Venting",    item: "Flue / vent pipe extension", unit: "LOT", qty: 1, price: 60, notes: "Category I or PVC intake/exhaust depending on tier", included: false },
  { group: "MATERIALS", category: "Gas",        item: "Gas line / flex connector", unit: "EA", qty: 1, price: 35, notes: "Sized to furnace BTU input", included: true },
  { group: "MATERIALS", category: "Gas",        item: "Gas line pipe & pipe fitting", unit: "EA", qty: 1, price: 15, notes: "Black iron pipe/fittings for the gas line run", included: true },
  { group: "MATERIALS", category: "Electrical", item: "Electrical whip / dedicated circuit", unit: "EA", qty: 0, price: 35, included: false },
  { group: "MATERIALS", category: "Drainage",   item: "Condensate drain / PVC (high-efficiency only)", unit: "LOT", qty: 0, price: 20, notes: "Required for 90%+ AFUE units", included: false },
  { group: "MATERIALS", category: "Air",        item: "Air filter", unit: "EA", qty: 1, price: 20, included: true },
  { group: "MATERIALS", category: "Permits",    item: "Permit/inspection allowance", unit: "LOT", qty: 1, price: 50, included: false },
  { group: "MATERIALS", category: "Disposable", item: "Old equipment disposal fee", unit: "EA", qty: 1, price: 75, included: false },
  { group: "MATERIALS", category: "Electrical", item: "Wire nuts / misc electrical", unit: "Bag", qty: 1, price: 10, included: true },
];

/* ---- Repair worksheet (employee/repair.html, added 2026-09-12) ----
   Component-level repair items for a Condenser, Fan Coil, or Furnace
   that needs targeted parts/labor rather than a full unit swap. Every
   row defaults included:false ("Included" toggle) — a repair worksheet
   starts as a blank template per system, and the technician switches on
   only the parts this specific job actually needs (switching a row on
   defaults its Qty to 1, see renderLineItemTable's showBuyColumn/
   default-qty behavior in worksheet.js). qty/price below are Claude's
   starter estimates (no source pricing sheet existed for repairs, same
   situation the Furnace Change worksheet was in) — treat as templates
   to review and adjust to Vijayan's real part costs and labor rates.
   "buy" defaults false (assumed on-truck stock); the technician flips
   it on for anything that needs to be ordered before the job can close. */
const REPAIR_CONDENSER_ITEMS = [
  { category: "Compressor", item: "Replace compressor", unit: "EA", qty: 1, price: 950, included: false, buy: false },
  { category: "Condenser Motor", item: "Replace condenser fan motor", unit: "EA", qty: 1, price: 275, included: false, buy: false },
  { category: "Electrical Components", item: "Diagnose and replace electrical parts", unit: "EA", qty: 1, price: 100, included: false, buy: false },
  { category: "Capacitor", item: "Replace run capacitor", unit: "EA", qty: 1, price: 45, included: false, buy: false },
  { category: "Contactor", item: "Replace contactor", unit: "EA", qty: 1, price: 35, included: false, buy: false },
  { category: "Relay", item: "Replace relay", unit: "EA", qty: 1, price: 25, included: false, buy: false },
  { category: "Start Capacitor", item: "Replace start capacitor / hard start kit", unit: "EA", qty: 1, price: 65, included: false, buy: false },
  { category: "Electric Whip", item: "Replace electric whip", unit: "EA", qty: 1, price: 40, included: false, buy: false },
  { category: "Coil Repair", item: "Repair condenser coil leak", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "TXV", item: "Replace TXV (thermostatic expansion valve)", unit: "EA", qty: 1, price: 150, included: false, buy: false },
  { category: "Filter Drier", item: "Replace filter drier", unit: "EA", qty: 1, price: 45, included: false, buy: false },
  { category: "Reversing Valve", item: "Replace reversing valve", unit: "EA", qty: 1, price: 225, included: false, buy: false },
];

const REPAIR_FANCOIL_ITEMS = [
  { category: "Coil Repair", item: "Repair evaporator coil leak", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "TXV, Flowrator", item: "Replace TXV or flowrator", unit: "EA", qty: 1, price: 150, included: false, buy: false },
  { category: "PCB", item: "Replace control board (PCB)", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "Drainline", item: "Repair/replace drain line section", unit: "EA", qty: 1, price: 75, included: false, buy: false },
  { category: "Drainline Clean", item: "Clear and flush drain line", unit: "EA", qty: 1, price: 60, included: false, buy: false },
];

const REPAIR_FURNACE_ITEMS = [
  { category: "Igniter", item: "Replace hot surface igniter", unit: "EA", qty: 1, price: 45, included: false, buy: false },
  { category: "Flame Sensor", item: "Replace/clean flame sensor", unit: "EA", qty: 1, price: 35, included: false, buy: false },
  { category: "Gas Valve", item: "Replace gas valve", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "Blower Motor", item: "Replace blower motor", unit: "EA", qty: 1, price: 325, included: false, buy: false },
  { category: "Control Board", item: "Replace furnace control board", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "Draft Inducer Motor", item: "Replace draft inducer motor", unit: "EA", qty: 1, price: 225, included: false, buy: false },
  { category: "Heat Exchanger", item: "Replace cracked heat exchanger", unit: "EA", qty: 1, price: 850, included: false, buy: false },
  { category: "Thermocouple", item: "Replace thermocouple", unit: "EA", qty: 1, price: 35, included: false, buy: false },
];

/* ---- Plenum Change worksheet (source: 'Plenum Change' rows 3-31) ---- */
const PLENUM_TYPES = [
  { equipment: "CCoil",   type: "Insulated SM", cabinet: "A", size: "14X21",   price: 120, spec: "Insulated Galvanized Sheet Metal supply Plenum 14.5x20.5x36" },
  { equipment: "CCoil",   type: "Insulated SM", cabinet: "B", size: "17.5X21", price: 130, spec: "Insulated Galvanized Sheet Metal supply Plenum 17x20.5x36" },
  { equipment: "CCoil",   type: "Insulated SM", cabinet: "C", size: "21X21",   price: 160, spec: "Insulated Galvanized Sheet Metal Supply Plenum 19.5x20.5x36" },
  { equipment: "CCoil",   type: "Insulated SM", cabinet: "D", size: "24.5X21", price: 180, spec: "Insulated Galvanized Sheet Metal Supply Plenum" },
  { equipment: "Furnace", type: "Insulated SM", cabinet: "A", size: "14X26",   price: 150, spec: "Insulated Galvanized Sheet Metal Supply Plenum" },
  { equipment: "Furnace", type: "Insulated SM", cabinet: "B", size: "17.5X26", price: 180, spec: "Insulated Galvanized Sheet Metal Supply Plenum" },
  { equipment: "Furnace", type: "Insulated SM", cabinet: "C", size: "21X26",   price: 200, spec: "Insulated Galvanized Sheet Metal Supply Plenum" },
  { equipment: "Furnace", type: "Insulated SM", cabinet: "D", size: "24.5X26", price: 250, spec: "Insulated Galvanized Sheet Metal Supply Plenum" },
  { equipment: "CCoil",   type: "Sheetmetal",   cabinet: "A", size: "14X21",   price: 50,  spec: "Sheetmetal plenum" },
  { equipment: "CCoil",   type: "Sheetmetal",   cabinet: "B", size: "17.5X21", price: 70,  spec: "Sheetmetal plenum" },
  { equipment: "CCoil",   type: "Sheetmetal",   cabinet: "C", size: "21X21",   price: 90,  spec: "Sheetmetal plenum" },
  { equipment: "CCoil",   type: "Sheetmetal",   cabinet: "D", size: "24.5X21", price: 100, spec: "Sheetmetal plenum" },
  { equipment: "Furnace", type: "Sheetmetal",   cabinet: "A", size: "14X26",   price: 80,  spec: "Sheetmetal plenum" },
  { equipment: "Furnace", type: "Sheetmetal",   cabinet: "B", size: "17.5X26", price: 100, spec: "Sheetmetal plenum" },
  { equipment: "Furnace", type: "Sheetmetal",   cabinet: "C", size: "21X26",   price: 120, spec: "Sheetmetal plenum" },
  { equipment: "Furnace", type: "Sheetmetal",   cabinet: "D", size: "24.5X26", price: 150, spec: "Sheetmetal plenum" },
];

const DUCT_COLLARS = [
  { size: "6\"",  price: 25 },
  { size: "8\"",  price: 30 },
  { size: "10\"", price: 35 },
  { size: "12\"", price: 50 },
  { size: "16\"", price: 60 },
];

/* ---- Drainline Maintenance: secondary drainpan installation (source rows 3-11) ---- */
const DRAINPAN_MATERIALS = [
  { category: "Drainage", item: "Secondary/emergency drain pipe & fittings (male threaded)", unit: "LOT", qty: 1, price: 10, spec: "3/4 in. PVC Sch 40 90-deg fitting (10-pack), male threaded", notes: "If required by installation", included: true },
  { category: "Drainage", item: "Secondary/emergency drain pipe & fittings (female threaded)", unit: "LOT", qty: 1, price: 10, spec: "3/4 in. PVC Sch 40 90-deg fitting (10-pack), female threaded", included: true },
  { category: "Drainage", item: "Secondary/emergency drain pan", unit: "EA", qty: 1, price: 75, spec: "Drip pan, 27\" x 48\"", notes: "Size to equipment footprint", included: true },
  { category: "Safety",   item: "Secondary pan float switch", unit: "EA", qty: 1, price: 25, spec: "3/4\" float switch, L-shape HVAC safety switch", notes: "Overflow protection", included: true },
  { category: "Safety",   item: "Additional drain-line safety switch", unit: "EA", qty: 0, price: 25, notes: "Optional additional protection", included: false },
  { category: "Equipment Support", item: "Base/support platform", unit: "EA", qty: 1, price: 75, notes: "Wood/metal/composite support as required", included: true },
];
const DRAINPAN_LABOR = { techs: 1, hours: 2, rate: 30 };

/* ---- Drainline Maintenance: routine cleaning service (source rows 21-34, single price col) ---- */
const DRAIN_MAINT_ITEMS = [
  { item: "Vacuum cleaner (shopvac)", unit: "EA", qty: 1, price: 100 },
  { item: "Hose to PVC pipe adapter", unit: "EA", qty: 1, price: 20 },
  { item: "P-trap (to maintain static pressure)", unit: "EA", qty: 2, price: 20 },
  { item: "Garden hose adapter", unit: "EA", qty: 2, price: 1 },
  { item: "Garden hose valve", unit: "EA", qty: 2, price: 1 },
  { item: "Swivel adapter (coil cleaning)", unit: "EA", qty: 1, price: 8 },
  { item: "1/4\" clear plastic hose", unit: "EA", qty: 1, price: 5 },
  { item: "Garden hose, lightweight", unit: "EA", qty: 1, price: 50 },
  { item: "Vinegar (algae prevention)", unit: "EA", qty: 1, price: 3 },
  { item: "PVC adapters 3/4\" straight", unit: "Bag", qty: 1, price: 10 },
  { item: "PVC adapters 3/4\" elbow", unit: "Bag", qty: 1, price: 10 },
  { item: "PVC pipe", unit: "EA", qty: 1, price: 10 },
  { item: "Pipe cleaner (snake)", unit: "EA", qty: 1, price: 8 },
  { item: "Pipe cleaner brush", unit: "EA", qty: 1, price: 8 },
];

/* ---- Labor (source: 'Labor' rows 3-5) ---- */
const LABOR_ROWS = [
  { role: "Transportation",  costHr: 50, hours: 4 },
  { role: "1 Technician",    costHr: 50, hours: 4 },
  { role: "1 Lead",          costHr: 80, hours: 4 },
];

/* ---- Duct cleaning (source: New Install!B22) ---- */
const DUCT_CLEANING_ITEM = { item: "Duct cleaning (whole-system)", price: 500 };

/* ---- UV light air purifier add-on (source: New Install!B19) ---- */
const UV_LIGHT_ITEM = { item: "UV light air purifier — supply and install", price: 399 };

/* ---- Relocate furnace/coil add-on (source: New Install!B18) ---- */
const RELOCATE_ITEM = { item: "Relocate furnace and coil — base support prep", price: 500 };

/* ---- Maintenance plan tiers — starter template (no source sheet data; edit freely) ---- */
const MAINTENANCE_PLANS = [
  { name: "Basic Plan", visitsPerYear: 1, pricePerYear: 149, features: ["1 annual tune-up & safety inspection", "Filter check", "10% discount on repairs"] },
  { name: "Comfort Plan", visitsPerYear: 2, pricePerYear: 249, features: ["2 seasonal tune-ups (spring & fall)", "Priority scheduling", "15% discount on repairs", "No overtime charges"] },
  { name: "Premium Plan", visitsPerYear: 2, pricePerYear: 349, features: ["2 seasonal tune-ups + 1 courtesy visit", "Same-day priority scheduling", "20% discount on repairs & parts", "Free filter replacements", "No overtime charges"] },
];

/* ---- Inspection / QC checklist (source: 'Inspection' rows 2-13) ---- */
const INSPECTION_ITEMS = [
  "Check against the quotation for scope match",
  "Electrical whip installed and sized correctly",
  "Disconnect installed and labeled",
  "Condenser pad level and set",
  "Condenser pad leveling shims installed as needed",
  "Plenum change labor included in coil job (if applicable)",
  "P-trap installed on condensate line",
  "Float switch installed and tested",
  "Copper tube condition checked — replace if required",
  "Line-set size confirmed correct",
  "If compressor burned out — line-set flush performed",
  "Electrical connection amperage checked and recorded",
];
