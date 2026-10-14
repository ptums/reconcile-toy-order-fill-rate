const Failures = require("../src/models/Failures");

function FailedOrder(orderId, item, error, where) {
  this.orderId = orderId;
  this.item = item;
  this.error = error;
  this.where = where;
}

const createFailure = async (orderId, item, error, where) => {
  const order = new FailedOrder(orderId, item, error, where);
  const storeFailure = await Failures.create(order);

  return storeFailure;
};

module.exports = createFailure;