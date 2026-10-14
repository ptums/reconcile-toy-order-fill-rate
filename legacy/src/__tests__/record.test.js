const { describe, it }= require('mocha');
const { expect }= require('chai');

const Record = require('../Record');

describe('Record', () => {
  const recordOne = new Record('1045', '6101959', 15, 0, 0.4, 'Description of toy');

  it('should create a new post', () => {
    expect(Object.keys(recordOne).length).to.equal(6);
  });

  it('newPost.poNumber should equal 1045', () => {
    expect(recordOne.poNumber).to.equal('1045');
  });

  it('newPost should be an object', () => {
    expect(typeof recordOne).to.equal('object');
  });
});