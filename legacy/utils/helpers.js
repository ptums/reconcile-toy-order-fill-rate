const formatDate = (data) => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
const removeDuplicates = (arr) => arr.filter((thing, index) => {
  const _thing = JSON.stringify(thing);
  return index === arr.findIndex((obj) => JSON.stringify(obj) === _thing);
});

const chunkRecords = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    const chunk = arr.slice(i, i + size);
    result.push(chunk);
  }
  return result;
};

const stripTitle = (str) => str.replace(/[^a-zA-Z ]/g, '').replace(/\s/g, '').toLowerCase();

module.exports = {
  formatDate,
  removeDuplicates,
  chunkRecords,
  stripTitle
};
