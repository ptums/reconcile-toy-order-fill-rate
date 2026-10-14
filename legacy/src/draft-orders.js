const createFailure = require('../utils/create-failure');
const createSuccess = require('../utils/create-success');
const { makeTheQuery, makeTheDraftQuery } = require('../utils/query-execution');
const { getAllOrdersAndIds, getProductVariantsFromDraftOrder, updateDraftOrder } = require('../utils/draft-queries');

async function handleDraftOrders(records) {
  const getTheFirst250Ids = await makeTheQuery(getAllOrdersAndIds)
    .then((res) => res.data.draftOrders.edges);
  console.log('getTheFirst250Ids');
	console.log(getTheFirst250Ids);
  // first we gotta get the DraftOrder url for each record
  const getTheDraftOrderUrl = new Promise((resolve) => {
    // were gonna push the orderId, the draftOrder url, product variants and current quantities into this array
    const results = [];

    // get the draft order ids based on the orders from the records
    const getTheDraftOrderIds = records.map((record) => ({
      orderId: record.order,
      item: record.description,
      draftInfo: getTheFirst250Ids.filter((item) => item.node.name === record.order)[0],
    })).filter((thing, index, self) => index === self.findIndex((t) => t.orderId === thing.orderId));
   
	  console.log(getTheDraftOrderIds);
    // get the product variants ids for each product
    getTheDraftOrderIds.forEach((draftOrder, index) => {
      setTimeout(async () => {
        try {
          // execute query to get product variants
          const getTheProductVariants = await makeTheQuery(
            getProductVariantsFromDraftOrder(
              draftOrder.draftInfo.node.id,
            ),
          )
            .then((res) => res.data.draftOrder.lineItems.edges)
            .catch((getProductVariantErr) => {
              const error = new Error(getProductVariantErr);
              
             createFailure(
                draftOrder.orderId,
                draftOrder.item,
                error.toString(),
                'There was an error in requesting product variants from draft order ids. Please update manually',
              );
            });

		console.log('getTheProductVariants');
		console.log(getTheProductVariants);
          results.push({
            order: draftOrder.draftInfo.node.name,
            orderId: draftOrder.draftInfo.node.id,
            products: getTheProductVariants,
          });
        } catch (err) {
          const error = new Error(err);
          console.log('Error getting product variant ids for draft order ids process...');
          console.log('--------------------------------------');
          console.error(error);
          console.log(draftOrder.item);
           createFailure(
            draftOrder.orderId,
            draftOrder.item,
            error.toString(),
            'There was an error commiting the new quantity for this item. Please update manually.',
          );

          ;
        } finally {
          console.log(`Draft: ${draftOrder.orderId} items now have product variant urls`);
          if (index === getTheDraftOrderIds.length - 1) {
            resolve(results);
          }
        }
      }, index * 3000);
    });
  });

  const formatedOrdersWithVariants = await getTheDraftOrderUrl.then((data) => data);

  const addNewQuantityToVariants = new Promise((resolve) => {
    const draftOrderAndProductVariants = [];
    const results = [];

    formatedOrdersWithVariants.forEach((varient) => {
      varient.products.forEach((product) => {
        draftOrderAndProductVariants.push({
          id: varient.orderId,
          product: {
            quantity: product.node.quantity,
            name: product.node.name,
            id: product.node.variant.id,
          },
        });
      });
    });

    records.forEach((record) => {
      draftOrderAndProductVariants.forEach((item) => {
        if (record.description === item.product.name) {
          if (record.quantity !== item.product.quantity) {
            results.push({
              order: record.order,
              id: item.id,
              product: {
                quantity: record.quantity,
                variantId: item.product.id,
              },
            });
          } else {
            results.push({
              order: record.order,
              id: item.id,
              product: {
                quantity: item.product.quantity,
                variantId: item.product.id,
              },
            });
          }
        }
      });
    });

    resolve(results);
  });

  // format all the orders for updating
  const ordersForUpdateOne = await addNewQuantityToVariants.then((data) => data);
  const IdsOnly = ordersForUpdateOne.map((a) => ({
    order: a.order,
    id: a.id,
  })).filter((thing, index, self) => index === self.findIndex((t) => t.order === thing.order));

  // add the associated line items for the formatted orders
  const addAssociatedProducts = IdsOnly.map((order) => {
    const o = { ...order };
    const getProducts = ordersForUpdateOne.map((p) => {
      if (p.id === order.id && p.order === order.order) {
        return p.product;
      }
    }).filter((a) => a !== undefined);

    o.products = getProducts;

    return o;
  });

  // update all the orders based on the addAssociatedProducts array
  const finallyUpdateAllDraftOrders = new Promise((resolve) => {
    addAssociatedProducts.forEach((associatedProduct, index) => {
      setTimeout(async () => {
        try {
          // make the query to update draft orders
          const makeTheUpdate = await makeTheDraftQuery(
            updateDraftOrder,
            {
              id: associatedProduct.id,
              input: {
                lineItems: associatedProduct.products,
              },
            },
          )
            .then((res) => res)
            .catch((makeTheUpdateErr) => {
              const error = new Error(makeTheUpdateErr);
               createFailure(
                associatedProduct.id,
                associatedProduct.order,
                error.toString(),
                'There was an error in requesting product variants from draft order ids. Please update manually',
              );

              
            });

          // save all the successful updates
          if (makeTheUpdate.data.draftOrderUpdate.draftOrder) {
            createSuccess(makeTheUpdate.data.draftOrderUpdate.draftOrder.id);
          }

          // store any error messages from the query response
          if (makeTheUpdate.data.draftOrderUpdate.userErrors.length > 0) {
            createFailure(
              associatedProduct.order,
              associatedProduct.item,
              JSON.stringify(makeTheUpdate.data.draftOrderUpdate.userErrors[0]),
              'There was an error committing the updates to this order. Please update it manually',
            );
          }
        } catch (err) {
          const error = new Error(err);
          console.log('Error updating the draft orders...');
          console.log('--------------------------------------');
          console.error(error);

          createFailure(
            associatedProduct.id,
            associatedProduct.order,
            error.toString(),
            'There was an error updating the new quantity. Please update manually.',
          );
          
        } finally {
          console.log(`Draft: ${associatedProduct.order} items have been updated and committed in Shopify`);
          if (index === addAssociatedProducts.length - 1) {
            resolve(true);
          }
        }
      }, index * 4000);
    });
  });

  return finallyUpdateAllDraftOrders.then(() => ({
    message: 'Processing drafts completed',
  }));
}

module.exports = handleDraftOrders;
