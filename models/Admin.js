const mongoose = require('mongoose')

const AdminSchema = new mongoose.Schema({
  username: String,
  password: String
})

const AdminModel = mongoose.model("admins", AdminSchema)
module.exports = AdminModel



