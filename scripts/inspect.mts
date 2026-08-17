import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile('/tmp/cleanexport-e2e.xlsx');
const ws = wb.worksheets[0];

const typeName = (t: number) =>
  Object.keys(ExcelJS.ValueType).find((k) => (ExcelJS.ValueType as never)[k] === t) ?? String(t);

console.log('lignes:', ws.rowCount, '| colonnes:', ws.columnCount);
console.log('en-tetes:', JSON.stringify(ws.getRow(1).values));
console.log('---');

ws.eachRow((row, n) => {
  if (n === 1) return;
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const header = ws.getRow(1).getCell(col).value;
    const wrap = cell.alignment?.wrapText ? '  (wrapText)' : '';
    console.log(
      'r' + n + ' ' + String(header).padEnd(20) +
      ' [' + typeName(cell.type).padEnd(6) + '] ' +
      JSON.stringify(cell.value)?.slice(0, 70) + wrap,
    );
  });
});
