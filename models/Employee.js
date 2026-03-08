// models/Employee.js
const mongoose = require("mongoose");

const FixedDepositSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    termMonths: { type: Number, required: true },
    rate: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
    maturityDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "withdrawn", "reset"],
      default: "active",
    },
    expectedInterest: { type: Number, default: 0 },
    totalAtMaturity: { type: Number, default: 0 },

    earlyWithdrawAllowed: { type: Boolean, default: false },
    earlyWithdrawalPenaltyRate: { type: Number, default: 0.1 },
    earlyWithdrawalAmount: { type: Number, default: 0 },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const EmployeeSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  balance: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  isFrozen: { type: Boolean, default: false },

  savingsBalance: { type: Number, default: 0 },
  isSavingsLocked: { type: Boolean, default: false },

  // ✅ FIXED DEPOSITS
  fixedDeposits: { type: [FixedDepositSchema], default: [] },

  resetToken: String,
  resetTokenExpiry: Date,
});

module.exports = mongoose.model("Employee", EmployeeSchema);