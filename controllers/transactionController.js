const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// @desc    Get all transactions
// @route   GET /api/transactions
exports.getAllTransactions = (req, res) => {
  const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'));

  const sql = `
    SELECT t.*, u.username
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id
    ORDER BY t.date DESC
  `;

  db.all(sql, [], (err, rows) => {
    db.close();
    if (err) {
      console.error('Error fetching transactions:', err.message);
      return res.status(500).json({ error: 'Failed to fetch transactions' });
    }

    res.json(rows);
  });
};

// @desc    Create a new transaction
// @route   POST /api/transactions
exports.createTransaction = (req, res) => {
  const { user_id, amount, description, category, date } = req.body;

  const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'));

  const sql = `
    INSERT INTO transactions (user_id, amount, description, category, date)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.run(sql, [user_id, amount, description, category, date], function (err) {
    db.close();
    if (err) {
      console.error('Error creating transaction:', err.message);
      return res.status(500).json({ error: 'Failed to create transaction' });
    }

    res.json({ message: 'Transaction added', id: this.lastID });
  });
};

// @desc    Update transaction by ID
// @route   PUT /api/transactions/:id
exports.updateTransaction = (req, res) => {
  const { id } = req.params;
  const { amount, description, category, date } = req.body;

  const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'));

  const sql = `
    UPDATE transactions
    SET amount = ?, description = ?, category = ?, date = ?
    WHERE id = ?
  `;

  db.run(sql, [amount, description, category, date, id], function (err) {
    db.close();
    if (err) {
      console.error('Error updating transaction:', err.message);
      return res.status(500).json({ error: 'Failed to update transaction' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction updated successfully' });
  });
};

// @desc    Delete a transaction by ID
// @route   DELETE /api/transactions/:id
exports.deleteTransaction = (req, res) => {
  const { id } = req.params;
  const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'));

  db.run('DELETE FROM transactions WHERE id = ?', [id], function (err) {
    db.close();
    if (err) {
      console.error('Error deleting transaction:', err.message);
      return res.status(500).json({ error: 'Failed to delete transaction' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ message: 'Transaction deleted successfully' });
  });
};

// @desc    Search transactions
// @route   GET /api/transactions/search?query=...
exports.searchTransactions = (req, res) => {
  const query = req.query.query;

  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'));

  const sql = `
    SELECT t.id AS transaction_id, t.user_id, t.amount, t.date, u.username
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    WHERE LOWER(u.username) LIKE ?
       OR CAST(t.amount AS TEXT) LIKE ?
       OR t.date LIKE ?
  `;

  db.all(sql, [`%${query.toLowerCase()}%`, `%${query}%`, `%${query}%`], (err, rows) => {
    db.close();
    if (err) {
      console.error('Search error:', err.message);
      return res.status(500).json({ error: 'Database search failed' });
    }

    res.json(rows);
  });
};