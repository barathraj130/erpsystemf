// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all users (customers/employees)
router.get('/', (req, res) => {
  const sql = `
    SELECT
      u.id,
      u.username,
      u.email,
      u.phone,
      u.company,
      u.initial_balance,
      u.created_at,
      u.address_line1,
      u.address_line2,
      u.city_pincode,
      u.state,
      u.gstin,
      u.state_code,
      (u.initial_balance + IFNULL((
        SELECT SUM(t.amount)
        FROM transactions t
        WHERE t.user_id = u.id
      ), 0)) AS remaining_balance 
    FROM users u
    ORDER BY u.id DESC
  `;
  db.all(sql, (err, rows) => {
    if (err) {
        console.error("Error fetching users:", err.message);
        return res.status(500).json({ error: err.message });
    }
    res.json(rows || []); // Ensure an empty array is sent if no rows
  });
});

// Create user (customer/employee)
router.post('/', (req, res) => {
  const { 
    username, email, phone, company, initial_balance, role,
    address_line1, address_line2, city_pincode, state, gstin, state_code 
  } = req.body;

  if (initial_balance === undefined || initial_balance === null || isNaN(parseFloat(initial_balance))) {
    return res.status(400).json({ error: "Initial balance is required and must be a valid number." });
  }
  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  db.run(
    `INSERT INTO users (
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
        username, email, phone, company, parseFloat(initial_balance), role || 'user',
        address_line1, address_line2, city_pincode, state, gstin, state_code
    ],
    function(err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed: users.username")) {
            return res.status(400).json({ error: "Username already exists." });
        }
        console.error("Error creating user:", err.message);
        return res.status(500).json({ error: err.message });
      }

      const newUserId = this.lastID;
      // Fetch the newly created user with calculated remaining_balance
      const fetchSql = `
        SELECT
           u.id, u.username, u.email, u.phone, u.company, u.initial_balance, u.role, u.created_at,
           u.address_line1, u.address_line2, u.city_pincode, u.state, u.gstin, u.state_code,
           (u.initial_balance + IFNULL((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance
         FROM users u
         WHERE id = ?`;

      db.get(fetchSql, [newUserId], (fetchErr, user) => {
          if (fetchErr) {
            console.error("Error fetching newly created user:", fetchErr.message);
            return res.status(201).json({ id: newUserId, message: 'User created, but failed to fetch full details.' });
          }
          if (!user) return res.status(404).json({ error: 'User not found after creation' });
          res.status(201).json({ user, message: 'User created successfully' });
        }
      );
    }
  );
});

// Update User (customer/employee)
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { 
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code 
    } = req.body;

    if (initial_balance === undefined || initial_balance === null || isNaN(parseFloat(initial_balance))) {
        return res.status(400).json({ error: "Initial balance must be a valid number." });
    }
    if (!username) {
        return res.status(400).json({ error: "Username is required." });
    }

    db.run(
        `UPDATE users SET 
            username = ?, email = ?, phone = ?, company = ?, initial_balance = ?, role = ?,
            address_line1 = ?, address_line2 = ?, city_pincode = ?, state = ?, gstin = ?, state_code = ?
         WHERE id = ?`,
        [
            username, email, phone, company, parseFloat(initial_balance), role || 'user', 
            address_line1, address_line2, city_pincode, state, gstin, state_code, 
            id
        ],
        function(err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed: users.username")) {
                    return res.status(400).json({ error: "Username already exists for another user." });
                }
                console.error("Error updating user:", err.message);
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ message: "User not found" });
            
            // Fetch the updated user with calculated remaining_balance
            const fetchSql = `
                SELECT
                u.id, u.username, u.email, u.phone, u.company, u.initial_balance, u.role, u.created_at,
                u.address_line1, u.address_line2, u.city_pincode, u.state, u.gstin, u.state_code,
                (u.initial_balance + IFNULL((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance
                FROM users u
                WHERE id = ?`;

            db.get(fetchSql, [id], (fetchErr, user) => {
                if (fetchErr) {
                    console.error("Error fetching updated user:", fetchErr.message);
                    return res.json({ message: 'User updated successfully (failed to fetch full details).' });
                }
                if (!user) return res.status(404).json({ error: 'User not found after update' });
                res.json({ user, message: 'User updated successfully' });
            });
        }
    );
});

// Delete User (customer/employee)
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
        if (err) {
            console.error("Error deleting user:", err.message);
            return res.status(500).json({ error: "Failed to delete user: " + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json({ message: "User deleted successfully. Associated transactions have had their user_id set to NULL." });
    });
});

module.exports = router;