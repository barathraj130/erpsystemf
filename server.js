const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

// --- Middleware Imports ---
console.log("<<<<< DEBUG: server.js - Attempting to require ./middlewares/auditLogMiddleware.js >>>>>");
const auditLogMiddlewareModule = require('./middlewares/auditLogMiddleware');
const auditLogMiddleware = auditLogMiddlewareModule.auditLogMiddleware;
console.log("<<<<< DEBUG: server.js - auditLogMiddleware type:", typeof auditLogMiddleware, " >>>>>");

console.log("<<<<< DEBUG: server.js - Attempting to require ./middlewares/authMiddleware.js >>>>>");
const authMiddlewareModule = require('./middlewares/authMiddleware');
const authMiddleware = authMiddlewareModule.authMiddleware;
const checkRole = authMiddlewareModule.checkRole;
console.log("<<<<< DEBUG: server.js - authMiddleware type:", typeof authMiddleware, "checkRole type:", typeof checkRole, " >>>>>");

// --- Route Imports ---
console.log("<<<<< DEBUG: server.js - Requiring ALL Route Files >>>>>");
const userRoutes = require('./routes/userRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const reportRoutes = require('./routes/reportRoutes');
const lenderRoutes = require('./routes/lenderRoutes');
const businessAgreementRoutes = require('./routes/businessAgreementRoutes');
const productRoutes = require('./routes/productRoutes');
const productSupplierRoutes = require('./routes/productSupplierRoutes'); // Ensure this is present
const invoiceRoutes = require('./routes/invoiceRoutes');
const auditLogRoutesFromFile = require('./routes/auditLogRoutes');
console.log("<<<<< DEBUG: server.js - ALL Route Files Required >>>>>");

const app = express();

// --- Core Middleware (Applied First) ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static Files Middleware ---
app.use(express.static(path.join(__dirname, 'frontend/assets')));
console.log("<<<<< DEBUG: server.js - Serving static files from frontend/assets at root URL >>>>>");


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

// --- Audit Logging Middleware for API routes ---
app.use('/api', auditLogMiddleware);


// --- API Routes ---
console.log("<<<<< DEBUG: server.js - Mounting API Routes >>>>>");
app.use('/api/users', userRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/external-entities', lenderRoutes);
app.use('/api/business-agreements', businessAgreementRoutes);
app.use('/api/products', productRoutes);
app.use('/api/product-suppliers', productSupplierRoutes); // Ensure this is present and used
app.use('/api/invoices', invoiceRoutes);
app.use('/api/auditlog', checkRole(['admin']), auditLogRoutesFromFile);
console.log("<<<<< DEBUG: server.js - API Routes Mounted >>>>>");


// --- API Specific 404 Handler ---
app.use(/^\/api\/.*/, (req, res, next) => {
  console.log(`❌ API Route Not Found (RegExp API 404): ${req.method} ${req.originalUrl}`);
  return res.status(404).json({ error: 'The requested API endpoint was not found.' });
});
console.log("<<<<< DEBUG: server.js - RegExp API Specific 404 Handler is ACTIVE >>>>>");

// --- Frontend Catch-all Route (for Single Page Applications) ---
app.get(/^((?!\/api\/|\/[^/.]+\.[^/.]+).)*$|^(\/$)(?!.*\.\w{2,5}$)/, (req, res) => {
    console.log(`ℹ️ Serving index.html for SPA frontend route (RegExp): ${req.originalUrl}`);
    res.sendFile(path.join(__dirname, 'frontend/assets/index.html'));
});
console.log("<<<<< DEBUG: server.js - RegExp Frontend Catch-all app.get() is ACTIVE (serving from assets) >>>>>");


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

// --- Ultimate Fallback 404 (if truly nothing matched) ---
app.use((req, res) => {
    console.log(`❌ Ultimate Fallback 404 Handler (No Route Matched): ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: "The requested resource was not found on this server (ultimate fallback)." });
});


// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  if (db && typeof db.get === 'function') {
    db.get("SELECT 1", (err) => {
        if(err) console.error("❌ Failed to make a test query to SQLite DB (server.js):", err.message);
        else console.log("✅ Connected to SQLite DB (test query successful from server.js).");
    });
  } else {
    console.warn("⚠️ DB object not fully initialized or 'get' method missing for test query (server.js).");
  }
});