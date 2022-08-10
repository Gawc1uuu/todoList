const mongoose = require("mongoose");

const doneTodosSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
  },
  added: {
    type: Date,
    required: true,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
});

const DoneTodo = mongoose.model("DoneTodo", doneTodosSchema);

module.exports = DoneTodo;
