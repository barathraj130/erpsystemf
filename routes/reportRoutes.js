const express = require('express');
const router = express.Router();
const db = require('../db');

// Balance summary report
router.get('/balances', (req, res) => {
  const { month } = req.query; // Expects YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Month parameter is required in YYYY-MM format." });
  }

  const summarySql = `
    SELECT
      SUM(u.initial_balance) AS total_initial_balance_all_users,
      (SUM(u.initial_balance) + IFNULL((SELECT SUM(amount) FROM transactions WHERE user_id IS NOT NULL), 0)) AS total_current_balance_all_users,
      (SELECT SUM(amount) FROM transactions WHERE strftime('%Y-%m', date) = ?) AS net_change_this_month, 
      COUNT(DISTINCT t_month.user_id) AS user_count_with_transactions_this_month
    FROM users u
    LEFT JOIN transactions t_month ON u.id = t_month.user_id AND strftime('%Y-%m', t_month.date) = ?;
  `;
  // Note: net_change_this_month above is ALL transactions in the month, not just user-specific.
  // The frontend calculation might be more specific if it filters by user.

  const usersSql = `
    SELECT
      u.id, u.username, u.initial_balance,
      IFNULL((SELECT SUM(t_user_month.amount) FROM transactions t_user_month WHERE t_user_month.user_id = u.id AND strftime('%Y-%m', t_user_month.date) = ?), 0) AS net_change_this_month,
      (u.initial_balance + IFNULL((SELECT SUM(t_user_all.amount) FROM transactions t_user_all WHERE t_user_all.user_id = u.id), 0)) AS current_balance
    FROM users u
    GROUP BY u.id, u.username, u.initial_balance
    ORDER BY u.username;
  `;

  db.get(summarySql, [month, month], (err, summaryRow) => {
    if (err) return res.status(500).json({ error: "Summary query failed: " + err.message });
    db.all(usersSql, [month], (errUsers, usersRows) => {
      if (errUsers) return res.status(500).json({ error: "Users query failed: " + errUsers.message });
      res.json({ month, summary: summaryRow || {}, users: usersRows || [] });
    });
  });
});

// Daily summary report
router.get('/daily', (req, res) => {
  const { date } = req.query; // Expects YYYY-MM-DD
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Date parameter is required in YYYY-MM-DD format." });
  }
  const dailySummarySql = `
    SELECT COUNT(*) AS totalTransactions, SUM(amount) AS totalNetAmount,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS totalIncome,
           SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS totalExpense
    FROM transactions WHERE date = ?;`;
  const transactionsSql = `
    SELECT t.*, u.username, le.lender_name AS external_entity_name 
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id 
    LEFT JOIN lenders le ON t.lender_id = le.id
    WHERE t.date = ? ORDER BY t.id ASC;`;

  db.get(dailySummarySql, [date], (err, summary) => {
    if (err) return res.status(500).json({ error: "Daily summary query failed: " + err.message });
    db.all(transactionsSql, [date], (errTx, transactions) => {
      if (errTx) return res.status(500).json({ error: "Daily transactions query failed: " + errTx.message });
      res.json({ date, ...(summary || {}), transactions: transactions || [] });
    });
  });
});

// Transaction analytics
router.get('/analytics', (req, res) => {
  const { month } = req.query; // Expects YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Month parameter is required in YYYY-MM format." });
  }
  const overallAnalyticsSql = `
    SELECT COUNT(*) as totalTransactions, SUM(amount) as totalNetAmount,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as totalIncome,
           SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as totalExpense
    FROM transactions WHERE strftime('%Y-%m', date) = ?;`;
  const categoryAnalyticsSql = `
    SELECT category, COUNT(*) AS count, SUM(amount) AS net_amount,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS total_income,
           SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) AS total_expense
    FROM transactions WHERE strftime('%Y-%m', date) = ? AND category IS NOT NULL AND category != ''
    GROUP BY category ORDER BY net_amount DESC;`;

  db.get(overallAnalyticsSql, [month], (err, summary) => {
    if (err) return res.status(500).json({ error: "Overall analytics query failed: " + err.message });
    db.all(categoryAnalyticsSql, [month], (errCat, categories) => {
      if (errCat) return res.status(500).json({ error: "Category analytics query failed: " + errCat.message });
      res.json({ month, ...(summary || {}), categories: categories || [] });
    });
  });
});

// User history report (transactions for a specific user in a month)
router.get('/user-history', (req, res) => {
  const { month } = req.query; // Expects YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Month parameter is required in YYYY-MM format." });
  }
  // This report is better handled by filtering allTransactionsCache on the frontend (script.js)
  // as it has more context about category groups.
  // However, if a backend version is needed:
  const userHistorySql = `
    SELECT u.id, u.username, COUNT(t.id) AS transaction_count_this_month,
           IFNULL(SUM(t.amount), 0) AS net_amount_this_month,
           IFNULL(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END), 0) AS total_income_this_month,
           IFNULL(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END), 0) AS total_expense_this_month,
           MAX(t.date) AS last_activity_this_month
    FROM users u
    LEFT JOIN transactions t ON u.id = t.user_id AND strftime('%Y-%m', t.date) = ?
    WHERE t.id IS NOT NULL /* Only include users with transactions in the month */
    GROUP BY u.id, u.username 
    ORDER BY u.username;`;

  db.all(userHistorySql, [month], (err, users) => {
    if (err) return res.status(500).json({ error: "User history query failed: " + err.message });
    res.json({ month, users: users || [] });
  });
});

module.exports = router;