const {
  calcuateOrderQuery,
  getOrderGIDUrl,
  updateTheQuantity,
  commitRecentOrderEdits,
} = require('../utils/regular-queries');
const { makeTheQuery } = require('../utils/query-execution');
const createFailure = require('./create-failure');

// get the initial GID url from order name
const fetchOrderGIDurl = async (orderId, description) => {
  const holdGids = await makeTheQuery(getOrderGIDUrl(orderId)).then((data) => data)
    .catch((gidError) => {
      const error = new Error(gidError);
      createFailure(
        orderId,
        description,
        error.toString(),
        'There was an error getting a GID url for this item. Please from it from the CSV file. Find the correct information, add it to a new CSV and reupload',
      );
      return error;
  });

  return holdGids.data.orders.edges[0].node.id;
};


// fetch the calculated order id
const fetchCalcOrderFetch = (id, orderId, description) => {
  return makeTheQuery(calcuateOrderQuery(id))
    .then((res) => ({
      name: res.data.orderEditBegin.calculatedOrder.originalOrder.name,
      id: res.data.orderEditBegin.calculatedOrder.id,
      items: res.data.orderEditBegin.calculatedOrder.lineItems.edges
    }))
    .catch((calcOrderError) => {
      const error = new Error(calcOrderError);
      createFailure(
        orderId,
        description,
        error.toString(),
        'There was an error getting a calculated order information for this item. Please from it from the CSV file. Find the correct information, add it to a new CSV and reupload',
      );
      return error;              
  });
};

// execute updating the quantity for each item
const fetchOrderUpdate = (orderId, description, calcId, lineItemId, newQuantity) => {
  return makeTheQuery(updateTheQuantity(calcId,lineItemId,newQuantity))
    .then((order) => order.data.orderEditSetQuantity)
    .catch((updateError) => {
      const error = new Error(updateError);
      createFailure(
        orderId,
        description,
        error.toString(),
        'requesting to updating the order',
      );

      return error;
    });
};


const fetchCommitOrder = (order) => {
  return makeTheQuery(commitRecentOrderEdits(order.updateInfo.calculatedOrder.id))
    .then((res) => res.data.orderEditCommit)
    .catch((commitError) => {
      const error = new Error(commitError);
      createFailure(
        order.orderId,
        order.item,
        error.toString(),
        'There was an error in requesting to commit the new quantity to this item. Please update manually',
      );
      return error;
    });
}


module.exports = {
  fetchOrderGIDurl,
  fetchCalcOrderFetch,
  fetchOrderUpdate,
  fetchCommitOrder
}
