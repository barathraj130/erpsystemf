// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs'); // Import bcrypt for password hashing

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
  
  // --- A. CREATE ALL TABLES ---
  db.serialize(() => {
    console.log("ℹ️ [db.js] Phase 1: Ensuring all tables exist...");

    const createTableStatements = [
      `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT UNIQUE, state_code TEXT, phone TEXT, email TEXT UNIQUE, bank_name TEXT, bank_account_no TEXT, bank_ifsc_code TEXT, logo_url TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, username TEXT NOT NULL UNIQUE, email TEXT UNIQUE, password TEXT, role TEXT NOT NULL DEFAULT 'user', phone TEXT, company TEXT, initial_balance REAL NOT NULL DEFAULT 0, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT, state_code TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS lenders (id INTEGER PRIMARY KEY AUTOINCREMENT, lender_name TEXT NOT NULL UNIQUE, entity_type TEXT DEFAULT 'General', contact_person TEXT, phone TEXT, email TEXT, notes TEXT, initial_payable_balance REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS business_agreements (id INTEGER PRIMARY KEY AUTOINCREMENT, lender_id INTEGER NOT NULL, agreement_type TEXT NOT NULL, total_amount REAL NOT NULL, interest_rate REAL DEFAULT 0, start_date TEXT NOT NULL, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL UNIQUE, sku TEXT UNIQUE, description TEXT, cost_price REAL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, current_stock INTEGER NOT NULL DEFAULT 0, unit_of_measure TEXT DEFAULT 'pcs', hsn_acs_code TEXT, low_stock_threshold INTEGER DEFAULT 0, reorder_level INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS product_suppliers (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, supplier_sku TEXT, purchase_price REAL, lead_time_days INTEGER, is_preferred BOOLEAN DEFAULT 0, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE, FOREIGN KEY (supplier_id) REFERENCES lenders(id) ON DELETE CASCADE, UNIQUE (product_id, supplier_id))`,
      `CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lender_id INTEGER, agreement_id INTEGER, amount REAL NOT NULL, description TEXT, category TEXT NOT NULL, date TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, related_invoice_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (lender_id) REFERENCES lenders(id) ON DELETE SET NULL, FOREIGN KEY (agreement_id) REFERENCES business_agreements(id) ON DELETE SET NULL, FOREIGN KEY (related_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL)`,
      `CREATE TABLE IF NOT EXISTS transaction_line_items (id INTEGER PRIMARY KEY AUTOINCREMENT, transaction_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, unit_sale_price REAL NOT NULL, FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, invoice_number TEXT UNIQUE NOT NULL, invoice_date TEXT NOT NULL, due_date TEXT NOT NULL, total_amount REAL NOT NULL DEFAULT 0, amount_before_tax REAL DEFAULT 0, total_cgst_amount REAL DEFAULT 0, total_sgst_amount REAL DEFAULT 0, total_igst_amount REAL DEFAULT 0, party_bill_returns_amount REAL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Draft', invoice_type TEXT NOT NULL DEFAULT 'TAX_INVOICE', notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, reverse_charge TEXT DEFAULT 'No', transportation_mode TEXT, vehicle_number TEXT, date_of_supply TEXT, place_of_supply_state TEXT, place_of_supply_state_code TEXT, bundles_count INTEGER, consignee_name TEXT, consignee_address_line1 TEXT, consignee_address_line2 TEXT, consignee_city_pincode TEXT, consignee_state TEXT, consignee_gstin TEXT, consignee_state_code TEXT, amount_in_words TEXT, FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT)`,
      `CREATE TABLE IF NOT EXISTS invoice_line_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, product_id INTEGER, description TEXT NOT NULL, hsn_acs_code TEXT, unit_of_measure TEXT, quantity REAL NOT NULL, unit_price REAL NOT NULL, discount_amount REAL DEFAULT 0, taxable_value REAL NOT NULL, cgst_rate REAL DEFAULT 0, cgst_amount REAL DEFAULT 0, sgst_rate REAL DEFAULT 0, sgst_amount REAL DEFAULT 0, igst_rate REAL DEFAULT 0, igst_amount REAL DEFAULT 0, line_total REAL NOT NULL, FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE, FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL)`,
      `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, user_id_acting INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details_before TEXT, details_after TEXT, ip_address TEXT, FOREIGN KEY (user_id_acting) REFERENCES users(id) ON DELETE SET NULL)`,
      `CREATE TABLE IF NOT EXISTS business_profile (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, address_line1 TEXT, address_line2 TEXT, city_pincode TEXT, state TEXT, gstin TEXT, state_code TEXT, phone TEXT, email TEXT, bank_name TEXT, bank_account_no TEXT, bank_ifsc_code TEXT, logo_url TEXT)`
    ];
     // Notifications Table
    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, -- For user-specific notifications, NULL for global
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info', -- 'info', 'success', 'warning', 'danger'
        link TEXT, -- A URL or identifier to navigate to on click
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `, (err) => {
        if (err) console.error("❌ [db.js] Error creating/checking notifications table:", err.message);
        else console.log("✅ [db.js] notifications table checked/created.");
    });
    
    createTableStatements.forEach(stmt => db.run(stmt, (err) => {
        if (err) console.error("❌ [db.js] Error creating a table:", err.message);
    }));

    db.run("DROP TABLE IF EXISTS sales_orders", (err) => { if (err) console.error("❌ Error dropping sales_orders:", err.message); });
    db.run("DROP TABLE IF EXISTS sales_order_line_items", (err) => { if (err) console.error("❌ Error dropping sales_order_line_items:", err.message); });

    // This command acts as a synchronization point. Its callback will only run after all preceding commands in the queue have completed.
    db.run("SELECT 1", runMigrationsAndSeedData); 
  });
}

function runMigrationsAndSeedData() {
    console.log("ℹ️ [db.js] Phase 2: Running schema migrations...");

    const migrations = [
        { table: 'users', column: 'company_id', definition: 'INTEGER' },
        { table: 'users', column: 'password', definition: 'TEXT' },
        { table: 'business_agreements', column: 'interest_rate', definition: 'REAL DEFAULT 0' }
    ];

    let migrationsCompleted = 0;
    const totalMigrations = migrations.length;

    if (totalMigrations === 0) {
        console.log("ℹ️ [db.js] No migrations to run.");
        setupInitialData();
        return;
    }

    const onMigrationComplete = () => {
        migrationsCompleted++;
        if (migrationsCompleted === totalMigrations) {
            console.log("✅ [db.js] All migrations checked/completed.");
            // --- C. NOW IT IS SAFE TO SEED DATA ---
            setupInitialData();
        }
    };
    
    // --- B. RUN MIGRATIONS (ALTER TABLE, etc.) ---
    db.serialize(() => {
        migrations.forEach(mig => {
            db.get(`SELECT name FROM pragma_table_info('${mig.table}') WHERE name = '${mig.column}'`, (err, row) => {
                if (err) {
                    console.error(`❌ [db.js] Error checking ${mig.table} for ${mig.column}:`, err.message);
                    onMigrationComplete();
                } else if (!row) {
                    console.log(`ℹ️ [db.js] '${mig.column}' column not found in '${mig.table}', adding it...`);
                    db.run(`ALTER TABLE ${mig.table} ADD COLUMN ${mig.column} ${mig.definition}`, (alterErr) => {
                        if (alterErr) {
                             // Add NOT NULL constraint separately if needed, with a default value
                            if (mig.column === 'company_id') {
                                db.run(`UPDATE users SET company_id = 1 WHERE company_id IS NULL`, (updateErr) => {
                                    if(updateErr) console.error(`❌ [db.js] Failed to set default for new company_id column:`, updateErr.message);
                                    else console.log(`✅ [db.js] company_id column added and defaulted.`);
                                    onMigrationComplete();
                                });
                            } else {
                                console.error(`❌ [db.js] Failed to add ${mig.column} to ${mig.table}:`, alterErr.message);
                                onMigrationComplete();
                            }
                        } else {
                            console.log(`✅ [db.js] ${mig.column} column added to ${mig.table}.`);
                            onMigrationComplete();
                        }
                    });
                } else {
                    onMigrationComplete(); // Column already exists
                }
            });
        });
    });
}

function setupInitialData() {
    console.log("ℹ️ [db.js] Phase 3: Seeding initial data (Profile, Company, Admin)...");

    db.serialize(() => {
        db.get("SELECT COUNT(*) as count FROM business_profile", (err, row) => {
            if (!err && row && row.count === 0) {
                db.run(`INSERT INTO business_profile (company_name, gstin, address_line1, city_pincode, state, state_code, phone, email, bank_name, bank_account_no, bank_ifsc_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [ "ADVENTURER EXPORT", "33ABCFA3111D1ZF", "3/2B, Nesavalar Colony, 2 nd street,PN Road", "TIRUPUR-641 602", "TAMILNADU", "33", "9791902205,9842880404", "contact@adventurerexport.com", "ICICI", "106105501618", "ICIC0001061" ],
                (err) => { if (err) console.error("❌ Error inserting default business profile:", err.message); else console.log("✅ Default business profile inserted."); });
            }
        });
        
        db.get("SELECT id FROM companies WHERE id = 1", (err, companyRow) => {
            const createAdmin = (companyId) => {
                db.get("SELECT id, company_id FROM users WHERE username = 'admin'", (err, userRow) => {
                    if (err) return console.error("❌ Error checking admin user:", err.message);
                    if (!userRow) {
                        console.log("ℹ️ No admin user found, creating one for company ID:", companyId);
                        bcrypt.hash('admin', 10, (hashErr, hash) => {
                            if (hashErr) return console.error("❌ Error hashing default password:", hashErr);
                            db.run(`INSERT INTO users (company_id, username, password, role) VALUES (?, ?, ?, ?)`, [companyId, 'admin', hash, 'admin'], (err) => {
                                if (err) console.error("❌ Error creating default admin:", err.message);
                                else console.log("✅ Default admin user created.");
                            });
                        });
                    } else if (!userRow.company_id) {
                        console.warn("⚠️ Admin user exists without a company. Fixing...");
                        db.run(`UPDATE users SET company_id = ? WHERE id = ?`, [companyId, userRow.id], (err) => {
                            if (err) console.error("❌ Failed to fix admin user's company:", err.message);
                            else console.log(`✅ Admin user linked to company ID ${companyId}.`);
                        });
                    }
                });
            };

            if (!companyRow) {
                db.run(`INSERT INTO companies (id, company_name) VALUES (?, ?)`, [1, 'Default System Company'], function(err) {
                    if (err) console.error("❌ Error creating default company:", err.message);
                    else createAdmin(this.lastID);
                });
            } else {
                createAdmin(1);
            }
        });

        db.run("SELECT 1", () => {
            dbInitialized = true;
            console.log("✅ [db.js] Database initialization complete.");
        });
    });
}

module.exports = db;