const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/daily', (req, res) => {
  const { date } = req.query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date parameter is required in YYYY-MM-DD format.' });
  }

  const sql = `
    SELECT
      t.id,
      t.date,
      t.amount,
      t.description,
      t.category,
      t.user_id,
      u.username,
      l.lender_name
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN lenders l ON t.lender_id = l.id
    WHERE t.date = ?
    ORDER BY t.id ASC
  `;
  // This query provides basic info. For a true ledger, you'd calculate running balances.
  // The frontend script.js currently handles the running balance calculation.

  db.all(sql, [date], (err, rows) => {
    if (err) {
      console.error("Ledger query error:", err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

module.exports = router;