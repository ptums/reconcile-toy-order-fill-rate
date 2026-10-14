const Success = require("../src/models/Success");

const createSuccess= async (orderId) => {
  const storeSuccess = await Success.create({orderId});

  return storeSuccess;
};

module.exports = createSuccess;