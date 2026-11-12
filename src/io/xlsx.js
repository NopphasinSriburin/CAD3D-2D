import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';

/*
 * Minimal XLSX (SpreadsheetML) writer: inline strings, numbers, formulas, named cell styles,
 * column widths, row heights, merges and a frozen header. Formulas are written without cached
 * values and the workbook asks Excel to recalculate on open.
 *
 * sheet = { name, cols: [width...], rows: [[cell...]...], merges: ['A1:F1'], freezeRows, heights: { rowIndex: pt } }
 * cell  = null | { v, f, s }   (v: string | number, f: formula without '=', s: style name)
 * style = { bold, italic, size, color, fill, numFmt, align, valign, wrap, border }
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function buildStyles(styles) {
  const names = Object.keys(styles);
  const fonts = ['<font><sz val="10"/><name val="Arial"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left style="thin"><color rgb="FFC9CED8"/></left><right style="thin"><color rgb="FFC9CED8"/></right><top style="thin"><color rgb="FFC9CED8"/></top><bottom style="thin"><color rgb="FFC9CED8"/></bottom><diagonal/></border>'];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = {};
  names.forEach((name, i) => {
    const st = styles[name];
    fonts.push(`<font>${st.bold ? '<b/>' : ''}${st.italic ? '<i/>' : ''}<sz val="${st.size || 10}"/><color rgb="FF${st.color || '000000'}"/><name val="Arial"/></font>`);
    let fillId = 0;
    if (st.fill) {
      fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${st.fill}"/><bgColor indexed="64"/></patternFill></fill>`);
      fillId = fills.length - 1;
    }
    let numFmtId = 0;
    if (st.numFmt) {
      numFmtId = 164 + numFmts.length;
      numFmts.push(`<numFmt numFmtId="${numFmtId}" formatCode="${esc(st.numFmt)}"/>`);
    }
    const align = st.align || st.valign || st.wrap
      ? `<alignment${st.align ? ` horizontal="${st.align}"` : ''} vertical="${st.valign || 'center'}"${st.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fonts.length - 1}" fillId="${fillId}" borderId="${st.border ? 1 : 0}" xfId="0" applyFont="1"${fillId ? ' applyFill="1"' : ''}${numFmtId ? ' applyNumberFormat="1"' : ''}${st.border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`);
    index[name] = i + 1;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xml, index };
}

function buildSheet(sheet, styleIndex) {
  const rows = sheet.rows
    .map((row, r) => {
      if (!row) return '';
      const ht = sheet.heights && sheet.heights[r] ? ` ht="${sheet.heights[r]}" customHeight="1"` : '';
      const cells = row
        .map((cell, c) => {
          if (!cell) return '';
          const ref = `${colName(c)}${r + 1}`;
          const s = cell.s ? ` s="${styleIndex[cell.s] || 0}"` : '';
          if (cell.f) return `<c r="${ref}"${s}><f>${esc(cell.f)}</f></c>`;
          if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return `<c r="${ref}"${s}><v>${cell.v}</v></c>`;
          if (cell.v === undefined || cell.v === null || cell.v === '') return s ? `<c r="${ref}"${s}/>` : '';
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}"${ht}>${cells}</row>`;
    })
    .join('');
  const pane = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  const cols = sheet.cols && sheet.cols.length
    ? `<cols>${sheet.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const merges = sheet.merges && sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${merges}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function buildXlsx({ sheets, styles, title = '' }) {
  const { xml: stylesXml, index } = buildStyles(styles);
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>MorphCAD</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesXml,
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = buildSheet(s, index);
  });
  const zipInput = {};
  for (const [name, text] of Object.entries(files)) zipInput[name] = strToU8(text);
  return zipSync(zipInput);
}
