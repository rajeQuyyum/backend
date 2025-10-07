const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema({
  email: { type: String, required: true }, // User's email
  sender: { type: String, enum: ["user", "admin"], required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Message", MessageSchema);
