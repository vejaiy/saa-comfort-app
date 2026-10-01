/* ============================================================
   SAA Comfort Air LLC — shared Excel (.xlsx) export (Round 77, 2026-10-01)
   Per Vijayan: "update all excel downloads to have specific formats,
   legible and highlight good, set column width accordingly ... easy to
   scroll left to right ... when downloading excel include receipts, tools,
   supplies and expenses in separate tab."

   Replaces the old plain-CSV downloads with REAL .xlsx workbooks built
   in the browser with no library: a hand-written SpreadsheetML package in
   an uncompressed (stored) zip. Each sheet gets a dark-blue title bar, a
   subtitle line, a blue header row, zebra-striped rows, optional
   highlighted rows (needs review = yellow, negative / return = red),
   column widths chosen per column, wrapped long-text columns with a
   matching row height, frozen title + header (and first column(s)),
   filter buttons, Excel date / currency formats, and a live =SUM total row.
   Because it is a true .xlsx (UTF-8 inside), characters like the em dash
   can never turn into "â€”" the way they did in a BOM-less CSV.

   API
     saaXlsxDownload(filename, sheets)  -> builds + downloads
     saaXlsxBuild(sheets)               -> Blob (used by tests)
   sheet = {
     name:      "Receipts",              // <= 31 chars
     title:     "SAA Comfort Air LLC - August 2026 Purchase Receipts",
     subtitle:  "Generated Oct 1, 2026 | 12 items",
     tabColor:  "2F5496",                 // optional hex
     freezeCols: 2,                       // optional, columns kept in view
     columns: [{ header, width, type, total }],
        type: text | wrap | center | date | datetime | money | int | num   (default text)
        total: true -> a =SUM() is written in the total row
     rows:     [[cell, ...], ...]         // date cells: 'YYYY-MM-DD' or ISO
     flags:    [null | "warn" | "neg" | "mute", ...]   // optional, one per row
   totalIf:  { col: 0, equals: "Yes" }    // optional: total only rows where that column matches
     totals:   true                        // add the total row
     emptyText: "No entries ..."           // shown when there are no rows
   }
   ============================================================ */

(function () {
  "use strict";

  /* ---------- small helpers ---------- */
  const enc = new TextEncoder();

  function colLetter(i) { // 0 -> A
    let s = "";
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function xmlEsc(v) {
    return String(v == null ? "" : v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function dateSerial(v) {
    if (v == null || v === "") return null;
    let y, m, d;
    const mm = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
    else {
      const dt = v instanceof Date ? v : new Date(v);
      if (isNaN(dt.getTime())) return null;
      y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate();
    }
    return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
  }
  function dateTimeSerial(v) {
    if (v == null || v === "") return null;
    const dt = v instanceof Date ? v : new Date(v);
    if (isNaN(dt.getTime())) return null;
    const day = Math.round(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()) / 86400000) + 25569;
    const frac = (dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds()) / 86400;
    return Math.round((day + frac) * 1e6) / 1e6;
  }
  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  /* ---------- styles ---------- */
  // fills: 0 none, 1 gray125 (required), 2 title, 3 header, 4 band, 5 warn, 6 neg, 7 total, 8 subtitle, 9 mute (grey)
  const FILLS = [null, "gray125", "1F3864", "2F5496", "EEF3FA", "FFF2CC", "FADBD8", "D9E1F2", "F3F6FB", "E7E9EC"];
  // fonts: 0 body, 1 title, 2 subtitle, 3 header, 4 total
  const FONTS = [
    '<font><sz val="10"/><color rgb="FF1F2933"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="15"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
    '<font><i/><sz val="10"/><color rgb="FF5B6770"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
    '<font><b/><sz val="10.5"/><color rgb="FF1F3864"/><name val="Calibri"/><family val="2"/></font>',
  ];
  // borders: 0 none, 1 thin light grid, 2 total (medium top)
  const BORDERS = [
    "<border><left/><right/><top/><bottom/><diagonal/></border>",
    '<border><left style="thin"><color rgb="FFD0D7E5"/></left><right style="thin"><color rgb="FFD0D7E5"/></right><top style="thin"><color rgb="FFD0D7E5"/></top><bottom style="thin"><color rgb="FFD0D7E5"/></bottom><diagonal/></border>',
    '<border><left style="thin"><color rgb="FFD0D7E5"/></left><right style="thin"><color rgb="FFD0D7E5"/></right><top style="medium"><color rgb="FF1F3864"/></top><bottom style="medium"><color rgb="FF1F3864"/></bottom><diagonal/></border>',
  ];
  const NUMFMTS = {
    date: { id: 164, code: "d-mmm-yyyy" },
    money: { id: 165, code: '"$"#,##0.00;[Red]-"$"#,##0.00' },
    num: { id: 166, code: "#,##0.0" },
    datetime: { id: 167, code: "d-mmm-yyyy h:mm AM/PM" },
  };

  function makeStyles() {
    const xfs = [];
    const index = {};
    function add(key, xml) { index[key] = xfs.length; xfs.push(xml); return index[key]; }
    add("default", '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');

    function get(kind, type, fill) {
      const key = kind + "|" + (type || "") + "|" + (fill || 0);
      if (index[key] != null) return index[key];
      let numFmtId = 0, align = '<alignment vertical="center"/>';
      if (type === "datetime") { numFmtId = NUMFMTS.datetime.id; align = '<alignment horizontal="center" vertical="center"/>'; }
      else if (type === "date") { numFmtId = NUMFMTS.date.id; align = '<alignment horizontal="center" vertical="center"/>'; }
      else if (type === "money") { numFmtId = NUMFMTS.money.id; align = '<alignment horizontal="right" vertical="center"/>'; }
      else if (type === "num") { numFmtId = NUMFMTS.num.id; align = '<alignment horizontal="right" vertical="center"/>'; }
      else if (type === "int" || type === "center") { align = '<alignment horizontal="center" vertical="center"/>'; }
      else if (type === "wrap") { align = '<alignment vertical="center" wrapText="1"/>'; }
      if (kind === "title") return add(key, '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>');
      if (kind === "subtitle") return add(key, '<xf numFmtId="0" fontId="2" fillId="8" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center" indent="1"/></xf>');
      if (kind === "header") return add(key, '<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>');
      if (kind === "total") return add(key, `<xf numFmtId="${numFmtId}" fontId="4" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
      // body cell
      return add(key, `<xf numFmtId="${numFmtId}" fontId="0" fillId="${fill || 0}" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`);
    }
    function xml() {
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<numFmts count="4">${Object.values(NUMFMTS).map((n) => `<numFmt numFmtId="${n.id}" formatCode="${xmlEsc(n.code)}"/>`).join("")}</numFmts>` +
        `<fonts count="${FONTS.length}">${FONTS.join("")}</fonts>` +
        `<fills count="${FILLS.length}">${FILLS.map((f) => f === null ? '<fill><patternFill patternType="none"/></fill>' : f === "gray125" ? '<fill><patternFill patternType="gray125"/></fill>' : `<fill><patternFill patternType="solid"><fgColor rgb="FF${f}"/><bgColor indexed="64"/></patternFill></fill>`).join("")}</fills>` +
        `<borders count="${BORDERS.length}">${BORDERS.join("")}</borders>` +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>";
    }
    return { get, xml };
  }

  /* ---------- sheet xml ---------- */
  function sanitizeSheetName(n, used) {
    let s = String(n || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet";
    let base = s, i = 2;
    while (used.has(s.toLowerCase())) { s = base.slice(0, 28) + " " + i++; }
    used.add(s.toLowerCase());
    return s;
  }

  function textCell(ref, style, text) {
    const t = String(text);
    const pres = /^\s|\s$|\n/.test(t) ? ' xml:space="preserve"' : "";
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${pres}>${xmlEsc(t)}</t></is></c>`;
  }
  function blankCell(ref, style) { return `<c r="${ref}" s="${style}"/>`; }

  function estLines(text, width) {
    const per = Math.max(4, Math.floor(width * 1.15));
    let lines = 0;
    String(text).split("\n").forEach((p) => { lines += Math.max(1, Math.ceil(p.length / per)); });
    return lines;
  }

  function sheetXml(sheet, styles, sheetIdx) {
    const cols = sheet.columns;
    const nCols = cols.length;
    const lastCol = colLetter(nCols - 1);
    const rows = sheet.rows || [];
    const HDR = 3; // header row number
    const first = HDR + 1;
    const last = HDR + Math.max(rows.length, 0);
    let out = "";
    const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];

    // title + subtitle
    out += `<row r="1" ht="28" customHeight="1">${textCell("A1", styles.get("title"), sheet.title || sheet.name)}${cols.slice(1).map((_, i) => blankCell(colLetter(i + 1) + "1", styles.get("title"))).join("")}</row>`;
    out += `<row r="2" ht="18" customHeight="1">${textCell("A2", styles.get("subtitle"), sheet.subtitle || "")}${cols.slice(1).map((_, i) => blankCell(colLetter(i + 1) + "2", styles.get("subtitle"))).join("")}</row>`;
    // header
    out += `<row r="${HDR}" ht="32" customHeight="1">${cols.map((c, i) => textCell(colLetter(i) + HDR, styles.get("header"), c.header)).join("")}</row>`;

    // body
    const sums = cols.map(() => 0);
    rows.forEach((row, ri) => {
      const r = first + ri;
      const flag = sheet.flags && sheet.flags[ri];
      const fill = flag === "warn" ? 5 : flag === "neg" ? 6 : flag === "mute" ? 9 : (ri % 2 === 1 ? 4 : 0);
      let maxLines = 1;
      let cells = "";
      cols.forEach((c, ci) => {
        const ref = colLetter(ci) + r;
        const type = c.type || "text";
        const st = styles.get("body", type, fill);
        const v = row[ci];
        if (v == null || v === "") { cells += blankCell(ref, st); return; }
        if (type === "date" || type === "datetime") {
          const s = type === "date" ? dateSerial(v) : dateTimeSerial(v);
          cells += s == null ? textCell(ref, styles.get("body", "center", fill), v) : `<c r="${ref}" s="${st}"><v>${s}</v></c>`;
        } else if (type === "money" || type === "num" || type === "int") {
          const n = num(v);
          if (n == null) cells += textCell(ref, st, v);
          else {
            cells += `<c r="${ref}" s="${st}"><v>${n}</v></c>`;
            if (c.total && !(sheet.totalIf && String(row[sheet.totalIf.col]) !== sheet.totalIf.equals)) sums[ci] += n;
          }
        } else {
          cells += textCell(ref, st, v);
          if (type === "wrap") maxLines = Math.max(maxLines, estLines(v, c.width || 30));
        }
      });
      const ht = maxLines > 1 ? ` ht="${Math.min(160, 14 + (maxLines - 1) * 13)}" customHeight="1"` : ' ht="18" customHeight="1"';
      out += `<row r="${r}"${ht}>${cells}</row>`;
    });

    // empty message
    let lastRow = last;
    if (!rows.length) {
      const r = first;
      out += `<row r="${r}" ht="24" customHeight="1">${textCell("A" + r, styles.get("body", "text", 0), sheet.emptyText || "No entries for this period.")}${cols.slice(1).map((_, i) => blankCell(colLetter(i + 1) + r, styles.get("body", "text", 0))).join("")}</row>`;
      merges.push(`A${r}:${lastCol}${r}`);
      lastRow = r;
    }

    // totals
    if (sheet.totals && rows.length) {
      const r = last + 1;
      let cells = "";
      cols.forEach((c, ci) => {
        const ref = colLetter(ci) + r;
        const type = c.type || "text";
        if (ci === 0) cells += textCell(ref, styles.get("total", "text"), `TOTAL (${rows.length} ${rows.length === 1 ? "item" : "items"})`);
        else if (c.total) {
          const L = colLetter(ci);
          const formula = sheet.totalIf
            ? `SUMIF($${colLetter(sheet.totalIf.col)}$${first}:$${colLetter(sheet.totalIf.col)}$${last},"${sheet.totalIf.equals}",${L}${first}:${L}${last})`
            : `SUM(${L}${first}:${L}${last})`;
          cells += `<c r="${ref}" s="${styles.get("total", type)}"><f>${xmlEsc(formula)}</f><v>${Math.round(sums[ci] * 100) / 100}</v></c>`;
        }
        else cells += blankCell(ref, styles.get("total", "text"));
      });
      out += `<row r="${r}" ht="22" customHeight="1">${cells}</row>`;
      lastRow = r;
    }

    const freezeCols = Math.min(sheet.freezeCols || 0, Math.max(0, nCols - 1));
    const topLeft = colLetter(freezeCols) + (HDR + 1);
    const pane = `<pane${freezeCols ? ` xSplit="${freezeCols}"` : ""} ySplit="${HDR}" topLeftCell="${topLeft}" activePane="${freezeCols ? "bottomRight" : "bottomLeft"}" state="frozen"/>` +
      (freezeCols ? `<selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${topLeft}" sqref="${topLeft}"/>` : `<selection pane="bottomLeft" activeCell="${topLeft}" sqref="${topLeft}"/>`);
    const colXml = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join("");
    const filter = rows.length ? `<autoFilter ref="A${HDR}:${lastCol}${last}"/>` : "";

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheetPr>${sheet.tabColor ? `<tabColor rgb="FF${sheet.tabColor}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<dimension ref="A1:${lastCol}${lastRow}"/>` +
      `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${sheetIdx === 0 ? ' tabSelected="1"' : ""} zoomScale="100">${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="18"/>' +
      `<cols>${colXml}</cols>` +
      `<sheetData>${out}</sheetData>` +
      filter +
      `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` +
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '<headerFooter><oddFooter>&amp;L&amp;8SAA Comfort Air LLC&amp;C&amp;8&amp;A&amp;R&amp;8Page &amp;P of &amp;N</oddFooter></headerFooter>' +
      "</worksheet>";
  }

  /* ---------- zip (stored) ---------- */
  let _crcTable = null;
  function crc32(bytes) {
    if (!_crcTable) {
      _crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) { // files: [{name, data(Uint8Array)}]
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [], central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + f.data.length;
    });
    let centralSize = 0;
    central.forEach((c) => { centralSize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  /* ---------- workbook ---------- */
  function saaXlsxBuild(sheets) {
    const list = (sheets || []).filter(Boolean);
    if (!list.length) throw new Error("saaXlsxBuild: no sheets");
    const styles = makeStyles();
    const used = new Set();
    const names = list.map((s) => sanitizeSheetName(s.name, used));
    const sheetFiles = list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s, styles, i)) }));
    const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const files = [
      { name: "[Content_Types].xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>") },
      { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`) },
      { name: "docProps/core.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(list[0].title || "SAA Comfort Air export")}</dc:title><dc:creator>SAA Comfort Air LLC</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`) },
      { name: "docProps/app.xml", data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>SAA Comfort Air</Application></Properties>') },
      { name: "xl/workbook.xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="15000" activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><definedNames>${names.map((n, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xmlEsc(n).replace(/'/g, "''")}'!$3:$3</definedName>`).join("")}</definedNames></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`) },
      { name: "xl/styles.xml", data: enc.encode(styles.xml()) },
      ...sheetFiles,
    ];
    return zipStore(files);
  }

  function saaXlsxDownload(filename, sheets) {
    const blob = saaXlsxBuild(sheets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = /\.xlsx$/i.test(filename) ? filename : filename + ".xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return blob;
  }

  // Shared small helpers the pages use when assembling sheets.
  function saaXlsxTodayLabel() {
    return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function saaXlsxStamp() { // YYYY-MM-DD for file names
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  window.saaXlsxBuild = saaXlsxBuild;
  window.saaXlsxDownload = saaXlsxDownload;
  window.saaXlsxTodayLabel = saaXlsxTodayLabel;
  window.saaXlsxStamp = saaXlsxStamp;
})();
