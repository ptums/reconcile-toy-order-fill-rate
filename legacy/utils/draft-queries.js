const getAllOrdersAndIds = `query {
  draftOrders(first: 250) {
    edges {
      node {
        id
        name
      }
    }
  }
}`;

const getProductVariantsFromDraftOrder = (id) => `query {
  draftOrder(id:"${id}"){
    lineItems(first:100){
      edges{
        node {
					id
          name
          quantity
          variant {
            id
          }
        }
      }
    }
  }
}`;

const updateDraftOrder = `mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
  draftOrderUpdate(id: $id, input: $input) {
    draftOrder {
      id
    }
    userErrors {
      field
      message
    }
  }
}`


module.exports = {
  getAllOrdersAndIds,
  getProductVariantsFromDraftOrder,
  updateDraftOrder
};
