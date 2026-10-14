const {
  fetchOrderGIDurl, fetchCalcOrderFetch, fetchCommitOrder, fetchOrderUpdate,
} = require('../utils/regular-fetches');
const createFailure = require('../utils/create-failure');
const createSuccess = require('../utils/create-success');
const { stripTitle } = require('../utils/helpers');

async function handleRegularOrders(records) {
  // get the GID Urls for each order
  const getGIDUrls = new Promise((resolve) => {
    const ordersWithGIDUrls = [];

    records.forEach((record, index) => {
      const timeGIDUrls = setTimeout(async () => {
        const {
          order, description, sku, quantity,
        } = record;

        try {
          const gidId = await fetchOrderGIDurl(order, description);
          if (gidId) {
            ordersWithGIDUrls.push({
              gidId,
              order,
              description,
              sku,
              quantity,
            });
          } else {
            createFailure(
              order,
              description,
              `There isn't a GID url for ${order}: ${description}`,
              `Please update ${order}: ${description} manually`,
            );
          }
        } catch (err) {
          const error = new Error(err);
          createFailure(
            order,
            description,
            error.toString(),
            'Code not get a GID Url for this item',
          );
        } finally {
          console.info(`1. ${order}: ${description} has a GID url: ${ordersWithGIDUrls[index].gidId}`);
          if (index === records.length - 1) {
            console.log(`Total orders with GID urls: ${records.length}`);
            console.log('=======================');
            clearTimeout(timeGIDUrls);
            resolve(ordersWithGIDUrls);
          }
        }
      }, index * 3000);
    });
  });

  const ordersWithGIDUrls = await getGIDUrls.then((data) => data);

  // get the calculated order id for each order
  const calculateOrdersIds = new Promise((resolve) => {
    const orderQuantityholder = [];

    if (ordersWithGIDUrls.length > 0) {
      // loop through each record and get the order id & the calculated order id
      ordersWithGIDUrls.forEach((orderWithUrl, index) => {
        const timeCalcOrders = setTimeout(async () => {
          const {
            gidId, order, description, sku, quantity,
          } = orderWithUrl;

          try {
            const getCalcOrder = await fetchCalcOrderFetch(gidId, order, description);
            // Organize the results into usable objects
            const lineItemId = getCalcOrder.items.filter((item) => item.node.sku === sku && order === getCalcOrder.name && stripTitle(item.node.title) === stripTitle(description));

            // save the success full results
            if (lineItemId.length > 0) {
              const orderWithLineItems = {
                newQuantity: quantity,
                itemToUpdate: description,
                calcId: getCalcOrder.id,
                orderId: getCalcOrder.name,
                lineItemId: lineItemId[0].node.id,
                description: lineItemId[0].node.title,
              };

              orderQuantityholder.push(orderWithLineItems);
            } else {
              createFailure(
                order,
                description,
                `${description} is not in ${order}`,
                `Add ${description} to order ${order} and update it manually`,
              );
            }
          } catch (err) {
            const error = new Error(err);
            createFailure(
              order,
              description,
              error.toString(),
              'There was an error caculating the order id for this item. Please update manually.',
            );
          } finally {
            console.info(`2. ${order}: ${description} has a calculated order id`);
       
            if (index === ordersWithGIDUrls.length - 1) {
              console.log(`Total orders with Calculated Order Ids: ${ordersWithGIDUrls.length}`);
              console.log('=======================');
              clearTimeout(timeCalcOrders);
              resolve(orderQuantityholder);
            }
          }
        }, index * 4000);
      });
    }
  });

  // return all the order objects with the calculate order id
  const orders = await calculateOrdersIds.then((data) => data);

  // execute the updates on each line item
  const createOrderUpdates = new Promise((resolve) => {
    const holdProcessedOrders = [];

    if (orders.length > 0) {
      orders.forEach((order, index) => {
        const timeCreateOrders = setTimeout(async () => {
          const {
            orderId, description, calcId, lineItemId, newQuantity,
          } = order;

          try {
            const addNewQuantityToOrder = await fetchOrderUpdate(orderId, description, calcId, lineItemId, newQuantity);

            // push the results into storage
            if (addNewQuantityToOrder) {
              holdProcessedOrders.push({
                orderId,
                item: description,
                updateInfo: addNewQuantityToOrder,
              });
            } else {
              createFailure(
                orderId,
                description,
                `Could not add new quantity to ${order}: ${description}`,
                `Please update ${order}: ${description} manually`,
              );
            }
          } catch (err) {
            const error = new Error(err);
            createFailure(
              orderId,
              description,
              error.toString(),
              `${orderId}: ${description} there was an error updating the quantity, please update manually`,
            );
          } finally {
            console.info(`3. ${orderId}: ${description} is updated with a new updated response data: ${JSON.stringify(holdProcessedOrders[index].updateInfo)}`);
            if (orders.length - 1 === index) {
              console.log(`Total orders have been updated: ${orders.length}`);
              console.log('=======================');
              clearTimeout(timeCreateOrders);
              resolve(holdProcessedOrders);
            }
          }
        }, index * 5000);
      });
    }
  });

  const updatedOrders = await createOrderUpdates.then((data) => data);

  // start the commitment order processing
  const commitOrders = new Promise((resolve) => {
    if (updatedOrders.length > 0) {
      updatedOrders.forEach((updateOrder, index) => {
        const timeCommitOrders = setTimeout(async () => {
          const { updateInfo, orderId, item } = updateOrder;

          try {
            if (updateInfo.calculatedOrder !== null) {
              const commitTheOrderUpdate = await fetchCommitOrder(updateOrder);

              if (commitTheOrderUpdate !== undefined) {
                // add them to the success order array
                if (commitTheOrderUpdate.order) {
                  createSuccess(commitTheOrderUpdate.order.id);
                }

                // add all commited orders with errors to the database
                if (commitTheOrderUpdate.userErrors.length > 0) {
                  createFailure(
                    orderId,
                    item,
                    JSON.stringify(commitTheOrderUpdate.userErrors[0]),
                    `${orderId}: ${item} has a response error, please update manually`,
                  );
                }
              } else {
                createFailure(
                  orderId,
                  item,
                  JSON.stringify(commitTheOrderUpdate),
                  `${orderId}: ${description} could not get commited order id, please update manually`,
                );
              }
            }
          } catch (err) {
            const error = new Error(err);
            console.info('Error in commiting orders process...');
            console.info('==========');
            console.error(err);
            createFailure(
              orderId,
              item,
              error.toString(),
              'There was an error commiting the new quantity for this item. Please update manually.',
            );
          } finally {
            console.info(`4. ${orderId}: ${item} is committed`);
            if (updatedOrders.length - 1 === index) {
              console.log(`Total orders have been committed: ${updatedOrders.length}`);
              console.log('=======================');
              clearTimeout(timeCommitOrders);
              resolve(true);
            }
          }
        }, index * 4500);
      });
    }
  });

  return commitOrders.then(() => ({
    status: 201,
    message: 'Processing orders completed',
  }));
}

module.exports = handleRegularOrders;
