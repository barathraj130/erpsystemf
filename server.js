// START OF FILE server.js (Final Corrected Version)

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const cron = require('node-cron');
const { exec } = require('child_process');

// --- Middleware Imports ---
const { auditLogMiddleware } = require('./middlewares/auditLogMiddleware');
const { authMiddleware, checkAuth, checkRole } = require('./middlewares/authMiddleware');

// --- Route Imports ---
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const reportRoutes = require('./routes/reportRoutes');
const lenderRoutes = require('./routes/lenderRoutes');
const businessAgreementRoutes = require('./routes/businessAgreementRoutes');
const productRoutes = require('./routes/productRoutes');
const productSupplierRoutes = require('./routes/productSupplierRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const auditLogRoutesFromFile = require('./routes/auditLogRoutes');

const app = express();

// --- 1. Core Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware); // This middleware attempts to decode the user from a token on every request

// --- 2. API Routes ---
// We create a dedicated router for our API to keep it separate.
const apiRouter = express.Router();

// Public API routes (like login and signup) that DON'T require a token
apiRouter.use('/auth', authRoutes);

// Protected API routes that DO require a valid token (enforced by `checkAuth`)
apiRouter.use('/users', checkAuth, auditLogMiddleware, userRoutes);
apiRouter.use('/transactions', checkAuth, auditLogMiddleware, transactionRoutes);
apiRouter.use('/external-entities', checkAuth, auditLogMiddleware, lenderRoutes);
apiRouter.use('/business-agreements', checkAuth, auditLogMiddleware, businessAgreementRoutes);
apiRouter.use('/products', checkAuth, auditLogMiddleware, productRoutes);
apiRouter.use('/product-suppliers', checkAuth, auditLogMiddleware, productSupplierRoutes);
apiRouter.use('/invoices', checkAuth, auditLogMiddleware, invoiceRoutes);
apiRouter.use('/ledger', checkAuth, ledgerRoutes);
apiRouter.use('/reports', checkAuth, reportRoutes);
apiRouter.use('/auditlog', checkAuth, checkRole(['admin']), auditLogRoutesFromFile);

// We tell our main app to use this router for any path starting with `/api`
app.use('/api', apiRouter);


// --- 3. Frontend Routes ---
// This section now comes AFTER the API section.

// First, serve static files like CSS and JS. The path `/css/login.css` will be
// correctly found in `frontend/assets/css/login.css`.
app.use(express.static(path.join(__dirname, 'frontend/assets')));

// Next, handle explicit requests for our main pages.
app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'frontend/assets/login.html'));
});

app.get('/signup.html', (req, res) => {
    if (req.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'frontend/assets/signup.html'));
});

// Finally, the catch-all route for our Single Page Application.
// This MUST be the last route. It ensures that if a logged-in user refreshes
// on a page like `/customers`, the main `index.html` is served.
app.get('*', (req, res) => {
    if (!req.user) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'frontend/assets/index.html'));
});

// --- 4. Global Error Handler ---
// This will catch any errors that occur in our API routes.
app.use((err, req, res, next) => {
  console.error('🆘 Global Server Error Handler Caught:', err.stack || err.message);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.statusCode || 500;
  // Always respond with JSON for errors
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});


// --- Server Start and Backup Scheduler ---
// (This part is unchanged and correct)
cron.schedule('0 2 * * *', () => {
    console.log('🕒 Running daily backup job...');
    exec('node backup.js', (error, stdout, stderr) => {
      if (error) { console.error(`❌ Backup failed: ${error.message}`); return; }
      if (stderr) { console.error(`❌ Backup stderr: ${stderr}`); return; }
      console.log(`💡 Backup script output: ${stdout.trim()}`);
    });
  }, { scheduled: true, timezone: "Asia/Kolkata" });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log('🕒 Daily backup scheduled for 2:00 AM.');
    db.get("SELECT 1", (err) => {
        if (err) { console.error("❌ SQLite test query failed: " + err.message); }
        else { console.log("✅ SQLite DB connection OK."); }
    });
});