// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing

const DB_PATH = path.join(__dirname, 'database.sqlite');
let dbInitialized = false;

console.log("ℹ️ [db.js] Attempting to open database...");
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error("❌ [db.js] Error opening database:", err.message);
    process.exit(1); // Exit if DB connection fails
  } else {
    console.log("✅ [db.js] Connected to the SQLite database.");
    initializeDb();
  }
});

function initializeDb() {
  if (dbInitialized) {
    console.log("ℹ️ [db.js] Database already initialized. Skipping.");
    return;
  }
  console.log("ℹ️ [db.js] Starting database initialization...");
  db.serialize(() => {
    console.log("ℹ️ [db.js] Inside db.serialize()...");

    // Users Table (Customers)
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT, -- For login
        email TEXT,
        phone TEXT,
        company TEXT,
        initial_balance REAL DEFAULT 0,
        role TEXT DEFAULT 'user', -- 'user' or 'admin'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        address_line1 TEXT,
        address_line2 TEXT,
        city_pincode TEXT,
        state TEXT,
        gstin TEXT,
        state_code TEXT
      )
    `, (err) => {
      if (err) console.error("❌ [db.js] Error creating/checking users table:", err.message);
      else console.log("✅ [db.js] Users table checked/created.");
    });

    // Lenders/External Entities Table
    db.run(`
      CREATE TABLE IF NOT EXISTS lenders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lender_name TEXT NOT NULL UNIQUE,
        entity_type TEXT DEFAULT 'General', -- 'Supplier', 'Bank', 'Chit Provider', 'Individual Lender' etc.
        contact_person TEXT,
        phone TEXT,
        email TEXT,
        notes TEXT,
        initial_payable_balance REAL DEFAULT 0, -- Specifically for suppliers
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking lenders table:", err.message);
        else console.log("✅ [db.js] Lenders (External Entities) table checked/created.");
    });

    // Business Agreements Table
    db.run(`
      CREATE TABLE IF NOT EXISTS business_agreements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lender_id INTEGER NOT NULL,
        agreement_type TEXT NOT NULL, -- 'loan_taken_by_biz', 'loan_given_by_biz', 'chit_participation'
        total_amount REAL NOT NULL,
        interest_rate REAL DEFAULT 0, -- For loans, annual percentage rate
        start_date TEXT NOT NULL,
        details TEXT, -- e.g., Chit Group ID, Loan Terms, Installment Amt
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE CASCADE
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking business_agreements table:", err.message);
        else console.log("✅ [db.js] business_agreements table checked/created.");
    });

    // Products Table
    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL UNIQUE,
        sku TEXT UNIQUE,
        description TEXT,
        cost_price REAL DEFAULT 0,
        sale_price REAL NOT NULL DEFAULT 0,
        current_stock INTEGER NOT NULL DEFAULT 0,
        unit_of_measure TEXT DEFAULT 'pcs',
        hsn_acs_code TEXT,
        low_stock_threshold INTEGER DEFAULT 0,
        reorder_level INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking products table:", err.message);
        else console.log("✅ [db.js] Products table checked/created.");
    });

    // Product Suppliers Linking Table
    db.run(`
      CREATE TABLE IF NOT EXISTS product_suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        supplier_id INTEGER NOT NULL, -- This will be an ID from the 'lenders' table where entity_type is 'Supplier'
        supplier_sku TEXT,
        purchase_price REAL,
        lead_time_days INTEGER,
        is_preferred BOOLEAN DEFAULT 0,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES lenders(id) ON DELETE CASCADE, -- Ensure supplier exists in lenders table
        UNIQUE (product_id, supplier_id)
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking product_suppliers table:", err.message);
        else console.log("✅ [db.js] product_suppliers table checked/created.");
    });


    // Transactions Table
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,            -- For customer-related transactions
        lender_id INTEGER,          -- For supplier or other external entity transactions
        agreement_id INTEGER,       -- For transactions related to a specific business agreement (loan, chit)
        amount REAL NOT NULL,
        description TEXT,
        category TEXT NOT NULL,     -- This will determine cash/bank flow for many types
        date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        related_invoice_id INTEGER, -- Link to an invoice if this transaction is a payment for/from it
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE SET NULL,
        FOREIGN KEY (agreement_id) REFERENCES business_agreements(id) ON DELETE SET NULL,
        FOREIGN KEY (related_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
      )
    `, (err) => {
      if (err) console.error("❌ [db.js] Error creating/checking transactions table:", err.message);
      else console.log("✅ [db.js] Transactions table checked/created.");
    });

    // Transaction Line Items Table (for product sales/purchases within a transaction)
    db.run(`
      CREATE TABLE IF NOT EXISTS transaction_line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_sale_price REAL NOT NULL, -- Could be purchase price if it's a purchase transaction
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT -- Prevent deleting product if used in tx
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking transaction_line_items table:", err.message);
        else console.log("✅ [db.js] transaction_line_items table checked/created.");
    });

    // Invoices Table
    db.run(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        invoice_number TEXT UNIQUE NOT NULL,
        invoice_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        total_amount REAL NOT NULL DEFAULT 0,
        amount_before_tax REAL DEFAULT 0,
        total_cgst_amount REAL DEFAULT 0,
        total_sgst_amount REAL DEFAULT 0,
        total_igst_amount REAL DEFAULT 0,
        party_bill_returns_amount REAL DEFAULT 0,
        paid_amount REAL NOT NULL DEFAULT 0, -- Cumulative amount paid on this invoice
        status TEXT NOT NULL DEFAULT 'Draft', -- e.g., Draft, Sent, Paid, Partially Paid, Overdue, Void
        invoice_type TEXT NOT NULL DEFAULT 'TAX_INVOICE', -- TAX_INVOICE, BILL_OF_SUPPLY, PARTY_BILL, NON_GST_RETAIL_BILL
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reverse_charge TEXT DEFAULT 'No',
        transportation_mode TEXT,
        vehicle_number TEXT,
        date_of_supply TEXT,
        place_of_supply_state TEXT,
        place_of_supply_state_code TEXT,
        bundles_count INTEGER,
        consignee_name TEXT,
        consignee_address_line1 TEXT,
        consignee_address_line2 TEXT,
        consignee_city_pincode TEXT,
        consignee_state TEXT,
        consignee_gstin TEXT,
        consignee_state_code TEXT,
        amount_in_words TEXT,
        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking invoices table:", err.message);
        else console.log("✅ [db.js] Invoices table checked/created.");
    });

    // Invoice Line Items Table
    db.run(`
      CREATE TABLE IF NOT EXISTS invoice_line_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        product_id INTEGER, -- Can be NULL for custom service items
        description TEXT NOT NULL,
        hsn_acs_code TEXT,
        unit_of_measure TEXT,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        discount_amount REAL DEFAULT 0,
        taxable_value REAL NOT NULL,
        cgst_rate REAL DEFAULT 0,
        cgst_amount REAL DEFAULT 0,
        sgst_rate REAL DEFAULT 0,
        sgst_amount REAL DEFAULT 0,
        igst_rate REAL DEFAULT 0,
        igst_amount REAL DEFAULT 0,
        line_total REAL NOT NULL, -- Taxable value + taxes for the line
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking invoice_line_items table:", err.message);
        else console.log("✅ [db.js] invoice_line_items table checked/created.");
    });

    // Audit Log Table
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id_acting INTEGER,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details_before TEXT,
        details_after TEXT,
        ip_address TEXT,
        FOREIGN KEY (user_id_acting) REFERENCES users(id) ON DELETE SET NULL
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking audit_log table:", err.message);
        else console.log("✅ [db.js] audit_log table checked/created.");
    });

    // Business Profile Table
    db.run(`
      CREATE TABLE IF NOT EXISTS business_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        address_line1 TEXT,
        address_line2 TEXT,
        city_pincode TEXT,
        state TEXT,
        gstin TEXT,
        state_code TEXT,
        phone TEXT,
        email TEXT,
        bank_name TEXT,
        bank_account_no TEXT,
        bank_ifsc_code TEXT,
        logo_url TEXT
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking business_profile table:", err.message);
        else {
            console.log("✅ [db.js] business_profile table checked/created.");
            // Check if default profile exists, insert if not
            db.get("SELECT COUNT(*) as count FROM business_profile", (errCount, rowCount) => {
              if (errCount) {
                console.error("❌ [db.js] Error checking business_profile count:", errCount.message);
              } else if (rowCount && rowCount.count === 0) {
                console.log("ℹ️ [db.js] No business profile found, inserting default one...");
                db.run(`INSERT INTO business_profile
                          (company_name, gstin, address_line1, city_pincode, state, state_code, phone, email, bank_name, bank_account_no, bank_ifsc_code)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    "ADVENTURER EXPORT", "33ABCFA3111D1ZF", "3/2B, Nesavalar Colony, 2 nd street,PN Road",
                    "TIRUPUR-641 602", "TAMILNADU", "33",
                    "9791902205,9842880404", "contact@adventurerexport.com",
                    "ICICI", "106105501618", "ICIC0001061"
                  ], (insertErr) => {
                    if (insertErr) {
                        console.error("❌ [db.js] Error inserting default business profile:", insertErr.message);
                    } else {
                        console.log("✅ [db.js] Default business profile inserted.");
                    }
                  }
                );
              } else if (rowCount) {
                console.log(`ℹ️ [db.js] business_profile count: ${rowCount.count}. Default insertion skipped.`);
              }
            });
        }
    });

    // --- Create a default admin user if one doesn't exist ---
    const saltRounds = 10;
    const defaultAdminPassword = 'admin';

    db.get("SELECT id FROM users WHERE username = 'admin'", [], (err, row) => {
        if (err) {
            console.error("❌ [db.js] Error checking for admin user:", err.message);
        } else if (!row) {
            console.log("ℹ️ [db.js] No admin user found, creating one...");
            bcrypt.hash(defaultAdminPassword, saltRounds, (hashErr, hashedPassword) => {
                if (hashErr) {
                    console.error("❌ [db.js] Error hashing default admin password:", hashErr);
                } else {
                    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, 
                        ['admin', hashedPassword, 'admin'], 
                        (insertErr) => {
                            if (insertErr) {
                                console.error("❌ [db.js] Error creating default admin user:", insertErr.message);
                            } else {
                                console.log("✅ [db.js] Default admin user created with username 'admin' and password 'admin'.");
                            }
                        }
                    );
                }
            });
        }
    });

    // Drop deprecated Sales Order tables if they exist
    db.run("DROP TABLE IF EXISTS sales_order_line_items", (err) => {
        if (err) console.error("❌ [db.js] Error dropping sales_order_line_items table (might not exist, which is OK):", err.message);
        else console.log("✅ [db.js] sales_order_line_items table dropped (if existed).");
    });
    db.run("DROP TABLE IF EXISTS sales_orders", (err) => {
        if (err) console.error("❌ [db.js] Error dropping sales_orders table (might not exist, which is OK):", err.message);
        else console.log("✅ [db.js] sales_orders table dropped (if existed).");
    });


    // Schema Migrations/Alterations (Simplified, checks if column exists before adding)
    const migrations = [
        { table: 'business_agreements', column: 'interest_rate', definition: 'REAL DEFAULT 0' },
        { table: 'users', column: 'password', definition: 'TEXT' } // Ensure password column is added
    ];

    migrations.forEach(mig => {
      // Special handling for potentially deprecated columns (just log, don't try to re-add if missing and not needed)
      if ((mig.table === 'invoices' && mig.column === 'related_transaction_id') || 
          (mig.table === 'products' && mig.column === 'supplier_id')) {
          db.all(`PRAGMA table_info(${mig.table})`, (err, columns) => {
              if (err) {
                  console.error(`❌ [db.js] Error getting table_info for ${mig.table}:`, err.message);
                  return;
              }
              const columnExists = columns.some(col => col.name === mig.column);
              if (columnExists) {
                  console.warn(`⚠️ [db.js] DEPRECATED Column '${mig.column}' exists in '${mig.table}'. It's no longer actively used or managed by newer logic.`);
              }
          });
      } else if (mig.table === 'transactions' && mig.column === 'payment_mode') {
           db.all(`PRAGMA table_info(transactions)`, (err, columns) => {
              if (err) { console.error(`❌ [db.js] Error getting table_info for transactions:`, err.message); return; }
              const columnExists = columns.some(col => col.name === 'payment_mode');
              if (columnExists) {
                  console.warn(`⚠️ [db.js] Column 'payment_mode' exists in 'transactions' but is NOT USED with the current 'Option A' (distinct categories) payment logic.`);
              }
          });
      } else { // Standard migration: add if not exists
          db.get(`SELECT name FROM pragma_table_info('${mig.table}') WHERE name = '${mig.column}'`, (err, row) => {
              if (err) {
                  console.error(`❌ [db.js] Error checking ${mig.table} for ${mig.column}:`, err.message);
              } else if (!row) {
                  console.log(`ℹ️ [db.js] '${mig.column}' column not found in '${mig.table}', attempting to add it...`);
                  db.run(`ALTER TABLE ${mig.table} ADD COLUMN ${mig.column} ${mig.definition}`, (alterErr) => {
                      if (alterErr) console.error(`❌ [db.js] Failed to add ${mig.column} to ${mig.table}:`, alterErr.message);
                      else console.log(`✅ [db.js] ${mig.column} column added to ${mig.table} table.`);
                  });
              }
          });
      }
    });


    db.get("SELECT name FROM pragma_table_info('products') WHERE name = 'cost_price'", (err, row) => {
        if (!err && !row) { // If cost_price does not exist
            db.get("SELECT name FROM pragma_table_info('products') WHERE name = 'purchase_price'", (errP, rowP) => {
                if (!errP && rowP) { // And purchase_price exists
                    console.log("ℹ️ [db.js] Attempting to rename 'products.purchase_price' to 'cost_price'.");
                    db.run("ALTER TABLE products RENAME COLUMN purchase_price TO cost_price", (renameErr) => {
                        if (renameErr) console.warn(`⚠️ [db.js] Could not rename products.purchase_price to cost_price. Manual check needed. Error: ${renameErr.message}. This might happen if 'cost_price' was added by a different migration path already.`);
                        else console.log("✅ [db.js] Renamed 'products.purchase_price' to 'cost_price'.");
                    });
                }
            });
        }
    });

    db.run("SELECT 1 AS db_init_complete", (err) => {
        if (err) {
            console.error("❌ [db.js] Error in final DB initialization step:", err.message);
        } else {
            dbInitialized = true;
            console.log("✅ [db.js] All database initialization tasks queued/completed.");
        }
    });
  });
}
module.exports = db;