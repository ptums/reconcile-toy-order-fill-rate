function Record(order, description, sku, variant, quantity, notes) {
  this.order = order;
  this.description = description;
  this.sku = sku;
  this.quantity = quantity;
  this.notes = notes;
}

module.exports = Record;
