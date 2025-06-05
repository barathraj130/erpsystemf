// models/transactionModel.js
const db = require('../db');

// Transaction model with methods to interact with the 'transactions' table

class Transaction {
  static createTransaction(user_id, amount, date, callback) {
    const query = `INSERT INTO transactions (user_id, amount, date) VALUES (?, ?, ?)`;
    db.run(query, [user_id, amount, date], function (err) {
      callback(err, this.lastID);
    });
  }

  static getAllTransactions(callback) {
    const query = `SELECT * FROM transactions`;
    db.all(query, [], (err, rows) => {
      callback(err, rows);
    });
  }

  static getTransactionsByUserId(user_id, callback) {
    const query = `SELECT * FROM transactions WHERE user_id = ?`;
    db.all(query, [user_id], (err, rows) => {
      callback(err, rows);
    });
  }
}

module.exports = Transaction;
