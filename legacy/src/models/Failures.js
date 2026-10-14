
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const FailuresSchema = new Schema({
  orderId: String, 
  item: String,
  error: String,
  where: String
});

const Failures = mongoose.model("Failures", FailuresSchema);

module.exports = Failures;
