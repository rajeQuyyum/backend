const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'employees', required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  counterpartyAccount: { type: String, required: true },
  recipientName: { type: String, default: 'N/A' },
  description: { type: String, default: 'Transfer' },
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model('transactions', TransactionSchema);

