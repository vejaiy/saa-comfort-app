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
   group: MATERIALS | ACCESSORIES
   tonnageLinked: true -> row's price is driven by the tonnage picker
   Round 41 (2026-09-18), per Vijayan's reference spreadsheet: the single
   included:true/false default became two configuration-specific flags --
   includedSingleStage / includedVariableSpeed -- true = counted by
   default under that configuration, false = technician toggles it on.
   Picking a Configuration on the worksheet (see the Condenser Change page
   and renderLineItemTable's configOptions in worksheet.js) resets every
   row's Included checkbox to the matching flag; the technician can still
   toggle any individual row afterward. */
const CONDENSER_MATERIALS = [
  { group: "MATERIALS",   category: "Equipment",    item: "Condenser unit (per System tonnage above)", unit: "EA", qty: 1, price: 2500, spec: "AHRI-matched, 208/230V-1ph — confirm refrigerant type (R-410A vs A2L R-454B)", notes: "New outdoor condensing unit sized to match the existing coil/furnace.", includedSingleStage: true, includedVariableSpeed: true, tonnageLinked: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Refrigerant charge", unit: "OZ", qty: 0.08, price: 200, spec: "R-410A or A2L per system, ~8-10 lb typical for 3-ton", notes: "Refrigerant weighed to nameplate spec, adjusted for line length.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "POE refrigerant oil", unit: "OZ", qty: 1, price: 20, spec: "POE, viscosity per condenser OEM spec", notes: "Compatible lubricant added per manufacturer spec.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Line-set flare nuts / couplings", unit: "EA", qty: 0, price: 15, spec: "Match existing line-set OD (3/8\" & 3/4\" typical 3-ton)", notes: "Reconnects line set to new condenser fittings.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "MATERIALS",   category: "Brazing",      item: "Nitrogen (job usage)", unit: "OZ", qty: 1, price: 15, spec: "Per-job cylinder rental/fill portion", notes: "Purge gas during brazing and pressure test.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Electrical",   item: "Electrical whip", unit: "EA", qty: 0, price: 35, spec: "Sized to unit MCA/MOCP, typically 10/3 or 8/3 AWG", notes: "Power connection from disconnect to condenser.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "MATERIALS",   category: "Electrical",   item: "Disconnect switch", unit: "EA", qty: 0, price: 40, spec: "Non-fused pull-out, 60A, weatherproof", notes: "Local electrical disconnect at the condenser.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "MATERIALS",   category: "Installation", item: "Condenser pad", unit: "EA", qty: 0, price: 60, spec: "Composite, 36\"x36\"x3\" or equivalent", notes: "Level composite/concrete base for the new unit.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "MATERIALS",   category: "Installation", item: "Pad shims / leveling material", unit: "Bag", qty: 0, price: 10, spec: "Composite shims, assorted thickness", notes: "Fine-levels the pad on uneven ground.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "MATERIALS",   category: "Electrical",   item: "Wire nuts / tape / anti-oxidant compound", unit: "Bag", qty: 1, price: 15, spec: "UL-listed connectors, anti-oxidant paste", notes: "Electrical connection finishing, incl. aluminum whip prep.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Equipment",    item: "Liquid-line filter drier", unit: "EA", qty: 1, price: 50, spec: "Sized to line OD and system tonnage", notes: "Replaced any time the system is opened; mandatory after contamination/burnout.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Rx11 Flush (Nu-Calgon 4300-30, 19.5oz)", unit: "EA", qty: 1, price: 62.63, spec: "Nu-Calgon 4300-30, non-flammable, non-toxic, 19.5 fl oz can", notes: "Flushes the existing line set/coil of old oil and contaminants before charging the new condenser — added 2026-09-13 per Vijayan's request; price from SupplyHouse.", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Drainage",     item: "Armaflex insulation — drain line, 1/2\" wall x 3/4\" O.D., 6ft stick", unit: "EA", qty: 1, price: 9.97, spec: "K-Flex Insul-Lock DS Overlap, 3/4\" Pipe (O.D.) x 1/2\" Wall, closed-cell elastomeric foam (Armaflex-equivalent)", notes: "Insulates the condensate drain line — added 2026-09-13 per Vijayan's request; price from SupplyHouse (K-Flex 6RXLO048068).", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Armaflex insulation — suction line, 1\" wall, 1\" nominal, 6ft stick", unit: "EA", qty: 1, price: 27.60, spec: "K-Flex Insul-Lock, 1-1/8\" Pipe (O.D.) x 1\" Wall, closed-cell elastomeric foam (Armaflex-equivalent) — sized to the actual 1-1/8\" O.D. of 1\" nominal copper refrigeration tube", notes: "Insulates the suction line — added 2026-09-13 per Vijayan's request; price from SupplyHouse (K-Flex 6RXL100118).", includedSingleStage: true, includedVariableSpeed: true },
  { group: "MATERIALS",   category: "Refrigeration", item: "Armaflex insulation — liquid line, 1/2\" wall x 3/8\" O.D., 6ft stick", unit: "EA", qty: 1, price: 6.78, spec: "K-Flex Insul-Lock DS Overlap, 3/8\" Pipe (O.D.) x 1/2\" Wall, closed-cell elastomeric foam (Armaflex-equivalent)", notes: "Insulates the liquid line — added 2026-09-13 per Vijayan's request; price from SupplyHouse (K-Flex 6RXLO048038).", includedSingleStage: true, includedVariableSpeed: true },
  { group: "ACCESSORIES", category: "Accessory",    item: "Hard start kit", unit: "EA", qty: 0, price: 60, spec: "Single-phase, sized to compressor RLA", notes: "Reduces compressor inrush current; recommended on long line runs or weak supply.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Whole-unit surge protector", unit: "EA", qty: 0, price: 80, spec: "Line-side, condenser-rated", notes: "Protects condenser electronics from grid/storm surges.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Low-ambient control kit", unit: "EA", qty: 0, price: 70, spec: "Fan-cycling switch or head-pressure control", notes: "Enables reliable operation below manufacturer's rated ambient minimum.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Compressor crankcase heater", unit: "EA", qty: 0, price: 50, spec: "Wrap-style, sized to compressor", notes: "Prevents refrigerant migration into the compressor in cold weather (if not factory-included).", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Sound blanket / compressor cover", unit: "EA", qty: 0, price: 90, spec: "Universal fit, weatherproof", notes: "Reduces operating noise — common customer request.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Condenser security cage", unit: "EA", qty: 0, price: 150, spec: "Powder-coated steel, ground-anchored", notes: "Theft deterrent for the outdoor unit.", includedSingleStage: false, includedVariableSpeed: false },
  { group: "ACCESSORIES", category: "Accessory",    item: "Line-set cover / channel kit", unit: "EA", qty: 0, price: 45, spec: "10 ft kit, paintable PVC", notes: "Cosmetic cover for exposed exterior line set.", includedSingleStage: false, includedVariableSpeed: false },
];

/* ---- Coil Change worksheet (source: 'Coil Change' rows 2-33) ----
   Round 41 (2026-09-18), per Vijayan's reference spreadsheet: the single
   included:true/false default became two configuration-specific flags --
   includedUpflow / includedHorizontal -- same picker mechanism described
   above CONDENSER_MATERIALS. */
const COIL_MATERIALS = [
  { group: "MATERIALS", category: "Refrigeration",   item: "Evaporator coil – matched replacement (per System tonnage above)", unit: "EA", qty: 1, price: 1000, notes: "OEM/matched coil; size and refrigerant dependent", includedUpflow: true, includedHorizontal: true, tonnageLinked: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "TXV / metering device", unit: "EA", qty: 0, price: 80, notes: "If not supplied with coil or replacement is required", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Refrigeration",   item: "Filter-drier", unit: "EA", qty: 0, price: 50, notes: "Replace when refrigeration circuit is opened", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant R-410A ($200/25lb allowance)", unit: "OZ", qty: 0.08, price: 200, spec: "EPA-approved, dual-port, R-410A/A2L rated", notes: "Allowance only; use actual refrigerant and charge requirement", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Nitrogen / pressure-test allowance", unit: "LOT", qty: 1, price: 15, notes: "Purging and pressure testing", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 3/8\"", unit: "FT", qty: 0.25, price: 20, notes: "Couplings, elbows and brazing material", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper tube 1\"", unit: "FT", qty: 0.25, price: 40, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper fittings", unit: "Bag", qty: 1, price: 30, notes: "Couplings, elbows and brazing material", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Copper brazing alloy", unit: "LOT", qty: 1, price: 5, notes: "Couplings, elbows and brazing material", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Refrigeration",   item: "Refrigerant pipe insulation", unit: "8FT", qty: 2, price: 24, notes: "Replace disturbed insulation", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Air Distribution", item: "Duct mastic / approved sealant", unit: "EA", qty: 1, price: 15, notes: "Seal disturbed duct joints", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Air Distribution", item: "UL-181 foil tape", unit: "Roll", qty: 0.5, price: 15, notes: "Approved duct sealing tape", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Air Distribution", item: "Zip ties for duct branches", unit: "Pack", qty: 0.25, price: 50, notes: "2ft to 3ft long zip ties for ducting", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Air Distribution", item: "Air filter", unit: "EA", qty: 1, price: 40, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Job Site Protection", item: "HDX Painter's Plastic (12ft x 400ft, .31mil)", unit: "EA", qty: 0.25, price: 34.98, spec: "HDX HSHD12-400, clear, high-density sheeting", notes: "Protects flooring/furnishings around the coil access area during the change-out — shared roll, billed as a per-job usage allowance; added 2026-09-13 per Vijayan's request; price from Home Depot.", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC tube 3/4\", 8ft", unit: "EA", qty: 1, price: 10, notes: "Typically PVC/CPVC; verify existing installation", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" elbow", unit: "Bag", qty: 1, price: 6, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Drainage",         item: "PVC fitting 3/4\" straight", unit: "Bag", qty: 1, price: 6, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Drainage",         item: "P-trap / condensate trap", unit: "EA", qty: 1, price: 15, notes: "Configuration dependent", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Drainage",         item: "Cleanout / vent fittings", unit: "LOT", qty: 1, price: 10, notes: "For serviceability and drain configuration", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Safety",           item: "Primary drain float/overflow switch (Safe-T-Switch, SS2-GEN3)", unit: "EA", qty: 1, price: 30.17, spec: "Daikin/Goodman part #97087", notes: "Safety shutoff; application dependent — updated 2026-09-16 to the actual Safe-T-Switch SS2-GEN3 model/price per Vijayan's request (was a generic $25 placeholder; real cost from a 2026-09-15 receipt).", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Equipment Support", item: "Structural support / hanging hardware", unit: "LOT", qty: 1, price: 75, notes: "Angles, rods, brackets, anchors", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Equipment Support", item: "Vibration isolation pads", unit: "Set", qty: 0, price: 20, notes: "Where applicable", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Electrical",       item: "Low-voltage wire/connectors", unit: "LOT", qty: 1, price: 15, notes: "For safety switches/controls", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Electrical",       item: "Wire nuts", unit: "Bag", qty: 1, price: 10, notes: "Miscellaneous electrical material for furnace/EEV/switch connections", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Electrical",       item: "Electric conduit", unit: "Bag", qty: 0, price: 10, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Electrical",       item: "Wire cover", unit: "Bag", qty: 0, price: 10, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Electrical",       item: "Conduit fitting with strain relief", unit: "EA", qty: 1, price: 1, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Electrical",       item: "Wire terminals", unit: "EA", qty: 4, price: 1, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Cleaning",         item: "Cleaning/sanitizing materials", unit: "LOT", qty: 1, price: 15, notes: "Coil/pan/drain area", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Permits",          item: "Permit/inspection allowance", unit: "LOT", qty: 1, price: 50, notes: "Local jurisdiction dependent", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Disposable",       item: "Old equipment disposal fee / plastic packaging recycle fee", unit: "EA", qty: 1, price: 150, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Cleaning",         item: "Bucket", unit: "EA", qty: 1, price: 15, includedUpflow: true, includedHorizontal: true },
  // Round 26 (2026-09-14), per Vijayan: "Add Heater stand 2 qty, $30 each
  // for Coils change worksheet" -- opt-in like the other job-site-dependent
  // support hardware above (Structural support / Vibration isolation), so
  // it defaults off but pre-fills qty 2 the moment it's switched on.
  // Round 32 (2026-09-16): Vijayan asked to mark this included by default.
  { group: "MATERIALS", category: "Equipment Support", item: "Heater stand", unit: "EA", qty: 2, price: 30, notes: "Elevates the indoor coil/air handler off the platform where required", includedUpflow: true, includedHorizontal: true },
  // Round 32 (2026-09-16), per Vijayan: "CC MAC Air Filter Media, 16x25x4.5,
  // M11 to coil change worksheet mark included" -- real Daikin/Goodman OEM
  // media filter cartridge; price from a 2026-09-14 receipt (job
  // J-2026-0004-Sreedhar, Invoice 2122677).
  { group: "MATERIALS", category: "Air Distribution", item: "CC MAC Air Filter Media, 16x25x4.5, M11", unit: "EA", qty: 1, price: 70.15, spec: "Daikin/Goodman OEM media filter cartridge, 16x25x4.5, MERV 11", includedUpflow: true, includedHorizontal: true },
  // Round 32 (2026-09-16), per Vijayan: "Add poly backed canvas 2qty to
  // Coils change worksheet" -- Everbilt 4ft x 14ft poly-backed canvas drop
  // cloth, same job-site-protection role as the HDX Painter's Plastic row
  // above; price from Home Depot. No "mark included" instruction was given
  // for this one, so it defaults off (opt-in) like the other job-dependent
  // protection/support items on this sheet -- flip on per job as needed.
  { group: "MATERIALS", category: "Job Site Protection", item: "Poly Backed Canvas Drop Cloth (Everbilt, 4ft x 14ft)", unit: "EA", qty: 2, price: 34.98, spec: "Everbilt 4 ft. x 14 ft. Poly Backed Canvas Drop Cloth", notes: "Heavier-duty floor/furnishing protection alternative to the plastic sheeting above.", includedUpflow: false, includedHorizontal: false },
];

/* ---- Furnace Change worksheet — starter list (no source sheet data; edit freely) ----
   Round 41 (2026-09-18), per Vijayan's reference spreadsheet: the single
   included:true/false default became two configuration-specific flags --
   includedUpflow / includedHorizontal -- same picker mechanism described
   above CONDENSER_MATERIALS. */
const FURNACE_MATERIALS = [
  { group: "MATERIALS", category: "Equipment",  item: "Furnace unit (per Furnace tier above)", unit: "EA", qty: 1, price: 1500, notes: "Sized to duct system and BTU load", includedUpflow: true, includedHorizontal: true, tierLinked: true },
  { group: "MATERIALS", category: "Venting",    item: "Flue / vent pipe extension", unit: "LOT", qty: 1, price: 60, notes: "Category I or PVC intake/exhaust depending on tier", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Gas",        item: "Gas line / flex connector", unit: "EA", qty: 1, price: 35, notes: "Sized to furnace BTU input", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Gas",        item: "Gas line pipe & pipe fitting", unit: "EA", qty: 1, price: 15, notes: "Black iron pipe/fittings for the gas line run", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Electrical", item: "Electrical whip / dedicated circuit", unit: "EA", qty: 0, price: 35, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Drainage",   item: "Condensate drain / PVC (high-efficiency only)", unit: "LOT", qty: 0, price: 20, notes: "Required for 90%+ AFUE units", includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Air",        item: "Air filter", unit: "EA", qty: 1, price: 20, includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Permits",    item: "Permit/inspection allowance", unit: "LOT", qty: 1, price: 50, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Disposable", item: "Old equipment disposal fee", unit: "EA", qty: 1, price: 75, includedUpflow: false, includedHorizontal: false },
  { group: "MATERIALS", category: "Electrical", item: "Wire nuts / misc electrical", unit: "Bag", qty: 1, price: 10, includedUpflow: true, includedHorizontal: true },
  // Round 26 (2026-09-14), per Vijayan: "...and 2qty, $30 each for furnace
  // change worksheet" -- same opt-in Heater stand item as Coil Change above.
  // Round 32 (2026-09-16): Vijayan asked to mark this included by default.
  { group: "MATERIALS", category: "Equipment Support", item: "Heater stand", unit: "EA", qty: 2, price: 30, notes: "Elevates the furnace off the platform where required", includedUpflow: true, includedHorizontal: true },
  // Round 32 (2026-09-16), per Vijayan: "Add items 1211NPL qty1, 12CAP,
  // Qty2, 1290ELB, qty2, 123NPL qty1, Mastic Tape 3"X100', CC MAC Air Filter
  // Media, 16x25x4.5, M11 to Furnace change worksheet mark all these
  // included" -- all six real parts/prices from a 2026-09-15 Daikin Pearland
  // pick ticket (the four small PVC fittings) and a 2026-09-14 Daikin
  // Goodman-Katy invoice (Mastic Tape, filter media), both tied to job
  // J-2026-0004-Sreedhar's condensate-drain/high-efficiency-furnace tie-in.
  { group: "MATERIALS", category: "Plumbing / PVC Fittings", item: "1/2\" x 11\" Nipple", unit: "EA", qty: 1, price: 4.09, spec: "SKU 1211NPL", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Plumbing / PVC Fittings", item: "1/2\" Cap", unit: "EA", qty: 2, price: 1.29, spec: "SKU 12CAP", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Plumbing / PVC Fittings", item: "1/2\" 90 Deg Elbow", unit: "EA", qty: 2, price: 1.74, spec: "SKU 1290ELB", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Plumbing / PVC Fittings", item: "1/2\" x 3\" Nipple", unit: "EA", qty: 1, price: 1.01, spec: "SKU 123NPL", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Adhesives & Sealants", item: "Mastic Tape, 3\" x 100'", unit: "EA", qty: 1, price: 38.82, spec: "SKU 304100-HC", notes: "Price from the 2026-09-14 job-billed purchase (a separate 2026-09-11 SAA-Tools restock of the same tape rang up at $28.19 — flagged in case that's the number Vijayan intended).", includedUpflow: true, includedHorizontal: true },
  { group: "MATERIALS", category: "Air", item: "CC MAC Air Filter Media, 16x25x4.5, M11", unit: "EA", qty: 1, price: 70.15, spec: "Daikin/Goodman OEM media filter cartridge, 16x25x4.5, MERV 11", includedUpflow: true, includedHorizontal: true },
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
/* Same concatenation gen_master.py builds for the Drainpan worksheet table
   (DRAINPAN_MATERIALS + its one labor row) -- pulled out to a shared
   constant so the Bill of Material page's auto-derivation (bom-db.js)
   reconstructs the exact same row order/indices from a saved quote's
   form_state without duplicating this list (round 12 redesign, 2026-09-13). */
const DRAINPAN_ROWS = DRAINPAN_MATERIALS.concat([
  { category: "Labor", item: "Installation labor (1 technician)", unit: "HR",
    qty: DRAINPAN_LABOR.techs * DRAINPAN_LABOR.hours, price: DRAINPAN_LABOR.rate, included: true }
]);

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
