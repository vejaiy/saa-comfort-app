/* ============================================================
   SAA Comfort Air LLC — pricing data
   Ported from System_Replacement_Material_Cost.xlsx.
   Edit the numbers below to update prices across the whole site —
   every worksheet page reads from this one file.
   ============================================================ */

/* ---- Equipment price-by-tonnage tables (source: Replacement!P6:S13, P18:S30) ---- */
const CONDENSER_TONNAGE = [
  { tonnage: 1.5, desc: "Single speed condenser", low: 2000, high: 2200 },
  { tonnage: 2,   desc: "Single speed condenser", low: 2200, high: 2420 },
  { tonnage: 2.5, desc: "Single speed condenser", low: 2300, high: 2530 },
  { tonnage: 3,   desc: "Single speed condenser", low: 2500, high: 2750 },
  { tonnage: 3.5, desc: "Single speed condenser", low: 2800, high: 3080 },
  { tonnage: 4,   desc: "Single speed condenser", low: 3100, high: 3410 },
  { tonnage: 5,   desc: "Single speed condenser", low: 3500, high: 3850 },
  { tonnage: 6,   desc: "Single speed condenser", low: 5000, high: 5500 },
];

const COIL_TONNAGE = [
  { tonnage: 1.5, desc: "Cased Coil", low: 750,  high: 825 },
  { tonnage: 2,   desc: "Cased Coil", low: 850,  high: 935 },
  { tonnage: 2.5, desc: "Cased Coil", low: 1000, high: 1100 },
  { tonnage: 3,   desc: "Cased Coil", low: 1000, high: 1100 },
  { tonnage: 3.5, desc: "Cased Coil", low: 1300, high: 1430 },
  { tonnage: 4,   desc: "Cased Coil", low: 1400, high: 1540 },
  { tonnage: 5,   desc: "Cased Coil", low: 1500, high: 1650 },
  { tonnage: 6,   desc: "Cased Coil", low: 1800, high: 1980 },
];

/* ---- Furnace tiers (sheet had no source data — starter tiers, edit freely) ---- */
const FURNACE_TIERS = [
  { id: "80std", label: "80% AFUE — single-stage (standard)", low: 1500, high: 1800 },
  { id: "96two", label: "96% AFUE — two-stage",               low: 2400, high: 2800 },
  { id: "96mod", label: "96% AFUE — variable-speed / modulating", low: 3200, high: 3800 },
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
   group: MATERIALS | ACCESSORIES   optional: Yes | Check | Optional
   tonnageLinked: true -> row's low/high is driven by the tonnage picker */
const CONDENSER_MATERIALS = [
  { group: "MATERIALS",   category: "Equipment",    item: "3-ton condenser unit (size below)", unit: "EA", qty: 1, low: 2500, high: 2750, spec: "AHRI-matched, 208/230V-1ph — confirm refrigerant type (R-410A vs A2L R-454B)", notes: "New outdoor condensing unit sized to match the existing coil/furnace.", optional: "Yes", tonnageLinked: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Refrigerant charge", unit: "OZ", qty: 0.08, low: 200, high: 250, spec: "R-410A or A2L per system, ~8-10 lb typical for 3-ton", notes: "Refrigerant weighed to nameplate spec, adjusted for line length.", optional: "Yes" },
  { group: "MATERIALS",   category: "Refrigeration", item: "POE refrigerant oil", unit: "OZ", qty: 1, low: 20, high: 22, spec: "POE, viscosity per condenser OEM spec", notes: "Compatible lubricant added per manufacturer spec.", optional: "Yes" },
  { group: "MATERIALS",   category: "Refrigeration", item: "Line-set flare nuts / couplings", unit: "EA", qty: 0, low: 15, high: 16.5, spec: "Match existing line-set OD (3/8\" & 3/4\" typical 3-ton)", notes: "Reconnects line set to new condenser fittings.", optional: "Check" },
  { group: "MATERIALS",   category: "Brazing",      item: "Nitrogen (job usage)", unit: "OZ", qty: 1, low: 15, high: 16.5, spec: "Per-job cylinder rental/fill portion", notes: "Purge gas during brazing and pressure test.", optional: "Yes" },
  { group: "MATERIALS",   category: "Electrical",   item: "Electrical whip", unit: "EA", qty: 0, low: 35, high: 38.5, spec: "Sized to unit MCA/MOCP, typically 10/3 or 8/3 AWG", notes: "Power connection from disconnect to condenser.", optional: "Check" },
  { group: "MATERIALS",   category: "Electrical",   item: "Disconnect switch", unit: "EA", qty: 0, low: 40, high: 44, spec: "Non-fused pull-out, 60A, weatherproof", notes: "Local electrical disconnect at the condenser.", optional: "Check" },
  { group: "MATERIALS",   category: "Installation", item: "Condenser pad", unit: "EA", qty: 0, low: 60, high: 66, spec: "Composite, 36\"x36\"x3\" or equivalent", notes: "Level composite/concrete base for the new unit.", optional: "Check" },
  { group: "MATERIALS",   category: "Installation", item: "Pad shims / leveling material", unit: "Bag", qty: 0, low: 10, high: 11, spec: "Composite shims, assorted thickness", notes: "Fine-levels the pad on uneven ground.", optional: "Check" },
  { group: "MATERIALS",   category: "Electrical",   item: "Wire nuts / tape / anti-oxidant compound", unit: "Bag", qty: 1, low: 15, high: 16.5, spec: "UL-listed connectors, anti-oxidant paste", notes: "Electrical connection finishing, incl. aluminum whip prep.", optional: "Yes" },
  { group: "MATERIALS",   category: "Equipment",    item: "Liquid-line filter drier", unit: "EA", qty: 1, low: 50, high: 80, spec: "Sized to line OD and system tonnage", notes: "Replaced any time the system is opened; mandatory after contamination/burnout.", optional: "Yes" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Hard start kit", unit: "EA", qty: 0, low: 60, high: 66, spec: "Single-phase, sized to compressor RLA", notes: "Reduces compressor inrush current; recommended on long line runs or weak supply.", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Whole-unit surge protector", unit: "EA", qty: 0, low: 80, high: 88, spec: "Line-side, condenser-rated", notes: "Protects condenser electronics from grid/storm surges.", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Low-ambient control kit", unit: "EA", qty: 0, low: 70, high: 77, spec: "Fan-cycling switch or head-pressure control", notes: "Enables reliable operation below manufacturer's rated ambient minimum.", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Compressor crankcase heater", unit: "EA", qty: 0, low: 50, high: 55, spec: "Wrap-style, sized to compressor", notes: "Prevents refrigerant migration into the compressor in cold weather (if not factory-included).", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Sound blanket / compressor cover", unit: "EA", qty: 0, low: 90, high: 99, spec: "Universal fit, weatherproof", notes: "Reduces operating noise — common customer request.", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Condenser security cage", unit: "EA", qty: 0, low: 150, high: 165, spec: "Powder-coated steel, ground-anchored", notes: "Theft deterrent for the outdoor unit.", optional: "Optional" },
  { group: "ACCESSORIES", category: "Accessory",    item: "Line-set cover / channel kit", unit: "EA", qty: 0, low: 45, high: 49.5, spec: "10 ft kit, paintable PVC", notes: "Cosmetic cover for exposed exterior line set.", optional: "Check" },
];

/* ---- Coil Change worksheet (source: 'Coil Change' rows 2-33) ---- */
const COIL_MATERIALS = [
  { group: "MATERIALS", category: "Refrigeration",   item: "Evaporator coil – matched replacement (size below)", unit: "EA", qty: 1, low: 1000, high: 1100, notes: "OEM/matched coil; size and refrigerant dependent", optional: "Yes", tonnageLinked: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "TXV / metering device", unit: "EA", qty: 0, low: 80, high: 200, notes: "If not supplied with coil or replacement is required", optional: "Check" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Filter-drier", unit: "EA", qty: 0, low: 50, high: 80, notes: "Replace when refrigeration circuit is opened", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant R-410A ($200/25lb allowance)", unit: "OZ", qty: 0.08, low: 200, high: 250, spec: "EPA-approved, dual-port, R-410A/A2L rated", notes: "Allowance only; use actual refrigerant and charge requirement", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Nitrogen / pressure-test allowance", unit: "LOT", qty: 1, low: 15, high: 30, notes: "Purging and pressure testing", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 3/8\"", unit: "FT", qty: 0.25, low: 20, high: 50, notes: "Couplings, elbows and brazing material", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 1\"", unit: "FT", qty: 0.25, low: 40, high: 80, optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper fittings", unit: "Bag", qty: 1, low: 30, high: 50, notes: "Couplings, elbows and brazing material", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper brazing alloy", unit: "LOT", qty: 1, low: 5, high: 8, notes: "Couplings, elbows and brazing material", optional: "Yes" },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant pipe insulation", unit: "8FT", qty: 2, low: 24, high: 36, notes: "Replace disturbed insulation", optional: "Yes" },
  { group: "MATERIALS", category: "Air Distribution", item: "Duct mastic / approved sealant", unit: "EA", qty: 1, low: 15, high: 35, notes: "Seal disturbed duct joints", optional: "Yes" },
  { group: "MATERIALS", category: "Air Distribution", item: "UL-181 foil tape", unit: "Roll", qty: 0.5, low: 15, high: 30, notes: "Approved duct sealing tape", optional: "Yes" },
  { group: "MATERIALS", category: "Air Distribution", item: "Zip ties for duct branches", unit: "Pack", qty: 0.25, low: 50, high: 80, notes: "2ft to 3ft long zip ties for ducting", optional: "Check" },
  { group: "MATERIALS", category: "Air Distribution", item: "Air filter", unit: "EA", qty: 1, low: 40, high: 60, optional: "Yes" },
  { group: "MATERIALS", category: "Drainage",         item: "PVC tube 3/4\", 8ft", unit: "EA", qty: 1, low: 10, high: 15, notes: "Typically PVC/CPVC; verify existing installation", optional: "Yes" },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" elbow", unit: "Bag", qty: 1, low: 6, high: 10, optional: "Yes" },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" straight", unit: "Bag", qty: 1, low: 6, high: 10, optional: "Yes" },
  { group: "MATERIALS", category: "Drainage",         item: "P-trap / condensate trap", unit: "EA", qty: 1, low: 15, high: 40, notes: "Configuration dependent", optional: "Yes" },
  { group: "MATERIALS", category: "Drainage",         item: "Cleanout / vent fittings", unit: "LOT", qty: 1, low: 10, high: 30, notes: "For serviceability and drain configuration", optional: "Yes" },
  { group: "MATERIALS", category: "Safety",           item: "Primary drain float/overflow switch", unit: "EA", qty: 1, low: 25, high: 50, notes: "Safety shutoff; application dependent", optional: "Check" },
  { group: "MATERIALS", category: "Equipment Support", item: "Structural support / hanging hardware", unit: "LOT", qty: 1, low: 75, high: 150, notes: "Angles, rods, brackets, anchors", optional: "Check" },
  { group: "MATERIALS", category: "Equipment Support", item: "Vibration isolation pads", unit: "Set", qty: 0, low: 20, high: 75, notes: "Where applicable", optional: "Check" },
  { group: "MATERIALS", category: "Electrical",       item: "Low-voltage wire/connectors", unit: "LOT", qty: 1, low: 15, high: 50, notes: "For safety switches/controls", optional: "Yes" },
  { group: "MATERIALS", category: "Electrical",       item: "Wire nuts", unit: "Bag", qty: 1, low: 10, high: 30, notes: "Miscellaneous electrical material for furnace/EEV/switch connections", optional: "Yes" },
  { group: "MATERIALS", category: "Electrical",       item: "Electric conduit", unit: "Bag", qty: 0, low: 10, high: 25, optional: "Check" },
  { group: "MATERIALS", category: "Electrical",       item: "Wire cover", unit: "Bag", qty: 0, low: 10, high: 15, optional: "Check" },
  { group: "MATERIALS", category: "Electrical",       item: "Conduit fitting with strain relief", unit: "EA", qty: 1, low: 1, high: 3, optional: "Yes" },
  { group: "MATERIALS", category: "Electrical",       item: "Wire terminals", unit: "EA", qty: 4, low: 1, high: 3, optional: "Yes" },
  { group: "MATERIALS", category: "Cleaning",         item: "Cleaning/sanitizing materials", unit: "LOT", qty: 1, low: 15, high: 50, notes: "Coil/pan/drain area", optional: "Yes" },
  { group: "MATERIALS", category: "Permits",          item: "Permit/inspection allowance", unit: "LOT", qty: 1, low: 50, high: 250, notes: "Local jurisdiction dependent", optional: "Check" },
  { group: "MATERIALS", category: "Disposable",       item: "Old equipment disposal fee / plastic packaging recycle fee", unit: "EA", qty: 1, low: 150, high: 250, optional: "Check" },
  { group: "MATERIALS", category: "Cleaning",         item: "Bucket", unit: "EA", qty: 1, low: 15, high: 20, optional: "Yes" },
];

/* ---- Furnace Change worksheet — starter list (no source sheet data; edit freely) ---- */
const FURNACE_MATERIALS = [
  { group: "MATERIALS", category: "Equipment",  item: "Furnace unit (tier below)", unit: "EA", qty: 1, low: 1500, high: 1800, notes: "Sized to duct system and BTU load", optional: "Yes", tierLinked: true },
  { group: "MATERIALS", category: "Venting",    item: "Flue / vent pipe extension", unit: "LOT", qty: 1, low: 60, high: 150, notes: "Category I or PVC intake/exhaust depending on tier", optional: "Check" },
  { group: "MATERIALS", category: "Gas",        item: "Gas line / flex connector", unit: "EA", qty: 1, low: 35, high: 75, notes: "Sized to furnace BTU input", optional: "Yes" },
  { group: "MATERIALS", category: "Electrical", item: "Electrical whip / dedicated circuit", unit: "EA", qty: 0, low: 35, high: 60, optional: "Check" },
  { group: "MATERIALS", category: "Drainage",   item: "Condensate drain / PVC (high-efficiency only)", unit: "LOT", qty: 0, low: 20, high: 45, notes: "Required for 90%+ AFUE units", optional: "Check" },
  { group: "MATERIALS", category: "Air",        item: "Air filter", unit: "EA", qty: 1, low: 20, high: 35, optional: "Yes" },
  { group: "MATERIALS", category: "Permits",    item: "Permit/inspection allowance", unit: "LOT", qty: 1, low: 50, high: 200, optional: "Check" },
  { group: "MATERIALS", category: "Disposable", item: "Old equipment disposal fee", unit: "EA", qty: 1, low: 75, high: 125, optional: "Check" },
  { group: "MATERIALS", category: "Electrical", item: "Wire nuts / misc electrical", unit: "Bag", qty: 1, low: 10, high: 20, optional: "Yes" },
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
  { category: "Drainage", item: "Secondary/emergency drain pipe & fittings (male threaded)", unit: "LOT", qty: 1, low: 10, high: 15, spec: "3/4 in. PVC Sch 40 90-deg fitting (10-pack), male threaded", notes: "If required by installation" },
  { category: "Drainage", item: "Secondary/emergency drain pipe & fittings (female threaded)", unit: "LOT", qty: 1, low: 10, high: 15, spec: "3/4 in. PVC Sch 40 90-deg fitting (10-pack), female threaded" },
  { category: "Drainage", item: "Secondary/emergency drain pan", unit: "EA", qty: 1, low: 75, high: 200, spec: "Drip pan, 27\" x 48\"", notes: "Size to equipment footprint" },
  { category: "Safety",   item: "Secondary pan float switch", unit: "EA", qty: 1, low: 25, high: 50, spec: "3/4\" float switch, L-shape HVAC safety switch", notes: "Overflow protection" },
  { category: "Safety",   item: "Additional drain-line safety switch", unit: "EA", qty: 0, low: 25, high: 50, notes: "Optional additional protection" },
  { category: "Equipment Support", item: "Base/support platform", unit: "EA", qty: 1, low: 75, high: 150, notes: "Wood/metal/composite support as required" },
];
const DRAINPAN_LABOR = { techs: 1, hours: 2, rateLow: 30, rateHigh: 50 };

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
  { role: "Transportation",  costHr: 50, hoursLow: 4, hoursHigh: 8 },
  { role: "1 Technician",    costHr: 50, hoursLow: 4, hoursHigh: 8 },
  { role: "1 Lead",          costHr: 80, hoursLow: 4, hoursHigh: 8 },
];

/* ---- Duct cleaning (source: New Install!B22) ---- */
const DUCT_CLEANING_ITEM = { item: "Duct cleaning (whole-system)", low: 500, high: 750 };

/* ---- UV light air purifier add-on (source: New Install!B19) ---- */
const UV_LIGHT_ITEM = { item: "UV light air purifier — supply and install", low: 399, high: 499 };

/* ---- Relocate furnace/coil add-on (source: New Install!B18) ---- */
const RELOCATE_ITEM = { item: "Relocate furnace and coil — base support prep", low: 500, high: 750 };

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
