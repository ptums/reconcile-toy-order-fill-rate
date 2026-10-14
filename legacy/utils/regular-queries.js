// get calculated order id
const calcuateOrderQuery = (url) => `mutation beginEdit{
    orderEditBegin(id: "${url}"){
       calculatedOrder{
         id
         originalOrder{
          name
        }
         lineItems(first:250){
            edges{
            node{
             id
             title
             variantTitle
             sku
            }
          }
        }
       }
     }
   }`;

const getOrderGIDUrl = (id) => `query {
  orders(first: 1, query:"name:'${id}'"){
    edges{
      node
      {
        id
        name
      }
    }

  }
}`;

const updateTheQuantity = (orderIdUrl, orderLineItemUrl, quantity) => `mutation increaseLineItemQuantity {
  orderEditSetQuantity(id: "${orderIdUrl}", lineItemId: "${orderLineItemUrl}", quantity: ${quantity}) {
    calculatedOrder {
      id
      addedLineItems(first: 250) {
        edges {
          node {
            id
            quantity
          }
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const commitRecentOrderEdits = (calculatedOrderId) => `mutation commitEdit {
  orderEditCommit(id: "${calculatedOrderId}") {
    order {
      id
    }
    userErrors {
      field
      message
    }
  }
}`;

module.exports = {
  calcuateOrderQuery,
  getOrderGIDUrl,
  updateTheQuantity,
  commitRecentOrderEdits,
};
