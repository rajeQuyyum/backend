const mongoose = require("mongoose");

const CardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  type: { type: String, enum: ["Visa", "MasterCard"], required: true },
  holder: { type: String, required: true },
  number: { type: String, required: true },
  expiry: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Card", CardSchema);
