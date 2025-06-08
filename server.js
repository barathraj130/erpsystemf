const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

// --- Middleware Imports ---
const { auditLogMiddleware } = require('./middlewares/auditLogMiddleware');
const { authMiddleware, checkAuth, checkRole } = require('./middlewares/authMiddleware');

// --- Route Imports ---
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
const authRoutes = require('./routes/authRoutes');

const app = express();

// --- Core Middleware (Applied First) ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static Files Middleware ---
// This serves CSS, JS, etc. from the root URL. E.g. /css/style.css
app.use(express.static(path.join(__dirname, 'frontend/assets')));

// --- Custom Request Logging Middleware ---
app.use((req, res, next) => {
  console.log(`➡️ ${req.method} ${req.originalUrl}`);
  if (req.method !== 'GET' && req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    const bodyToLog = { ...req.body };
    if (bodyToLog.password) bodyToLog.password = '[REDACTED]';
    if (bodyToLog.confirmPassword) bodyToLog.confirmPassword = '[REDACTED]';
    console.log('   Body:', JSON.stringify(bodyToLog));
  }
  next();
});

// --- Authentication Middleware ---
app.use(authMiddleware);

// --- API Router Setup ---
const apiRouter = express.Router();

// Public API route (login)
apiRouter.use('/auth', authRoutes);

// Protected API routes
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

// Mount the entire API router under the /api prefix
app.use('/api', apiRouter);


// --- Frontend Route Handling ---
// This section now correctly handles serving login.html and index.html

// Specifically handle the /login route to serve login.html
app.get('/login', (req, res) => {
    // If a user is already logged in, redirect them to the dashboard instead of showing the login page.
    if (req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'frontend/assets/login.html'));
});

// The catch-all for serving the main app (index.html) for any other route
app.get('*', (req, res) => {
    // If a user is not logged in, redirect them to the /login page.
    if (!req.user) {
        return res.redirect('/login');
    }
    // If they are logged in, serve the main application.
    res.sendFile(path.join(__dirname, 'frontend/assets/index.html'));
});


// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('🆘 Global Server Error Handler Caught:', err.stack || err.message);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  res.status(statusCode).json({
    error: message,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});


// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  db.get("SELECT 1", (err) => {
      if(err) {
        console.error("❌ SQLite test query failed: " + err.message);
      } else {
        console.log("✅ SQLite DB connection OK.");
      }
  });
});