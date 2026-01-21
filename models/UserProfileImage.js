const mongoose = require("mongoose");

const UserProfileImageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      unique: true,
      required: true,
    },
    imageUrl: { type: String, required: true },
    publicId: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "UserProfileImage",
  UserProfileImageSchema
);
