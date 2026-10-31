if (typeof require !== "undefined") { var { fmt, pad } = require("./calendar.js"); }
// Misma técnica que scripts/excel_xml.py: edita solo sheet1.xml dentro del ZIP.
const SHEET = "xl/worksheets/sheet1.xml";
const serial = d => Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30)) / 86400000);

function setCell(xml, ref, { num, text }) {
  const re = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
  const m = re.exec(xml);
  if (!m) throw new Error("No se encontró la celda " + ref);
  const attrs = m[1].replace(/\s+t="[^"]*"/, "");
  const cell = text !== undefined
    ? `<c r="${ref}"${attrs} t="inlineStr"><is><t>${text}</t></is></c>`
    : `<c r="${ref}"${attrs}><v>${num}</v></c>`;
  return xml.slice(0, m.index) + cell + xml.slice(m.index + m[0].length);
}

function editSheetXml(xml, b) {
  xml = setCell(xml, "B11", { num: b.numero });
  xml = setCell(xml, "E11", { text: `Desde ${fmt(b.desde)} hasta ${fmt(b.hasta)}` });
  for (const r of ["F47","F49","F51","F53","F55"]) xml = setCell(xml, r, { num: serial(b.desde) });
  for (const r of ["G47","G49","G51","G53","G55"]) xml = setCell(xml, r, { num: serial(b.hasta) });
  return setCell(xml, "H71", { num: serial(b.entrega) });
}

async function generateXlsx(templateBuffer, b) {
  const zip = await JSZip.loadAsync(templateBuffer);
  zip.file(SHEET, editSheetXml(await zip.file(SHEET).async("string"), b));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
if (typeof module !== "undefined") module.exports = { editSheetXml, serial };
