const { describe, it }= require('mocha');
const { assert } = require('chai');

const readIncomingSheet = require('../parse-sheet');

describe('Parse sheet', () => {
  it('should read keys/values as an object', async () => {
    const input = `
    "key_1","key_2"
    "value 1","value 2"
    `;

    const records = await readIncomingSheet(input);

    assert.deepEqual(records, [{ key_1: 'value 1', key_2: 'value 2' }])
  });  
});