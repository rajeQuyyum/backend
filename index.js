const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
require('dotenv').config()

const EmployeeeModel = require("./models/Employee");
const AdminModel = require("./models/Admin");
const TransactionModel = require("./models/Transaction");
const CardModel = require("./models/Card");

// --- Chat model ---
const MessageSchema = new mongoose.Schema({
  email: { type: String, required: true },
  sender: { type: String, enum: ["user", "admin"], required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const MessageModel = mongoose.model("Message", MessageSchema);

const app = express();
app.use(express.json());
app.use(cors());

const {DATABASE, PORT}=process.env; 
console.log(DATABASE)

mongoose.connect(DATABASE)
// .then(()=>console.log('Database connected'))
// .error(err => console.log(error.message))

// ================= SOCKET.IO SETUP =================
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("✅ Client connected");

  // join a room by email
  socket.on("join", (email) => {
    socket.join(email);
    console.log(`📩 ${email} joined chat`);
  });

  // handle sending messages
  socket.on("sendMessage", async ({ email, sender, text }) => {
    if (!email || !text) return;
    const message = await MessageModel.create({ email, sender, text });
    io.to(email).emit("newMessage", message); // real-time send to room
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});

// ==================== AUTH & USER MANAGEMENT ====================

// --- Employee login/register ---
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await EmployeeeModel.findOne({ email });
  if (!user) return res.json("User not found");
  if (user.password !== password) return res.json("Incorrect password");
  res.json({ status: "success", user: { id: user._id, name: user.name, email: user.email, balance: user.balance } });
});

app.post("/register", async (req, res) => {
  try {
    const employee = await EmployeeeModel.create(req.body);
    res.json(employee);
  } catch (err) {
    res.json(err);
  }
});

// --- Admin login and users ---
app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminModel.findOne({ username });
  if (!admin) return res.json("Admin not found");
  if (admin.password !== password) return res.json("Incorrect password");
  res.json({ status: "success", admin: { id: admin._id, username: admin.username } });
});

app.get("/admin/users", async (req, res) => {
  try {
    const users = await EmployeeeModel.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/user/:id/balance", async (req, res) => {
  try {
    const { balance } = req.body;
    const user = await EmployeeeModel.findByIdAndUpdate(req.params.id, { balance }, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TRANSACTIONS ====================

app.get("/user/:id/balance", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    res.json({ balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/:id/transactions", async (req, res) => {
  try {
    const txs = await TransactionModel.find({ userId: req.params.id }).sort({ date: -1 });
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add transaction
app.post("/admin/user/:id/transaction", async (req, res) => {
  try {
    const { type, amount, description, recipientName, counterpartyAccount } = req.body;
    if (!type || !amount) return res.status(400).json({ error: "Type and amount are required" });

    const tx = await TransactionModel.create({
      userId: req.params.id,
      type,
      amount,
      description,
      recipientName,
      counterpartyAccount
    });

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance = type === "credit" ? user.balance + amount : user.balance - amount;
    await user.save();

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update transaction
app.put("/admin/transaction/:id", async (req, res) => {
  try {
    const { type, amount, description, recipientName, counterpartyAccount } = req.body;
    const tx = await TransactionModel.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    const oldAmount = tx.amount;
    const oldType = tx.type;

    tx.type = type || tx.type;
    tx.amount = amount !== undefined ? amount : tx.amount;
    tx.description = description || tx.description;
    tx.recipientName = recipientName || tx.recipientName;
    tx.counterpartyAccount = counterpartyAccount || tx.counterpartyAccount;

    await tx.save();

    const user = await EmployeeeModel.findById(tx.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (oldType === "credit") user.balance -= oldAmount;
    if (oldType === "debit") user.balance += oldAmount;
    if (tx.type === "credit") user.balance += tx.amount;
    if (tx.type === "debit") user.balance -= tx.amount;

    await user.save();

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete transaction
app.delete("/admin/transaction/:id", async (req, res) => {
  try {
    const tx = await TransactionModel.findByIdAndDelete(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    const user = await EmployeeeModel.findById(tx.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (tx.type === "credit") user.balance -= tx.amount;
    if (tx.type === "debit") user.balance += tx.amount;

    await user.save();

    res.json({ message: "Transaction deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== USER MANAGEMENT ====================

app.delete("/admin/user/:id", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    await TransactionModel.deleteMany({ userId: req.params.id });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/users", async (req, res) => {
  try {
    await EmployeeeModel.deleteMany({});
    await TransactionModel.deleteMany({});
    res.json({ message: "All users deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/users/delete-multiple", async (req, res) => {
  try {
    const { ids } = req.body;
    await EmployeeeModel.deleteMany({ _id: { $in: ids } });
    await TransactionModel.deleteMany({ userId: { $in: ids } });
    res.json({ message: "Selected users deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CARDS ====================

app.post("/user/:id/cards", async (req, res) => {
  try {
    const { type, holder, number, expiry } = req.body;
    const card = await CardModel.create({ userId: req.params.id, type, holder, number, expiry });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/:id/cards", async (req, res) => {
  try {
    const cards = await CardModel.find({ userId: req.params.id });
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/user/:userId/cards/:cardId", async (req, res) => {
  try {
    await CardModel.findOneAndDelete({ _id: req.params.cardId, userId: req.params.userId });
    res.json({ message: "Card deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/cards", async (req, res) => {
  try {
    const cards = await CardModel.find().populate("userId", "name email");
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/cards/:cardId", async (req, res) => {
  try {
    const card = await CardModel.findByIdAndDelete(req.params.cardId);
    if (!card) return res.status(404).json({ error: "Card not found" });
    res.json({ message: "Card deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CHAT SYSTEM (REST FALLBACK) ====================

app.get("/user/messages/:email", async (req, res) => {
  try {
    const messages = await MessageModel.find({ email: req.params.email }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages/emails", async (req, res) => {
  try {
    const emails = await MessageModel.distinct("email");
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages/:email", async (req, res) => {
  try {
    const messages = await MessageModel.find({ email: req.params.email }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/messages/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const result = await MessageModel.deleteMany({ email });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "No messages found for this email" });
    }
    res.json({ success: true, message: `Deleted all messages for ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/messages", async (req, res) => {
  try {
    await MessageModel.deleteMany({});
    res.json({ success: true, message: "All chats deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== START SERVER ====================
httpServer.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
