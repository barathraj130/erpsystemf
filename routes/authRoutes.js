// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { jwtSecret } = require('../config');
const { checkAuth } = require('../middlewares/authMiddleware');

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Please enter all fields.' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error("Login DB Error:", err);
            return res.status(500).json({ error: 'Database error during login.' });
        }
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        if (!user.password) {
            return res.status(401).json({ error: 'This user account is not configured for password login.' });
        }

        try {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid credentials.' });
            }

            const payload = {
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
                }
            };

            jwt.sign(payload, jwtSecret, { expiresIn: '8h' }, (err, token) => {
                if (err) throw err;
                res.json({ token });
            });
        } catch (e) {
            console.error("bcrypt compare error:", e);
            res.status(500).json({ error: 'Server error during password comparison.' });
        }
    });
});

// @route   GET /api/auth/me
// @desc    Get current user data from token
// @access  Private
router.get('/me', checkAuth, (req, res) => {
    // checkAuth middleware ensures req.user is set, so we can send it back
    // We remove the password from the object before sending it to the client
    const { password, ...userWithoutPassword } = req.user;
    res.json(userWithoutPassword);
});

module.exports = router;