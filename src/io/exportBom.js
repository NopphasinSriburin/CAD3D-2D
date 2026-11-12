import { buildXlsx } from './xlsx.js';

const MONEY = '#,##0.00;(#,##0.00);"-"';

const STYLES = {
  title: { bold: true, size: 14, color: '111827' },
  sub: { size: 9, color: '4B5563' },
  legend: { size: 9, color: '0000FF', fill: 'FFFF00' },
  legendText: { size: 9, color: '374151' },
  group: { bold: true, fill: 'E5E7EB', align: 'center', border: true },
  hdr: { bold: true, color: 'FFFFFF', fill: '1F2937', align: 'center', wrap: true, border: true },
  text: { border: true },
  center: { border: true, align: 'center' },
  int: { border: true, align: 'center', numFmt: '#,##0' },
  num1: { border: true, numFmt: '#,##0.0' },
  na: { border: true, align: 'center', color: '9CA3AF' },
  inText: { border: true, color: '0000FF', fill: 'FFFF00' },
  inInt: { border: true, align: 'center', color: '0000FF', fill: 'FFFF00', numFmt: '#,##0' },
  inNum: { border: true, color: '0000FF', fill: 'FFFF00', numFmt: '#,##0.00' },
  inMoney: { border: true, color: '0000FF', fill: 'FFFF00', numFmt: MONEY },
  inPct: { border: true, color: '0000FF', fill: 'FFFF00', numFmt: '0.0%' },
  fNum1: { border: true, numFmt: '#,##0.0' },
  fMoney: { border: true, numFmt: MONEY },
  link1: { border: true, color: '008000', numFmt: '#,##0.0' },
  linkMoney: { border: true, color: '008000', numFmt: MONEY },
  totLabel: { bold: true, fill: 'F3F4F6', border: true },
  totInt: { bold: true, fill: 'F3F4F6', border: true, align: 'center', numFmt: '#,##0' },
  totNum1: { bold: true, fill: 'F3F4F6', border: true, numFmt: '#,##0.0' },
  totMoney: { bold: true, fill: 'F3F4F6', border: true, numFmt: MONEY },
  totBlank: { fill: 'F3F4F6', border: true },
  section: { bold: true, fill: 'E5E7EB', border: true },
  noteHead: { bold: true, size: 9, color: '111827' },
  note: { size: 9, color: '374151' },
  noteNum: { size: 9, color: '374151', align: 'left', numFmt: '0"."' },
  grandLabel: { bold: true, size: 11, fill: 'FFE4D2', border: true },
  grandMoney: { bold: true, size: 11, fill: 'FFE4D2', border: true, numFmt: MONEY },
  grandBlank: { fill: 'FFE4D2', border: true },
};

const c = (v, s) => ({ v, s });
const f = (formula, s) => ({ f: formula, s });

/**
 * parts: from computeBOM. info: { title, sourceName, date, units, material, density, thickness, price, meshNote }
 * Returns XLSX bytes with a BOM sheet and a linked CBD sheet.
 */
export function buildBomWorkbook(parts, info) {
  const COLS = 21; // A..U
  const first = 7; // first data row (Excel numbering)
  const last = first + parts.length - 1;
  const totalRow = last + 1;

  const bom = [];
  const fill = (row, style) => Array.from({ length: COLS }, (_, i) => row[i] ?? (style ? c('', style) : null));

  bom[0] = [c(`BOM — ${info.title}`, 'title')];
  bom[1] = [c(`ไฟล์ต้นฉบับ: ${info.sourceName}  ·  สร้างโดย MorphCAD  ·  ${info.date}  ·  หน่วย: ความยาว mm, พื้นที่ cm², ปริมาตร cm³, น้ำหนัก g, เงิน บาท`, 'sub')];
  bom[2] = [c('ช่องสีเหลือง', 'legend'), c('= ค่าที่กรอก/แก้ได้ (ตัวอักษรน้ำเงิน)  ·  ตัวอักษรดำ = สูตรคำนวณอัตโนมัติ  ·  ขนาดและพื้นที่วัดจากโมเดล', 'legendText')];
  bom[4] = fill({
    0: c('ชิ้นส่วน', 'group'),
    4: c('ขนาดและพื้นที่ — วัดจากโมเดล', 'group'),
    12: c('วัสดุ น้ำหนัก และค่าวัสดุ', 'group'),
  }, 'group');
  bom[5] = [
    'ลำดับ', 'ชื่อชิ้นส่วน', 'จำนวน\n(ชิ้น/ชุด)', 'ประเภท', 'กว้าง X\n(mm)', 'ยาว Y\n(mm)', 'สูง Z\n(mm)',
    'พื้นที่ผิว\n(cm²)', 'พื้นที่ฉาย\nมองตาม X (cm²)', 'พื้นที่ฉาย\nมองตาม Y (cm²)', 'พื้นที่ฉาย\nมองตาม Z (cm²)',
    'ปริมาตรทึบ\n(cm³)', 'ความหนา\n(mm)', 'ปริมาตรวัสดุ\n(cm³)', 'วัสดุ', 'ความหนาแน่น\n(g/cm³)',
    'น้ำหนัก/ชิ้น\n(g)', 'น้ำหนักรวม\n(g)', 'ราคาวัสดุ\n(บาท/kg)', 'ค่าวัสดุ/ชิ้น\n(บาท)', 'ค่าวัสดุรวม\n(บาท)',
  ].map((h) => c(h, 'hdr'));

  parts.forEach((p, i) => {
    const R = first + i;
    bom[R - 1] = [
      c(i + 1, 'int'),
      c(p.name, 'text'),
      c(p.qty, 'inInt'),
      c(p.closed ? 'ทึบ (Solid)' : 'ผิวบาง (Surface)', 'center'),
      c(p.dims.x, 'num1'),
      c(p.dims.y, 'num1'),
      c(p.dims.z, 'num1'),
      c(p.area, 'num1'),
      c(p.projected.x, 'num1'),
      c(p.projected.y, 'num1'),
      c(p.projected.z, 'num1'),
      p.closed ? c(p.volume, 'num1') : c('', 'na'),
      p.closed ? c('–', 'na') : c(info.thickness ?? '', 'inNum'),
      f(`IF(L${R}<>"",L${R},IF(M${R}="","",H${R}*M${R}/10))`, 'fNum1'),
      c(info.material || '', 'inText'),
      c(info.density ?? '', 'inNum'),
      f(`IF(OR(N${R}="",P${R}=""),"",N${R}*P${R})`, 'fNum1'),
      f(`IF(Q${R}="","",Q${R}*C${R})`, 'fNum1'),
      c(info.price ?? '', 'inMoney'),
      f(`IF(OR(Q${R}="",S${R}=""),"",Q${R}/1000*S${R})`, 'fMoney'),
      f(`IF(T${R}="","",T${R}*C${R})`, 'fMoney'),
    ];
  });

  const rng = (col) => `${col}${first}:${col}${last}`;
  bom[totalRow - 1] = fill({
    0: c('', 'totBlank'),
    1: c('รวม (คูณจำนวนแล้ว)', 'totLabel'),
    2: f(`SUM(${rng('C')})`, 'totInt'),
    7: f(`SUMPRODUCT(${rng('H')},${rng('C')})`, 'totNum1'),
    13: f(`SUMPRODUCT(${rng('N')},${rng('C')})`, 'totNum1'),
    17: f(`SUM(${rng('R')})`, 'totNum1'),
    20: f(`SUM(${rng('U')})`, 'totMoney'),
  }, 'totBlank');

  const notes = [
    'ขนาด X / Y / Z คือกรอบสี่เหลี่ยมล้อมชิ้นงาน (bounding box) ตามแกนของไฟล์ต้นฉบับ',
    'พื้นที่ฉาย = พื้นที่เงาของชิ้นงานเมื่อมองตามแกนนั้น ใช้ประเมินแรงปิดแม่พิมพ์ — เลือกแกนที่ตรงกับทิศถอดแม่พิมพ์',
    'ชิ้นงานประเภท "ผิวบาง" ไม่มีความหนาในโมเดล ปริมาตรวัสดุจึงคำนวณจาก พื้นที่ผิว × ความหนา ที่กรอก',
    info.material || info.density || info.thickness
      ? `ค่าเริ่มต้นที่กรอกไว้ (วัสดุ ${info.material || '-'}, ความหนาแน่น ${info.density ?? '-'} g/cm³, ความหนา ${info.thickness ?? '-'} mm) เป็นค่าสมมติที่ตั้งจากหน้าเว็บ — แก้ให้ตรงกับวัสดุจริง`
      : 'ยังไม่ได้ระบุวัสดุ — กรอกความหนาแน่นและราคาวัสดุเพื่อคำนวณน้ำหนักและค่าวัสดุ',
    info.meshNote || 'ค่าที่วัดมาจาก mesh ของโมเดล จึงอาจคลาดเคลื่อนเล็กน้อยจากพื้นผิวจริง',
    'แถวรวม: พื้นที่ผิวและปริมาตรคูณจำนวนชิ้นแล้ว · ชีต CBD ดึงค่าจากแถวรวมนี้',
  ];
  bom[totalRow + 1] = [c('หมายเหตุและสมมติฐาน', 'noteHead')];
  notes.forEach((n, i) => {
    bom[totalRow + 2 + i] = [c(i + 1, 'noteNum'), c(n, 'note')];
  });

  const bomSheet = {
    name: 'BOM',
    cols: [6, 30, 9, 15, 10, 10, 10, 11, 13, 13, 13, 11, 10, 12, 18, 12, 11, 11, 11, 12, 12],
    rows: bom,
    merges: ['A1:U1', 'A2:U2', 'B3:U3', 'A5:D5', 'E5:L5', 'M5:U5'],
    freezeRows: 6,
    heights: { 0: 24, 5: 42 },
  };

  // ------------------------------------------------------------------ CBD
  const B = (r) => `B${r}`;
  const cbd = [];
  cbd[0] = [c(`CBD — Cost Breakdown ต่อ 1 ชุด · ${info.title}`, 'title')];
  cbd[1] = [c(`อ้างอิงชีต BOM  ·  ${info.date}  ·  เงินเป็นบาท`, 'sub')];
  cbd[2] = [c('ช่องสีเหลือง', 'legend'), c('= กรอก/แก้ได้  ·  ตัวอักษรเขียว = ดึงจากชีต BOM  ·  ตัวอักษรดำ = สูตร', 'legendText')];
  cbd[4] = ['หัวข้อ', 'ค่า', 'หน่วย', 'หมายเหตุ'].map((h) => c(h, 'hdr'));
  const rows = [
    ['section', 'ข้อมูลจาก BOM'],
    ['row', 'น้ำหนักวัสดุรวม', f(`BOM!R${totalRow}`, 'link1'), 'g', 'จากแถวรวมของชีต BOM'],
    ['row', 'พื้นที่ผิวรวม', f(`BOM!H${totalRow}`, 'link1'), 'cm²', 'ใช้ประเมินค่าทำสี / ชุบผิว'],
    ['row', 'พื้นที่ฉายสูงสุด', f(`MAX(BOM!I${first}:K${last})`, 'link1'), 'cm²', 'ของชิ้นที่ใหญ่ที่สุด ทุกแกน — ตรวจทิศถอดแม่พิมพ์อีกครั้ง'],
    ['row', 'แรงดันในแม่พิมพ์', c(350, 'inNum'), 'kgf/cm²', 'ค่าตัวอย่างสำหรับพลาสติกฉีดทั่วไป (ราว 300–500) — แก้ตามวัสดุและแม่พิมพ์จริง'],
    ['row', 'แรงปิดแม่พิมพ์โดยประมาณ', 'TONNAGE', 'ตัน', '= พื้นที่ฉาย × แรงดัน ÷ 1000 ใช้เลือกขนาดเครื่องฉีด'],
    ['section', 'ต้นทุนต่อชุด'],
    ['row', 'ค่าวัสดุ', f(`BOM!U${totalRow}`, 'linkMoney'), 'บาท', 'จากชีต BOM (ต้องกรอกราคาวัสดุในชีต BOM)'],
    ['row', 'อัตราเผื่อเศษวัสดุ / รันเนอร์', c(0.03, 'inPct'), '%', 'ค่าตัวอย่าง — แก้ตามกระบวนการจริง'],
    ['row', 'ค่าเศษวัสดุ', 'SCRAP', 'บาท', '= ค่าวัสดุ × อัตราเผื่อเศษ'],
    ['row', 'ค่าขึ้นรูป / แปรรูป', c('', 'inMoney'), 'บาท', 'เช่น อัตราค่าเครื่องต่อชั่วโมง × รอบเวลาผลิต'],
    ['row', 'ค่าทำสี / ผิว', c('', 'inMoney'), 'บาท', 'อ้างอิงพื้นที่ผิวรวมด้านบน'],
    ['row', 'ค่าบรรจุภัณฑ์และขนส่ง', c('', 'inMoney'), 'บาท', ''],
    ['row', 'รวมต้นทุนผลิต', 'SUBTOTAL', 'บาท', ''],
    ['row', 'อัตราโสหุ้ย', c(0.1, 'inPct'), '%', 'ค่าตัวอย่าง — แก้ตามนโยบายบริษัท'],
    ['row', 'ค่าโสหุ้ย', 'OVERHEAD', 'บาท', '= รวมต้นทุนผลิต × อัตราโสหุ้ย'],
    ['row', 'อัตรากำไร', c(0.05, 'inPct'), '%', 'ค่าตัวอย่าง — แก้ตามนโยบายบริษัท'],
    ['row', 'กำไร', 'PROFIT', 'บาท', '= (ต้นทุนผลิต + โสหุ้ย) × อัตรากำไร'],
    ['grand', 'ราคาต่อชุด', 'PRICE', 'บาท', ''],
  ];
  // Resolve Excel row numbers for the formula placeholders
  const at = {};
  rows.forEach((r, i) => {
    at[r[1]] = 6 + i;
  });
  const placeholders = {
    TONNAGE: f(`${B(at['พื้นที่ฉายสูงสุด'])}*${B(at['แรงดันในแม่พิมพ์'])}/1000`, 'fNum1'),
    SCRAP: f(`${B(at['ค่าวัสดุ'])}*${B(at['อัตราเผื่อเศษวัสดุ / รันเนอร์'])}`, 'fMoney'),
    SUBTOTAL: f(`SUM(${B(at['ค่าวัสดุ'])},${B(at['ค่าเศษวัสดุ'])}:${B(at['ค่าบรรจุภัณฑ์และขนส่ง'])})`, 'fMoney'),
    OVERHEAD: f(`${B(at['รวมต้นทุนผลิต'])}*${B(at['อัตราโสหุ้ย'])}`, 'fMoney'),
    PROFIT: f(`(${B(at['รวมต้นทุนผลิต'])}+${B(at['ค่าโสหุ้ย'])})*${B(at['อัตรากำไร'])}`, 'fMoney'),
    PRICE: f(`${B(at['รวมต้นทุนผลิต'])}+${B(at['ค่าโสหุ้ย'])}+${B(at['กำไร'])}`, 'grandMoney'),
  };
  rows.forEach((r, i) => {
    const idx = 5 + i;
    if (r[0] === 'section') {
      cbd[idx] = [c(r[1], 'section'), c('', 'section'), c('', 'section'), c('', 'section')];
      return;
    }
    const grand = r[0] === 'grand';
    const value = typeof r[2] === 'string' ? placeholders[r[2]] : r[2];
    cbd[idx] = [c(r[1], grand ? 'grandLabel' : 'text'), value, c(r[3], grand ? 'grandBlank' : 'center'), c(r[4], grand ? 'grandBlank' : 'text')];
  });
  const cbdSheet = {
    name: 'CBD',
    cols: [30, 16, 10, 62],
    rows: cbd,
    merges: ['A1:D1', 'A2:D2', 'B3:D3'],
    freezeRows: 5,
    heights: { 0: 24, 4: 22 },
  };

  return buildXlsx({ sheets: [bomSheet, cbdSheet], styles: STYLES, title: `BOM — ${info.title}` });
}
