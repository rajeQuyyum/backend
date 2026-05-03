const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const PDFDocument = require("pdfkit");
const { createServer } = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const { cloudinary, upload } = require("./config/cloudinary");
const nodemailer = require("nodemailer");

const EmployeeeModel = require("./models/Employee");
const AdminModel = require("./models/Admin");
const TransactionModel = require("./models/Transaction");
const CardModel = require("./models/Card");
const UserProfileImage = require("./models/UserProfileImage");


const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/// ==================== LOANS MODEL ====================
const LoanSchema = new mongoose.Schema(
  {
    email: { type: String, required: true },

    loanType: { type: String, required: true },

    // ✅ ADD THIS
    currency: {
      type: String,
      enum: ["$", "€", "£", "¥", "₹", "C$"],
      default: "$",
      required: true,
    },

    amount: { type: Number, required: true },
    durationMonths: { type: Number, required: true },

    purpose: { type: String, required: true },
    purposeOther: { type: String, default: "" },

    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, default: "" },
    address: { type: String, default: "" },

    employmentStatus: { type: String, required: true },
    monthlyIncome: { type: Number, required: true },

    idType: { type: String, required: true },
    idNumber: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    adminNote: { type: String, default: "" },
  },
  { timestamps: true }
);

const LoanModel = mongoose.model("Loan", LoanSchema);



// --- Chat model ---
const MessageSchema = new mongoose.Schema({
  email: { type: String, required: true },

  sender: {
    type: String,
    enum: ["user", "admin"],
    required: true,
  },

  text: { type: String, required: true },

  // ✅ MESSAGE STATUS
  status: {
    type: String,
    enum: ["sent", "delivered", "seen"],
    default: "sent",
  },

  createdAt: { type: Date, default: Date.now },
});

const MessageModel = mongoose.model("Message", MessageSchema);



// ==================== NOTIFICATIONS ====================
const NotificationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  message: { type: String, required: true },
  userEmail: { type: String, required: false }, // null means "all users"
  createdAt: { type: Date, default: Date.now },
  date: { type: Date, default: Date.now }, // ✅ ADD THIS (editable date/time)
});
const NotificationModel = mongoose.model("Notification", NotificationSchema);




const app = express();

app.use(express.json()); // handles JSON bodies
app.use(express.urlencoded({ extended: true })); // handles form-data / multipart
app.use(cors());


const freezeGuardByUserId = async (req, res, next) => {
  const user = await EmployeeeModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.isFrozen) {
    return res.status(423).json({
      status: "frozen",
      message: "Account is frozen. Contact customer care.",
    });
  }

  req.userDoc = user;
  next();
};


const { DATABASE, PORT } = process.env;
mongoose.connect(DATABASE);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,   // allow real production origin automatically
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log("✅ Client connected");

  socket.on("join", (email) => {
    socket.join(email);
    console.log(`📩 ${email} joined chat`);
  });

  socket.on("joinAdmin", () => {
  socket.join("admins");
  console.log("👑 Admin joined admins room");
});

  // ✅ REPLACE THIS PART
  socket.on("sendMessage", async ({ email, sender, text }) => {
  if (!email || !text) return;

  const message = await MessageModel.create({
    email,
    sender,
    text,
    status: "sent",
  });

  // ✅ send to the user's room (user gets it)
  io.to(email).emit("newMessage", message);

  // ✅ also send to admins room (admin gets it even if not viewing that chat)
  io.to("admins").emit("newMessage", message);

  await MessageModel.findByIdAndUpdate(message._id, { status: "delivered" });

  // delivery update for user
  io.to(email).emit("messageStatusUpdated", {
    messageId: message._id,
    status: "delivered",
  });

  // optional: delivery update for admin too
  io.to("admins").emit("messageStatusUpdated", {
    messageId: message._id,
    status: "delivered",
  });
});

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});


// ==================== AUTH & USER MANAGEMENT ====================

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await EmployeeeModel.findOne({ email });
    if (!user) return res.json("User not found");

    // 🚫 BLOCK CHECK
    if (user.isBlocked) {
      return res.status(403).json({
        status: "blocked",
        message: "Your account has been blocked. Please contact support.",
      });
    }

    // 🔐 PASSWORD CHECK FIRST
    if (user.password !== password) {
      return res.json("Incorrect password");
    }

    // 🔥 APPROVAL CHECK AFTER PASSWORD
    if (!user.isApproved) {
      return res.status(403).json({
        status: "pending",
        message: "Your account is waiting for admin approval",
      });
    }

    // ✅ SUCCESS
    res.json({
      status: "success",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        isFrozen: user.isFrozen,
        currency: user.currency,
        transferLimit: user.transferLimit,
        hasTransferPin: !!user.transferPin,
      },
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});


app.put("/user/:id/change-password", async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.password !== oldPassword) {
      return res.status(400).json({ error: "Old password is incorrect" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // 🔒 check if user already exists
    const existingUser = await EmployeeeModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        message: "User already exists",
      });
    }

    // ✅ create user as NOT approved
    const employee = await EmployeeeModel.create({
      name,
      email,
      password,
      isApproved: false, // 🔥 IMPORTANT
    });

    res.json({
      status: "success",
      message: "Registration successful. Waiting for admin approval.",
    });
  } catch (err) {
    res.status(500).json(err);
  }
});

app.post("/admin/login", async (req, res) => {
  const { username, password } = req.body;
  const admin = await AdminModel.findOne({ username });
  if (!admin) return res.json("Admin not found");
  if (admin.password !== password) return res.json("Incorrect password");
  res.json({
    status: "success",
    admin: { id: admin._id, username: admin.username },
  });
});



app.put("/admin/user/:id/approve", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isApproved: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // ✅ Respond immediately
    res.json({ success: true });

    // ✅ Email config (clean + no-reply style)
    const mailOptions = {
      from: `"Fabscapital" <${process.env.EMAIL_USER}>`, // masked sender
      to: user.email,

      // 👇 TRUE no-reply behavior
      replyTo: "no-reply@fabscapital.com", // must exist ideally

      subject: "Account Approved 🎉",

      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>Hello ${user.name},</h2>

          <h1 style="color:#2c3e50;">Welcome to Fabscapital 🎉</h1>

          <p>Your account has been successfully approved.</p>

          <p>
            You can now log in and start using your account:
            <br/>
            <a href="https://fabscapital.com" style="color:#3498db;">
              fabscapital.com
            </a>
          </p>

          <hr/>

          <p style="color:gray; font-size:12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `,
    };

    // ✅ Send email safely in background
    transporter.sendMail(mailOptions)
      .then(() => console.log("✅ Email sent to:", user.email))
      .catch((err) => console.error("❌ Email error:", err.message));

  } catch (err) {
    console.error("❌ Server error:", err.message);
    res.status(500).json({ error: "Something went wrong" }); // don't leak raw errors
  }
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
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { balance },
      { new: true }
    );
    res.json(user);

    // ⚡ NEW: Notify user of balance update
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/user/:id/block", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isBlocked: true },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    // 🔔 Real-time notify user
    io.to(user.email).emit("accountBlocked");

    res.json({ success: true, message: "User blocked successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/user/:id/unblock", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isBlocked: false },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    // 🔔 Real-time notify user
    io.to(user.email).emit("accountUnblocked");

    res.json({ success: true, message: "User unblocked successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/user/:id/freeze", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isFrozen: true },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    io.to(user.email).emit("accountFrozen"); // optional real-time
    res.json({ success: true, message: "User account frozen" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/user/:id/unfreeze", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isFrozen: false },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    io.to(user.email).emit("accountUnfrozen"); // optional real-time
    res.json({ success: true, message: "User account unfrozen" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// app.get("/admin/users", async (req, res) => {
//   try {
//     const users = await EmployeeeModel.find();
//     res.json(users);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });


app.put("/admin/user/:id/savings/lock", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isSavingsLocked: true },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    io.to(user.email).emit("savingsLocked");
    res.json({ success: true, message: "Savings locked", isSavingsLocked: user.isSavingsLocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/admin/user/:id/savings/unlock", async (req, res) => {
  try {
    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { isSavingsLocked: false },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    io.to(user.email).emit("savingsUnlocked");
    res.json({ success: true, message: "Savings unlocked", isSavingsLocked: user.isSavingsLocked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/admin/user/:id/savings/unload-all", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const s = Number(user.savingsBalance || 0);
    if (s <= 0) return res.status(400).json({ error: "No savings to unload" });

    user.savingsBalance = 0;
    user.balance = Number(user.balance || 0) + s;

    await user.save();

    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("savingsUpdated", { savingsBalance: user.savingsBalance });

    res.json({ success: true, balance: user.balance, savingsBalance: user.savingsBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/admin/user/:id/currency", async (req, res) => {
  try {
    const { currency } = req.body;

    const allowedCurrencies = ["$", "€", "£", "¥", "₹", "C$"];
    if (!allowedCurrencies.includes(currency)) {
      return res.status(400).json({ error: "Invalid currency" });
    }

    const user = await EmployeeeModel.findByIdAndUpdate(
      req.params.id,
      { currency },
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    io.to(user.email).emit("currencyUpdated", { currency: user.currency });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==================== TRANSACTIONS ====================

app.get("/user/:id/balance", freezeGuardByUserId, async (req, res) => {
  res.json({ balance: req.userDoc.balance });
});

app.get("/user/:id/transactions", freezeGuardByUserId, async (req, res) => {
  try {
    const txs = await TransactionModel.find({ userId: req.params.id }).sort({
      date: -1,
    });
    res.json(txs);
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

    // ⚡ NEW: Notify user
    io.to(user.email).emit("transactionDeleted", tx._id);
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Add transaction
app.post("/admin/user/:id/transaction", freezeGuardByUserId, async (req, res) => {
  try {
    const {
      type,
      amount,
      description,
      recipientName,
      counterpartyAccount,
    } = req.body;
    if (!type || !amount)
      return res.status(400).json({ error: "Type and amount are required" });

    const tx = await TransactionModel.create({
      userId: req.params.id,
      type,
      amount,
      description,
      recipientName,
      counterpartyAccount,
    });

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance =
      type === "credit" ? user.balance + amount : user.balance - amount;
    await user.save();

    res.json(tx);

    // ⚡ NEW: Emit real-time updates
    io.to(user.email).emit("transactionAdded", tx);
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update transaction
app.put("/admin/transaction/:id", async (req, res) => {
  try {
    const {
      type,
      amount,
      description,
      recipientName,
      counterpartyAccount,
      date, // ✅ ADD THIS
    } = req.body;

    const tx = await TransactionModel.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: "Transaction not found" });

    const oldAmount = tx.amount;
    const oldType = tx.type;

    tx.type = type || tx.type;
    tx.amount = amount !== undefined ? amount : tx.amount;
    tx.description = description || tx.description;
    tx.recipientName = recipientName || tx.recipientName;
    tx.counterpartyAccount = counterpartyAccount || tx.counterpartyAccount;

    if (date) tx.date = new Date(date); // ✅ ADD THIS

    await tx.save();

    const user = await EmployeeeModel.findById(tx.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (oldType === "credit") user.balance -= oldAmount;
    if (oldType === "debit") user.balance += oldAmount;
    if (tx.type === "credit") user.balance += tx.amount;
    if (tx.type === "debit") user.balance -= tx.amount;

    await user.save();

    res.json(tx);

    // ⚡ Notify user
    io.to(user.email).emit("transactionUpdated", tx);
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
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

    // ⚡ NEW: Notify user
    io.to(user.email).emit("transactionDeleted", tx._id);
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.post("/user/:id/create-transfer-pin", async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.transferPin) {
      return res.status(400).json({ error: "Transfer PIN already exists" });
    }

    user.transferPin = pin;
    await user.save();

    res.json({
      success: true,
      message: "Transfer PIN created successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/user/:id/change-transfer-pin", async (req, res) => {
  try {
    const { oldPin, newPin } = req.body;

    if (!newPin || !/^\d{4}$/.test(newPin)) {
      return res.status(400).json({ error: "New PIN must be exactly 4 digits" });
    }

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.transferPin) {
      return res.status(400).json({ error: "No transfer PIN found. Create one first." });
    }

    if (user.transferPin !== oldPin) {
      return res.status(400).json({ error: "Old PIN is incorrect" });
    }

    user.transferPin = newPin;
    await user.save();

    res.json({
      success: true,
      message: "Transfer PIN changed successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/user/:id/transfer-settings", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id).select(
      "transferLimit transferPin transferLimitRequest currency"
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      transferLimit: user.transferLimit || 0,
      hasTransferPin: !!user.transferPin,
      transferLimitRequest: user.transferLimitRequest || {
        requestedLimit: 0,
        status: "none",
        requestedAt: null,
      },
      currency: user.currency || "$",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/user/:id/request-transfer-limit", async (req, res) => {
  try {
    const { requestedLimit } = req.body;
    const newLimit = Number(requestedLimit);

    if (!newLimit || newLimit <= 0) {
      return res.status(400).json({ error: "Enter a valid transfer limit" });
    }

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (newLimit <= Number(user.transferLimit || 0)) {
      return res.status(400).json({
        error: "Requested limit must be greater than current limit",
      });
    }

    user.transferLimitRequest = {
      requestedLimit: newLimit,
      status: "pending",
      requestedAt: new Date(),
    };

    await user.save();

    io.to("admins").emit("transferLimitRequestCreated", {
      userId: user._id,
      name: user.name,
      email: user.email,
      requestedLimit: newLimit,
      currency: user.currency || "$",
    });

    res.json({
      success: true,
      message: "Transfer limit request submitted successfully",
      transferLimitRequest: user.transferLimitRequest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/admin/user/:id/transfer-limit", async (req, res) => {
  try {
    const { action } = req.body; // "approve" or "reject"

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (!user.transferLimitRequest || user.transferLimitRequest.status !== "pending") {
      return res.status(400).json({ error: "No pending transfer limit request" });
    }

    if (action === "approve") {
      user.transferLimit = Number(user.transferLimitRequest.requestedLimit || user.transferLimit);
      user.transferLimitRequest.status = "approved";
    } else if (action === "reject") {
      user.transferLimitRequest.status = "rejected";
    } else {
      return res.status(400).json({ error: "Action must be approve or reject" });
    }

    await user.save();

    io.to(user.email).emit("transferLimitUpdated", {
      transferLimit: user.transferLimit,
      transferLimitRequest: user.transferLimitRequest,
    });

    res.json({
      success: true,
      transferLimit: user.transferLimit,
      transferLimitRequest: user.transferLimitRequest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/user/:userId/cards/:cardId/block", async (req, res) => {
  try {
    const card = await CardModel.findOne({
      _id: req.params.cardId,
      userId: req.params.userId,
    });

    if (!card) return res.status(404).json({ error: "Card not found" });

    card.status = "blocked";
    await card.save();

    res.json({
      success: true,
      message: "Card blocked successfully",
      card,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/user/:userId/cards/:cardId/activate", async (req, res) => {
  try {
    const card = await CardModel.findOne({
      _id: req.params.cardId,
      userId: req.params.userId,
    });

    if (!card) return res.status(404).json({ error: "Card not found" });

    card.status = "active";
    await card.save();

    res.json({
      success: true,
      message: "Card activated successfully",
      card,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/user/:id/transfer", freezeGuardByUserId, async (req, res) => {
  try {
    const { pin, amount, description, recipientName, counterpartyAccount } = req.body;

    const user = req.userDoc;
    const amt = Number(amount);

    if (!recipientName || !counterpartyAccount || !amt) {
      return res.status(400).json({ error: "Recipient name, account and amount are required" });
    }

    if (amt <= 0) {
      return res.status(400).json({ error: "Enter a valid amount" });
    }

    if (!user.transferPin) {
      return res.status(400).json({ error: "No transfer PIN found. Create one in settings." });
    }

    if (!pin) {
      return res.status(400).json({ error: "Transfer PIN is required" });
    }

    if (user.transferPin !== pin) {
      return res.status(400).json({ error: "Invalid transfer PIN" });
    }

    if (amt > Number(user.balance || 0)) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    if (amt > Number(user.transferLimit || 0)) {
      return res.status(400).json({
        error: `Transfer exceeds your limit of ${user.currency || "$"}${Number(user.transferLimit || 0).toFixed(2)}`,
      });
    }

    const tx = await TransactionModel.create({
      userId: user._id,
      type: "debit",
      amount: amt,
      description,
      recipientName,
      counterpartyAccount,
    });

    user.balance = Number(user.balance || 0) - amt;
    await user.save();

    io.to(user.email).emit("transactionAdded", tx);
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/admin/user/:id/clear-transfer-pin", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.transferPin = "";
    await user.save();

    const notification = await NotificationModel.create({
      title: "Transfer PIN Reset",
      message: "Your transfer PIN has been cleared by admin. Please create a new transfer PIN in settings.",
      userEmail: user.email,
    });

    io.to(user.email).emit("transferPinCleared");
    io.to(user.email).emit("newNotification", notification);

    res.json({
      success: true,
      message: "Transfer PIN cleared successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.put("/admin/user/:id/reset-transfer-limit", async (req, res) => {
  try {
    const DEFAULT_TRANSFER_LIMIT = 5000;

    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.transferLimit = DEFAULT_TRANSFER_LIMIT;
    user.transferLimitRequest = {
      requestedLimit: 0,
      status: "none",
      requestedAt: null,
    };

    await user.save();

    const notification = await NotificationModel.create({
      title: "Transfer Limit Reset",
      message: `Your transfer limit has been reset by admin to ${user.currency || "$"}${Number(DEFAULT_TRANSFER_LIMIT).toFixed(2)}.`,
      userEmail: user.email,
    });

    io.to(user.email).emit("transferLimitUpdated", {
      transferLimit: user.transferLimit,
      transferLimitRequest: user.transferLimitRequest,
    });

    io.to(user.email).emit("newNotification", notification);

    res.json({
      success: true,
      message: "Transfer limit reset successfully",
      transferLimit: user.transferLimit,
      transferLimitRequest: user.transferLimitRequest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/user/:id/transfer-settings", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id).select(
      "transferLimit transferPin transferLimitRequest currency isFrozen isBlocked isSavingsLocked"
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      transferLimit: user.transferLimit || 0,
      hasTransferPin: !!user.transferPin,
      transferLimitRequest: user.transferLimitRequest || {
        requestedLimit: 0,
        status: "none",
        requestedAt: null,
      },
      currency: user.currency || "$",
      isFrozen: !!user.isFrozen,
      isBlocked: !!user.isBlocked,
      isSavingsLocked: !!user.isSavingsLocked,
    });
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

    // ⚡ Notify deletion if needed
    io.to(user.email).emit("accountDeleted");
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
    const card = await CardModel.create({
      userId: req.params.id,
      type,
      holder,
      number,
      expiry,
    });
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
    await CardModel.findOneAndDelete({
      _id: req.params.cardId,
      userId: req.params.userId,
    });
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

// ==================== CHAT SYSTEM ====================

app.get("/user/messages/:email", async (req, res) => {
  try {
    const messages = await MessageModel.find({ email: req.params.email }).sort({
      createdAt: 1,
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/profile/:email", async (req, res) => {
  try {
    const user = await EmployeeeModel.findOne(
      { email: req.params.email },
      { name: 1, email: 1, _id: 0 }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages/emails", async (req, res) => {
  try {
    const users = await EmployeeeModel.find({}, { email: 1, _id: 0 }).sort({ email: 1 });
    res.json(users.map((u) => u.email));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages/users", async (req, res) => {
  try {
    const users = await EmployeeeModel.find({}, { email: 1, name: 1, _id: 0 }).lean();
    const chattedEmails = await MessageModel.distinct("email");

    const result = users.map((u) => ({
      email: u.email,
      name: u.name,
      hasMessages: chattedEmails.includes(u.email),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/messages/:email", async (req, res) => {
  try {
    const messages = await MessageModel.find({ email: req.params.email }).sort({
      createdAt: 1,
    });
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

app.put("/user/messages/seen/:email", async (req, res) => {
  try {
    await MessageModel.updateMany(
      {
        email: req.params.email,
        sender: "admin",
        status: { $ne: "seen" },
      },
      { status: "seen" }
    );

    io.to(req.params.email).emit("adminMessagesSeen");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});






// 🔹 Create a new notification
app.post("/admin/notifications", async (req, res) => {
  try {
    const { title, message, userEmail } = req.body;
    const notification = await NotificationModel.create({ title, message, userEmail });

    // If targeted, notify specific user; else broadcast to all
    if (userEmail) {
      io.to(userEmail).emit("newNotification", notification);
    } else {
      io.emit("newNotification", notification);
    }

    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Get all notifications (admin)
app.get("/admin/notifications", async (req, res) => {
  try {
    const notifications = await NotificationModel.find().sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Get notifications for a specific user
app.get("/user/:email/notifications", async (req, res) => {
  try {
    const { email } = req.params;
    const notifications = await NotificationModel.find({
      $or: [{ userEmail: email }, { userEmail: { $exists: false } }, { userEmail: null }],
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 Update a notification
app.put("/admin/notifications/:id", async (req, res) => {
  try {
    const { title, message, date } = req.body;

    const updateData = { title, message };
    if (date) updateData.date = new Date(date); // ✅ REQUIRED

    const notification = await NotificationModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 🔹 Delete a notification
app.delete("/admin/notifications/:id", async (req, res) => {
  try {
    const notification = await NotificationModel.findByIdAndDelete(req.params.id);
    if (!notification) return res.status(404).json({ error: "Notification not found" });

    io.emit("notificationDeleted", req.params.id);
    res.json({ success: true, message: "Notification deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ==================== ADDITIONAL INFO MODEL ====================
const AdditionalInfoSchema = new mongoose.Schema({
  accountNumber: { type: String, required: true }, // user's MongoDB _id
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  address: { type: String },
  gender: { type: String },
   nextOfKinGender: { type: String },
  nextOfKin: { type: String },
  nextOfKinNumber: { type: String },
  nextOfKinAddress: { type: String },

  // 🆕 ID CARD
  // 🆕 ID CARD (FRONT & BACK)
  idCardFrontUrl: { type: String },
  idCardFrontPublicId: { type: String },

  idCardBackUrl: { type: String },
  idCardBackPublicId: { type: String },

  // ================= BANK DETAILS (ADMIN ONLY) =================
  bankAccountNumber: { type: String, default: null },
bankTransitNumber: { type: String, default: null },
bankInstitutionNumber: { type: String, default: null },
});

const AdditionalInfoModel = mongoose.model("AdditionalInfo", AdditionalInfoSchema);

// ==================== ADDITIONAL INFO ROUTES ====================

// Fetch additional info for a user
app.get("/user/:id/additional-info", async (req, res) => {
  try {
    const info = await AdditionalInfoModel.findOne({
      accountNumber: req.params.id,
    });

    res.json(info || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Save or update additional info
app.post("/user/:id/additional-info", async (req, res) => {
  try {
    const { phone, address, gender, nextOfKinGender, nextOfKin, nextOfKinNumber, nextOfKinAddress } = req.body;

    // Find user from EmployeeeModel
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Check if additional info already exists
    let info = await AdditionalInfoModel.findOne({ accountNumber: user._id });
    if (info) {
      // Update existing info
      info.phone = phone;
      info.address = address;
      info.gender = gender;
      info.nextOfKinGender = nextOfKinGender;
      info.nextOfKin = nextOfKin;
      info.nextOfKinNumber = nextOfKinNumber;
      info.nextOfKinAddress = nextOfKinAddress;
      await info.save();
    } else {
      // Create new info
      info = await AdditionalInfoModel.create({
        accountNumber: user._id,
        name: user.name,
        email: user.email,
        phone,
        address,
        gender,
        nextOfKinGender,
        nextOfKin,
        nextOfKinNumber,
        nextOfKinAddress,
      });
    }

    res.json(info);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/admin/user/:id/bank-details", async (req, res) => {
  try {
    const {
      bankAccountNumber,
      bankTransitNumber,
      bankInstitutionNumber,
    } = req.body;

    // 🔹 Find user first
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🔹 Find or create AdditionalInfo
    let info = await AdditionalInfoModel.findOne({
      accountNumber: user._id,
    });

    if (!info) {
      info = await AdditionalInfoModel.create({
        accountNumber: user._id,
        name: user.name,
        email: user.email,
      });
    }

    // 🔹 Save bank details
    info.bankAccountNumber = bankAccountNumber || null;
    info.bankTransitNumber = bankTransitNumber || null;
    info.bankInstitutionNumber = bankInstitutionNumber || null;

    await info.save();

    res.json({ success: true, info });
  } catch (err) {
    console.error("BANK DETAILS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});




app.delete("/admin/user/:id/bank-details", async (req, res) => {
  try {
    const info = await AdditionalInfoModel.findOne({
      accountNumber: new mongoose.Types.ObjectId(req.params.id),
    });

    if (!info) {
      return res.status(404).json({ error: "Additional info not found" });
    }

    info.bankAccountNumber = null;
    info.bankTransitNumber = null;
    info.bankInstitutionNumber = null;

    await info.save();

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE BANK DETAILS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/admin/users/bank-details", async (req, res) => {
  try {
    const users = await EmployeeeModel.find();

    const result = await Promise.all(
      users.map(async (user) => {
        const info = await AdditionalInfoModel.findOne({
          accountNumber: user._id,
        });

        return {
          id: user._id,
          name: user.name,
          email: user.email,

          bankAccountNumber: info?.bankAccountNumber || "",
          bankTransitNumber: info?.bankTransitNumber || "",
          bankInstitutionNumber: info?.bankInstitutionNumber || "",
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error("BANK GET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});




app.post(
  "/user/:id/id-card",
  upload.fields([
    { name: "idCardFront", maxCount: 1 },
    { name: "idCardBack", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const user = await EmployeeeModel.findById(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      let info = await AdditionalInfoModel.findOne({ accountNumber: user._id });
      if (!info) return res.status(404).json({ error: "Info not found" });

      // FRONT
      if (req.files?.idCardFront?.[0]) {
        info.idCardFrontUrl = req.files.idCardFront[0].path;
        info.idCardFrontPublicId = req.files.idCardFront[0].filename;
      }

      // BACK
      if (req.files?.idCardBack?.[0]) {
        info.idCardBackUrl = req.files.idCardBack[0].path;
        info.idCardBackPublicId = req.files.idCardBack[0].filename;
      }

      await info.save();

      res.json({
        idCardFrontUrl: info.idCardFrontUrl,
        idCardBackUrl: info.idCardBackUrl,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);



app.get("/admin/users/id-cards", async (req, res) => {
  try {
    const users = await EmployeeeModel.find();

    const result = await Promise.all(
      users.map(async (user) => {
        const info = await AdditionalInfoModel.findOne({
          accountNumber: user._id,
        });

        return {
          id: user._id,
          name: user.name,
          email: user.email,

          // ✅ FRONT & BACK ID CARDS
          idCardFrontUrl: info?.idCardFrontUrl || null,
          idCardBackUrl: info?.idCardBackUrl || null,

          // ✅ OTHER INFO
          phone: info?.phone || "",
          address: info?.address || "",
          gender: info?.gender || "",
          nextOfKin: info?.nextOfKin || "",
          nextOfKinNumber: info?.nextOfKinNumber || "",
          nextOfKinAddress: info?.nextOfKinAddress || "",
          nextOfKinGender: info?.nextOfKinGender || "",
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.delete("/admin/user/:id/id-card", async (req, res) => {
  try {
    const info = await AdditionalInfoModel.findOne({
      accountNumber: req.params.id,
    });

    if (!info) {
      return res.status(404).json({ error: "No ID card found" });
    }

    // ✅ DELETE FRONT
    if (info.idCardFrontPublicId) {
      await cloudinary.uploader.destroy(info.idCardFrontPublicId);
    }

    // ✅ DELETE BACK
    if (info.idCardBackPublicId) {
      await cloudinary.uploader.destroy(info.idCardBackPublicId);
    }

    info.idCardFrontUrl = null;
    info.idCardFrontPublicId = null;
    info.idCardBackUrl = null;
    info.idCardBackPublicId = null;

    await info.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.post(
  "/admin/user/:id/profile-image",
  upload.single("image"),
  async (req, res) => {
    try {
      const user = await EmployeeeModel.findById(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      let img = await UserProfileImage.findOne({ userId: user._id });

      if (img) {
        await cloudinary.uploader.destroy(img.publicId);
        img.imageUrl = req.file.path;
        img.publicId = req.file.filename;
        await img.save();
      } else {
        img = await UserProfileImage.create({
          userId: user._id,
          imageUrl: req.file.path,
          publicId: req.file.filename,
        });
      }

      io.to(user.email).emit("profileImageUpdated", img.imageUrl);
      res.json(img);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);


app.get("/user/:id/profile-image", async (req, res) => {
  try {
    const img = await UserProfileImage.findOne({ userId: req.params.id });
    res.json(img || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


const crypto = require("crypto");

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  const user = await EmployeeeModel.findOne({ email });
  if (!user) {
    // do NOT expose if user exists
    return res.json("If email exists, reset link sent");
  }

  const token = crypto.randomBytes(32).toString("hex");

  user.resetToken = token;
  user.resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 minutes
  await user.save();

  res.json({
    resetLink: `${process.env.CLIENT_URL}/reset-password/${token}`,


  });
});

app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  const user = await EmployeeeModel.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() },
  });

  if (!user) {
    return res.status(400).json("Invalid or expired token");
  }

  // 🔑 CHANGE PASSWORD (PLAIN TEXT, SAME AS YOUR SYSTEM)
  user.password = password;
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;

  await user.save();

  res.json("Password reset successful");
});



// ==================== LOANS ROUTES ====================

// 1) User applies
app.post("/loans/apply", async (req, res) => {
  try {
    const data = req.body;

    if (!data.email) return res.status(400).json({ error: "Email required" });
    if (!data.fullName) return res.status(400).json({ error: "Full name required" });
    if (!data.phone) return res.status(400).json({ error: "Phone required" });
    if (!data.country) return res.status(400).json({ error: "Country required" });

    if (!data.loanType) return res.status(400).json({ error: "Loan type required" });

    const allowedCurrencies = ["$", "€", "£", "¥", "₹", "C$"];
    if (!data.currency || !allowedCurrencies.includes(data.currency)) {
      return res.status(400).json({ error: "Valid currency required" });
    }

    if (!data.amount || Number(data.amount) <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    if (!data.durationMonths || Number(data.durationMonths) <= 0) {
      return res.status(400).json({ error: "Valid duration required" });
    }

    if (!data.purpose) return res.status(400).json({ error: "Purpose required" });

    if (!data.employmentStatus) {
      return res.status(400).json({ error: "Employment status required" });
    }

    if (!data.monthlyIncome || Number(data.monthlyIncome) <= 0) {
      return res.status(400).json({ error: "Monthly income required" });
    }

    if (!data.idType) return res.status(400).json({ error: "ID type required" });

    const loan = await LoanModel.create({
      ...data,
      currency: data.currency,
      amount: Number(data.amount),
      durationMonths: Number(data.durationMonths),
      monthlyIncome: Number(data.monthlyIncome),
      status: "pending",
    });

    io.to("admins").emit("newLoanApplication", loan);

    const n = await NotificationModel.create({
      title: "Loan Application Submitted",
      message: `Your loan request is now pending review.`,
      userEmail: data.email,
    });

    io.to(data.email).emit("newNotification", n);

    res.status(201).json({ success: true, loan });
  } catch (err) {
    console.error("LOAN APPLY ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 2) Admin fetch all loans
app.get("/admin/loans", async (req, res) => {
  try {
    const loans = await LoanModel.find().sort({ createdAt: -1 });
    res.json(loans);
  } catch (err) {
    console.error("ADMIN LOANS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3) User fetch their loans
app.get("/user/:email/loans", async (req, res) => {
  try {
    const loans = await LoanModel.find({ email: req.params.email }).sort({ createdAt: -1 });
    res.json(loans);
  } catch (err) {
    console.error("USER LOANS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/loans/:id/status", async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be approved or rejected" });
    }

    const loan = await LoanModel.findById(req.params.id);
    if (!loan) return res.status(404).json({ error: "Loan not found" });

    // prevent double-crediting if already approved before
    if (loan.status === "approved" && status === "approved") {
      return res.status(400).json({ error: "Loan already approved" });
    }

    loan.status = status;
    loan.adminNote = adminNote || "";
    await loan.save();

    // ✅ if approved, deposit loan amount into user's balance
    if (status === "approved") {
      const user = await EmployeeeModel.findOne({ email: loan.email });

      if (!user) {
        return res.status(404).json({ error: "User not found for this loan" });
      }

      user.balance = Number(user.balance || 0) + Number(loan.amount || 0);
      await user.save();

      // realtime balance update
      io.to(user.email).emit("balanceUpdated", { balance: user.balance });

      // optional transaction record
      const tx = await TransactionModel.create({
        userId: user._id,
        type: "credit",
        amount: Number(loan.amount || 0),
        description: `${loan.loanType} loan approved`,
        recipientName: user.name,
        counterpartyAccount: "LOAN_APPROVAL",
      });

      io.to(user.email).emit("transactionAdded", tx);
    }

    // realtime notify user
    io.to(loan.email).emit("loanStatusUpdated", {
      loanId: loan._id,
      status: loan.status,
      adminNote: loan.adminNote,
    });

    // notification to user
    const n = await NotificationModel.create({
      title: status === "approved" ? "Loan Approved" : "Loan Declined",
      message:
        status === "approved"
          ? `Your loan of ${(loan.currency || "$")}${Number(loan.amount).toLocaleString()} has been approved and credited to your account.`
          : "Your loan has been declined.",
      userEmail: loan.email,
    });

    io.to(loan.email).emit("newNotification", n);

    // optional: notify admins list updated
    io.to("admins").emit("loanUpdated", loan);

    res.json({ success: true, loan });
  } catch (err) {
    console.error("UPDATE LOAN STATUS ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/// 5) Admin delete loan
app.delete("/admin/loans/:id", async (req, res) => {
  try {
    const loan = await LoanModel.findByIdAndDelete(req.params.id);

    if (!loan) {
      return res.status(404).json({ error: "Loan not found" });
    }

    // optional realtime update for admin dashboards
    io.to("admins").emit("loanDeleted", loan._id);

    res.json({ success: true, message: "Loan deleted successfully" });

  } catch (err) {
    console.error("DELETE LOAN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Move from MAIN -> SAVINGS
app.post("/user/:id/savings/deposit", freezeGuardByUserId, async (req, res) => {
  try {
    const { amount } = req.body;
    const a = Number(amount);

    if (!a || a <= 0) return res.status(400).json({ error: "Valid amount required" });

    const user = req.userDoc;

    if (user.isSavingsLocked) {
  return res.status(423).json({ status: "locked", message: "Savings is locked. Contact support." });
}

    if (user.balance < a) {
      return res.status(400).json({ error: "Insufficient main balance" });
    }

    user.balance -= a;
    user.savingsBalance = (user.savingsBalance || 0) + a;

    await user.save();

    // realtime update (optional)
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("savingsUpdated", { savingsBalance: user.savingsBalance });

    res.json({ success: true, balance: user.balance, savingsBalance: user.savingsBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move from SAVINGS -> MAIN
app.post("/user/:id/savings/withdraw", freezeGuardByUserId, async (req, res) => {
  try {
    const { amount } = req.body;
    const a = Number(amount);

    if (!a || a <= 0) return res.status(400).json({ error: "Valid amount required" });

    const user = req.userDoc;

    if (user.isSavingsLocked) {
  return res.status(423).json({ status: "locked", message: "Savings is locked. Contact support." });
}

    const s = Number(user.savingsBalance || 0);
    if (s < a) {
      return res.status(400).json({ error: "Insufficient savings balance" });
    }

    user.savingsBalance = s - a;
    user.balance += a;

    await user.save();

    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("savingsUpdated", { savingsBalance: user.savingsBalance });

    res.json({ success: true, balance: user.balance, savingsBalance: user.savingsBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get savings balance
app.get("/user/:id/savings", freezeGuardByUserId, async (req, res) => {
  res.json({
    savingsBalance: Number(req.userDoc.savingsBalance || 0),
    isSavingsLocked: !!req.userDoc.isSavingsLocked,
  });
});

const FIXED_RATES = {
  3: 0.03,   // 3 months = 3%
  6: 0.055,  // 6 months = 5.5%
  12: 0.08,  // 12 months = 8%
};


app.post("/user/:id/fixed/create", freezeGuardByUserId, async (req, res) => {
  try {
    const { amount, termMonths } = req.body;

    const a = Number(amount);
    const t = Number(termMonths);

    if (!a || a <= 0) return res.status(400).json({ error: "Valid amount required" });
    if (!FIXED_RATES[t]) return res.status(400).json({ error: "Invalid term selected" });

    const user = req.userDoc;

    if (user.balance < a) {
      return res.status(400).json({ error: "Insufficient main balance" });
    }

    const rate = FIXED_RATES[t];
    const startDate = new Date();
    const maturityDate = new Date(startDate);
    maturityDate.setMonth(maturityDate.getMonth() + t);

    const expectedInterest = a * rate;
    const totalAtMaturity = a + expectedInterest;

    user.balance -= a;

    user.fixedDeposits.push({
      amount: a,
      termMonths: t,
      rate,
      startDate,
      maturityDate,
      expectedInterest,
      totalAtMaturity,
      status: "active",
    });

    await user.save();

    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("fixedUpdated", { fixedDeposits: user.fixedDeposits });

    res.json({
      success: true,
      balance: user.balance,
      fixedDeposits: user.fixedDeposits,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get("/user/:id/fixed", freezeGuardByUserId, async (req, res) => {
  res.json({
    fixedDeposits: req.userDoc.fixedDeposits || [],
  });
});


app.post("/user/:id/fixed/withdraw/:fixedId", freezeGuardByUserId, async (req, res) => {
  try {
    const user = req.userDoc;

    const fd = user.fixedDeposits.id(req.params.fixedId);
    if (!fd) return res.status(404).json({ error: "Fixed deposit not found" });

    if (fd.status !== "active") {
      return res.status(400).json({ error: "This fixed deposit is not active" });
    }

    const now = new Date();
    const matured = now >= new Date(fd.maturityDate);

    let payout = 0;

    if (matured) {
      payout = Number(fd.totalAtMaturity || 0);
    } else {
      if (!fd.earlyWithdrawAllowed) {
        return res.status(423).json({
          status: "locked",
          message: "Fixed deposit not matured yet.",
        });
      }

      payout = Number(fd.earlyWithdrawalAmount || 0);

      if (payout <= 0) {
        return res.status(400).json({ error: "Early withdrawal amount is invalid" });
      }
    }

    user.balance = Number(user.balance || 0) + payout;
    fd.status = "withdrawn";
    fd.withdrawnAt = new Date();

    await user.save();

    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("fixedUpdated", { fixedDeposits: user.fixedDeposits });

    res.json({
      success: true,
      balance: user.balance,
      fixedDeposits: user.fixedDeposits,
      withdrawnAmount: payout,
      withdrawalType: matured ? "matured" : "early",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/user/:id/fixed/reset", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const fixed = user.fixedDeposits || [];

    // calculate refund (principal only)
    const refund = fixed.reduce((sum, fd) => sum + Number(fd.amount || 0), 0);

    // return money to main balance
    user.balance = Number(user.balance || 0) + refund;

    // ❌ DELETE ALL FIXED DEPOSITS
    user.fixedDeposits = [];

    await user.save();

    // realtime updates
    io.to(user.email).emit("balanceUpdated", { balance: user.balance });
    io.to(user.email).emit("fixedUpdated", { fixedDeposits: [] });

    res.json({
      success: true,
      message: "All fixed deposits removed by admin",
      balance: user.balance,
      fixedDeposits: [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/admin/user/:id/fixed/:fixedId/allow-early-withdraw", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const fd = user.fixedDeposits.id(req.params.fixedId);
    if (!fd) return res.status(404).json({ error: "Fixed deposit not found" });

    if (fd.status !== "active") {
      return res.status(400).json({ error: "Fixed deposit is not active" });
    }

    const penaltyRate =
      req.body.penaltyRate !== undefined
        ? Number(req.body.penaltyRate)
        : 0.1;

    if (penaltyRate < 0 || penaltyRate > 1) {
      return res.status(400).json({ error: "Penalty rate must be between 0 and 1" });
    }

    const penaltyAmount = Number(fd.amount || 0) * penaltyRate;
    const earlyWithdrawalAmount = Number(fd.amount || 0) - penaltyAmount;

    fd.earlyWithdrawAllowed = true;
    fd.earlyWithdrawalPenaltyRate = penaltyRate;
    fd.earlyWithdrawalAmount = earlyWithdrawalAmount;

    await user.save();

    io.to(user.email).emit("fixedUpdated", { fixedDeposits: user.fixedDeposits });

    res.json({
      success: true,
      message: "Early withdrawal enabled successfully",
      fixedDeposit: fd,
    });
  } catch (err) {
    console.error("ALLOW EARLY WITHDRAW ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/admin/users/fixed-deposits", async (req, res) => {
  try {
    const users = await EmployeeeModel.find().lean();

    const result = users.map((user) => {
      const fixedDeposits = (user.fixedDeposits || []).map((fd) => ({
        _id: fd._id,
        amount: Number(fd.amount || 0),
        termMonths: Number(fd.termMonths || 0),
        rate: Number(fd.rate || 0),
        startDate: fd.startDate,
        maturityDate: fd.maturityDate,
        expectedInterest: Number(fd.expectedInterest || 0),
        totalAtMaturity: Number(fd.totalAtMaturity || 0),
        status: fd.status,
      }));

      const totalLocked = fixedDeposits
        .filter((fd) => fd.status === "active")
        .reduce((sum, fd) => sum + fd.amount, 0);

      const totalInterest = fixedDeposits
        .filter((fd) => fd.status === "active")
        .reduce((sum, fd) => sum + fd.expectedInterest, 0);

      return {
        id: user._id,
        name: user.name,
        email: user.email,
        currency: user.currency || "$",
        totalLocked,
        totalInterest,
        fixedDeposits,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("ADMIN FIXED DEPOSITS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


app.delete("/admin/user/:id/fixed/:fixedId", async (req, res) => {
  try {
    const user = await EmployeeeModel.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const fd = user.fixedDeposits.id(req.params.fixedId);
    if (!fd) return res.status(404).json({ error: "Fixed deposit not found" });

    if (fd.status !== "withdrawn") {
      return res.status(400).json({
        error: "Only withdrawn fixed deposits can be deleted",
      });
    }

    fd.deleteOne();
    await user.save();

    io.to(user.email).emit("fixedUpdated", { fixedDeposits: user.fixedDeposits });

    res.json({
      success: true,
      message: "Withdrawn fixed deposit deleted successfully",
      fixedDeposits: user.fixedDeposits,
    });
  } catch (err) {
    console.error("DELETE WITHDRAWN FIXED ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});



app.get("/user/:id/statement", freezeGuardByUserId, async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        error: "from and to dates are required",
      });
    }

    const user = req.userDoc;

    const startDate = new Date(from);
    const endDate = new Date(to);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    // include full end date
    endDate.setHours(23, 59, 59, 999);

    const transactions = await TransactionModel.find({
      userId: req.params.id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 });

    const totalCredits = transactions
      .filter((tx) => tx.type === "credit")
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

    const totalDebits = transactions
      .filter((tx) => tx.type === "debit")
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

    // calculate opening balance from older transactions
    const previousTransactions = await TransactionModel.find({
      userId: req.params.id,
      date: { $lt: startDate },
    });

    const openingBalance = previousTransactions.reduce((sum, tx) => {
      if (tx.type === "credit") return sum + Number(tx.amount || 0);
      if (tx.type === "debit") return sum - Number(tx.amount || 0);
      return sum;
    }, 0);

    const closingBalance = openingBalance + totalCredits - totalDebits;

    const doc = new PDFDocument({ margin: 40, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=statement-${user.name.replace(/\s+/g, "_")}.pdf`
    );

    doc.pipe(res);

    // title
    doc
      .fontSize(20)
      .text(`FabsCapital Statement of Account For ${user.name}`, { align: "center" })
      .moveDown(1);

    // account info
    doc
      .fontSize(12)
      .text(`Account Name: ${user.name}`)
      .text(`Email: ${user.email}`)
      .text(`Account ID: ${user._id}`)
      .text(`Currency: ${user.currency || "$"}`)
      .text(`Statement Period: ${from} to ${to}`)
      .text(`Generated On: ${new Date().toLocaleString()}`)
      .text(`Current Balance: ${user.currency || "$"}${Number(user.balance || 0).toFixed(2)}`)
      .moveDown();

    // summary
    doc
      .fontSize(13)
      .text("Summary", { underline: true })
      .moveDown(0.5);

    doc
      .fontSize(11)
      .text(`Opening Balance: ${user.currency || "$"}${openingBalance.toFixed(2)}`)
      .text(`Total Credits: ${user.currency || "$"}${totalCredits.toFixed(2)}`)
      .text(`Total Debits: ${user.currency || "$"}${totalDebits.toFixed(2)}`)
      .text(`Current Balance: ${user.currency || "$"}${Number(user.balance || 0).toFixed(2)}`)
      .moveDown();

    // transactions
    doc
      .fontSize(13)
      .text("Transactions", { underline: true })
      .moveDown(0.5);

    if (transactions.length === 0) {
      doc.fontSize(11).text("No transactions found for this period.");
    } else {
      transactions.forEach((tx, index) => {
        doc
          .fontSize(11)
          .text(`${index + 1}. ${tx.description || tx.type}`)
          .text(`Type: ${tx.type}`)
          .text(`Amount: ${user.currency || "$"}${Number(tx.amount || 0).toFixed(2)}`)
          .text(`Recipient: ${tx.recipientName || "N/A"}`)
          .text(`Account: ${tx.counterpartyAccount || "N/A"}`)
          .text(`Status: ${tx.status || "Successful"}`)
          .text(`Date: ${new Date(tx.date).toLocaleString()}`)
          .moveDown();

        // new page if content gets long
        if (doc.y > 700) {
          doc.addPage();
        }
      });
    }

    doc.end();
  } catch (err) {
    console.error("STATEMENT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


/// ==================== FACE VERIFICATION MODEL ====================
const FaceVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    email: { type: String, required: true },

    selfieUrl: { type: String, required: true },
    selfiePublicId: { type: String, required: true },

     // ✅ ADD THIS
    selfieUrl: { type: String, default: "" },
selfiePublicId: { type: String, default: "" },

signatureUrl: { type: String, default: "" },
signaturePublicId: { type: String, default: "" },

    status: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },

    adminNote: { type: String, default: "" },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const FaceVerificationModel = mongoose.model(
  "FaceVerification",
  FaceVerificationSchema
);


// ==================== FACE VERIFICATION ROUTES ====================

// User submits selfie for verification
app.post(
  "/user/:id/face-verification",
  upload.fields([
    { name: "selfie", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const user = await EmployeeeModel.findById(req.params.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      const selfieFile = req.files?.selfie?.[0];
      const signatureFile = req.files?.signature?.[0];

      if (!selfieFile && !signatureFile) {
  return res.status(400).json({
    error: "Provide at least a selfie or signature",
  });
}

      let verification = await FaceVerificationModel.findOne({
        userId: user._id,
      });

      // 🧹 delete old images
      // 🧹 delete only what is being replaced
if (selfieFile && verification?.selfiePublicId) {
  await cloudinary.uploader.destroy(verification.selfiePublicId);
}

if (signatureFile && verification?.signaturePublicId) {
  await cloudinary.uploader.destroy(verification.signaturePublicId);
}

      if (verification) {
  if (selfieFile) {
    verification.selfieUrl = selfieFile.path;
    verification.selfiePublicId = selfieFile.filename;
  }

  if (signatureFile) {
    verification.signatureUrl = signatureFile.path;
    verification.signaturePublicId = signatureFile.filename;
  }

  verification.status = "pending";
  verification.adminNote = "";
  verification.verifiedAt = null;

  await verification.save();
} else {
       verification = await FaceVerificationModel.create({
  userId: user._id,
  email: user.email,

  selfieUrl: selfieFile?.path || "",
  selfiePublicId: selfieFile?.filename || "",

  signatureUrl: signatureFile?.path || "",
  signaturePublicId: signatureFile?.filename || "",

  status: "pending",
});
      }

      // 🔔 notify admins (ADD signature)
      io.to("admins").emit("newFaceVerification", {
        verificationId: verification._id,
        userId: user._id,
        name: user.name,
        email: user.email,
        selfieUrl: verification.selfieUrl,
        signatureUrl: verification.signatureUrl, // ✅ ADD THIS
        status: verification.status,
        createdAt: verification.createdAt,
      });

      const notification = await NotificationModel.create({
        title: "Face Verification Submitted",
        message: "Your verification is pending admin review.",
        userEmail: user.email,
      });

      io.to(user.email).emit("newNotification", notification);
      io.to(user.email).emit("faceVerificationUpdated", verification);

      res.json({
        success: true,
        verification,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// User gets their own face verification
app.get("/user/:id/face-verification", async (req, res) => {
  try {
    const verification = await FaceVerificationModel.findOne({
      userId: req.params.id,
    }).sort({ createdAt: -1 });

    res.json(verification || null);
  } catch (err) {
    console.error("GET USER FACE VERIFICATION ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// Admin gets all face verifications
app.get("/admin/face-verifications", async (req, res) => {
  try {
    const verifications = await FaceVerificationModel.find().sort({ createdAt: -1 });

    const formatted = await Promise.all(
      verifications.map(async (item) => {
        const user = await EmployeeeModel.findById(item.userId).select("name email");

        return {
          _id: item._id,
          userId: item.userId,
          name: user?.name || "",
          email: user?.email || item.email,
          selfieUrl: item.selfieUrl,
          signatureUrl: item.signatureUrl, // ✅ ADD THIS
          status: item.status,
          adminNote: item.adminNote,
          verifiedAt: item.verifiedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      })
    );

    res.json(formatted);
  } catch (err) {
    console.error("GET ADMIN FACE VERIFICATIONS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// Admin approves or rejects face verification
app.put("/admin/face-verification/:id/status", async (req, res) => {
  try {
    const { status, adminNote } = req.body;

    if (!["verified", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ error: "Status must be verified or rejected" });
    }

    const verification = await FaceVerificationModel.findById(req.params.id);
    if (!verification) {
      return res.status(404).json({ error: "Face verification not found" });
    }

    verification.status = status;
    verification.adminNote = adminNote || "";
    verification.verifiedAt = status === "verified" ? new Date() : null;

    await verification.save();

    const notification = await NotificationModel.create({
      title:
        status === "verified"
          ? "Face Verification and signature Approved"
          : "Face Verification and signature Rejected",
      message:
        status === "verified"
          ? "Your face verification and signature has been approved."
          : verification.adminNote
          ? `Your face verification and signature was rejected: ${verification.adminNote}`
          : "Your face verification and signature was rejected.",
      userEmail: verification.email,
    });

    io.to(verification.email).emit("newNotification", notification);
    io.to(verification.email).emit("faceVerificationUpdated", verification);
    io.to("admins").emit("faceVerificationReviewed", verification);

    res.json({
      success: true,
      message: `Face verification ${status} successfully`,
      verification,
    });
  } catch (err) {
    console.error("UPDATE FACE VERIFICATION STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// Admin deletes face verification completely
app.delete("/admin/face-verification/:id", async (req, res) => {
  try {
    const verification = await FaceVerificationModel.findById(req.params.id);
    if (!verification) {
      return res.status(404).json({ error: "Face verification not found" });
    }

    if (verification.selfiePublicId) {
      await cloudinary.uploader.destroy(verification.selfiePublicId);
    }

    await FaceVerificationModel.findByIdAndDelete(req.params.id);

    io.to(verification.email).emit("faceVerificationDeleted");
    io.to("admins").emit("faceVerificationDeletedByAdmin", req.params.id);

    res.json({
      success: true,
      message: "Face verification deleted successfully",
    });
  } catch (err) {
    console.error("DELETE FACE VERIFICATION ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});



// DELETE ONLY SIGNATURE
app.delete("/admin/face-verification/:id/signature", async (req, res) => {
  try {
    const verification = await FaceVerificationModel.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({ error: "Not found" });
    }

    // delete from cloudinary
    if (verification.signaturePublicId) {
      await cloudinary.uploader.destroy(verification.signaturePublicId);
    }

    // remove only signature
    verification.signatureUrl = "";
    verification.signaturePublicId = "";

    await verification.save();

    // notify user + admin
    io.to(verification.email).emit("faceVerificationUpdated", verification);
    io.to("admins").emit("faceVerificationReviewed", verification);

    res.json({
      success: true,
      message: "Signature deleted successfully",
      verification,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// APPROVE ONLY SIGNATURE
app.put("/admin/face-verification/:id/signature/approve", async (req, res) => {
  try {
    const verification = await FaceVerificationModel.findById(req.params.id);

    if (!verification) {
      return res.status(404).json({ error: "Not found" });
    }

    if (!verification.signatureUrl) {
      return res.status(400).json({ error: "No signature to approve" });
    }

    // mark as verified (you can customize this logic)
    verification.status = "verified";
    verification.verifiedAt = new Date();
    verification.adminNote = "Signature verified";

    await verification.save();

    // notify user + admin
    io.to(verification.email).emit("faceVerificationUpdated", verification);
    io.to("admins").emit("faceVerificationReviewed", verification);

    res.json({
      success: true,
      message: "Signature approved",
      verification,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// ==================== START SERVER ====================
httpServer.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
