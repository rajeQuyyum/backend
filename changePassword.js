const mongoose = require("mongoose");
require("dotenv").config();
const AdminModel = require("./models/Admin");

async function changePassword() {
  try {
    await mongoose.connect(process.env.DATABASE);
    console.log("✅ Connected to MongoDB");

    const username = "admin"; // change this if your admin username is different
    const newPassword = "123"; // <-- set your new password here

    const result = await AdminModel.updateOne(
      { username },
      { $set: { password: newPassword } }
    );

    if (result.matchedCount === 0) {
      console.log("❌ Admin not found");
    } else {
      console.log("✅ Password updated successfully!");
    }

    mongoose.connection.close();
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

changePassword();
