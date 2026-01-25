const mongoose = require('mongoose');
const EmployeeSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  balance: { type: Number, default: 0 },
  // ✅ BLOCK FLAG
  isBlocked: { type: Boolean, default: false }
});
module.exports = mongoose.model('Employee', EmployeeSchema);
