
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SuccessSchema = new Schema({
  orderId: String,
});

const Success = mongoose.model("Success", SuccessSchema);

module.exports = Success;
