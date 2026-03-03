const mongoose = require('mongoose');
const EmployeeSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  balance: { type: Number, default: 0 },
  // ✅ BLOCK FLAG
  isBlocked: { type: Boolean, default: false },
  isFrozen: { type: Boolean, default: false }, // ✅ ADD THIS
  resetToken: String,
resetTokenExpiry: Date,

});
module.exports = mongoose.model('Employee', EmployeeSchema);
