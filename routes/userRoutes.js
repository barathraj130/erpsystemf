// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt'); // <-- Add this
const saltRounds = 10; // <-- Add this

// Get all users (customers/employees)
router.get('/', (req, res) => {
  const sql = `
    SELECT
      u.id, u.username, u.email, u.phone, u.company, u.initial_balance,
      u.created_at, u.address_line1, u.address_line2, u.city_pincode,
      u.state, u.gstin, u.state_code, u.role,
      (u.initial_balance + IFNULL((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id = u.id), 0)) AS remaining_balance 
    FROM users u
    ORDER BY u.id DESC
  `;
  db.all(sql, (err, rows) => {
    if (err) {
        console.error("Error fetching users:", err.message);
        return res.status(500).json({ error: err.message });
    }
    // We don't send the password hash to the client
    res.json(rows.map(({ password, ...rest }) => rest) || []);
  });
});

// Create user (customer/employee)
router.post('/', (req, res) => {
  const { 
    username, email, phone, company, initial_balance, role,
    address_line1, address_line2, city_pincode, state, gstin, state_code,
    password // New password field from UI
  } = req.body;

  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  const createUser = (hashedPassword = null) => {
    db.run(
      `INSERT INTO users (
          username, password, email, phone, company, initial_balance, role,
          address_line1, address_line2, city_pincode, state, gstin, state_code
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
          username, hashedPassword, email, phone, company, parseFloat(initial_balance || 0), role || 'user',
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
        res.status(201).json({ id: this.lastID, message: 'User created successfully' });
      }
    );
  };

  if (password) {
    bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
      if (err) return res.status(500).json({ error: 'Failed to hash password' });
      createUser(hashedPassword);
    });
  } else {
    createUser(null); // Create user without a password
  }
});

// Update User (customer/employee)
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { 
        username, email, phone, company, initial_balance, role,
        address_line1, address_line2, city_pincode, state, gstin, state_code,
        password // Allow updating password
    } = req.body;

    if (!username) {
        return res.status(400).json({ error: "Username is required." });
    }
    
    // This is a simplified update. A real app might have separate password change endpoints.
    const updateUserQuery = (hashedPassword) => {
        let sql = `UPDATE users SET 
            username = ?, email = ?, phone = ?, company = ?, initial_balance = ?, role = ?,
            address_line1 = ?, address_line2 = ?, city_pincode = ?, state = ?, gstin = ?, state_code = ?
            ${hashedPassword ? ', password = ?' : ''}
            WHERE id = ?`;
            
        const params = [
            username, email, phone, company, parseFloat(initial_balance || 0), role || 'user', 
            address_line1, address_line2, city_pincode, state, gstin, state_code
        ];
        
        if (hashedPassword) params.push(hashedPassword);
        params.push(id);

        db.run(sql, params, function(err) {
            if (err) {
                if (err.message.includes("UNIQUE constraint failed: users.username")) {
                    return res.status(400).json({ error: "Username already exists for another user." });
                }
                console.error("Error updating user:", err.message);
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) return res.status(404).json({ message: "User not found" });
            res.json({ message: 'User updated successfully' });
        });
    };

    if (password) {
        bcrypt.hash(password, saltRounds, (err, hashedPassword) => {
            if (err) return res.status(500).json({ error: 'Failed to hash password' });
            updateUserQuery(hashedPassword);
        });
    } else {
        updateUserQuery(null);
    }
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