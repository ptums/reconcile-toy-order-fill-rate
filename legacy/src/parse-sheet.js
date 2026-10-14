const parse = require('csv-parse/lib/sync');
const Record = require('./Record');

const readIncomingSheet = async (file) => {
  const parseFiles = await parse(file, {
    columns: true,
    skip_empty_lines: true,
    quote: '"',
    ltrim: true,
    rtrim: true,
    delimiter: ',',
  }); 
  
  return parseFiles.filter((r) => r['Order #'] !== '' && r.SKU !== '' && r['Final Qty'] !== '').map((record) => new Record(
    record['Order #'],
    record.Description,
    record.SKU,
    record.Variant || '',
    parseInt(record['Final Qty'], 10),
    record.Notes,
  ));
};

module.exports = readIncomingSheet;
