// --- START OF FILE server.js ---

// --- START OF COMPLETE server.js FILE (DEFINITIVE FIX) ---

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
const notificationRoutes = require('./routes/notificationRoutes'); // <-- Add this
const authRoutes = require('./routes/authRoutes');
const app = express();

// --- 1. Core Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware); // This middleware TRIES to decode a user from a token on every request

// --- 2. API Routes ---
const apiRouter = express.Router();

// Public API routes
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
apiRouter.use('/notifications', checkAuth, notificationRoutes);
apiRouter.use('/auditlog', checkAuth, checkRole(['admin']), auditLogRoutesFromFile);

// Use the API router for all /api paths
app.use('/api', apiRouter);


// --- 3. Frontend Routes ---

// FIX: Serve all static frontend files from a dedicated 'public' directory.
// This is the standard and robust practice.
// All HTML, CSS, and client-side JS files should be moved into this 'public' folder.
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// The catch-all route for the Single-Page Application.
// This MUST be the last non-error-handling route.
// It serves the main application shell, and client-side routing takes over.
app.get('*', (req, res, next) => {
    // If the request is for an API endpoint that wasn't found, let it fall through.
    if (req.path.startsWith('/api/')) {
        return next();
    }
    // For any other request, send the main index.html file from the public directory.
    res.sendFile(path.join(publicPath, 'index.html'), (err) => {
        if (err) {
            console.error("Error sending index.html from public directory:", err);
            res.status(500).send("Server error: Could not serve the application shell.");
        }
    });
});


// --- 4. Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('🆘 Global Server Error Handler Caught:', err.stack || err.message);
  if (res.headersSent) {
    return next(err);
  }
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});


// --- 5. Server Start and Backup Scheduler ---
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