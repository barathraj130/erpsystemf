// routes/productSupplierRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// --- NEW HELPER FUNCTION TO CREATE THE MISSING TRANSACTION ---
// This function will be called automatically when a preferred supplier is set.
async function createInitialStockTransaction(productId, supplierId, purchasePrice) {
    return new Promise((resolve, reject) => {
        db.get('SELECT current_stock FROM products WHERE id = ?', [productId], (err, product) => {
            if (err) return reject(new Error('Failed to find product for stock check.'));
            if (!product || product.current_stock <= 0) {
                // No stock, so no transaction needed.
                return resolve();
            }

            const stockValue = product.current_stock * purchasePrice;
            if (stockValue <= 0) {
                // No value, no transaction needed.
                return resolve();
            }

            // Check if an initial stock transaction already exists for this product to prevent duplicates
            const checkSql = `SELECT id FROM transactions WHERE category = 'Initial Stock Purchase (On Credit)' AND description LIKE ?`;
            const checkDesc = `Initial stock value for product ID ${productId}%`;

            db.get(checkSql, [checkDesc], (err, existingTx) => {
                if (err) return reject(new Error('Failed to check for existing initial stock transaction.'));
                
                if (existingTx) {
                    // Transaction already exists, do nothing.
                    console.log(`[AUTO-TX] Initial stock transaction for product ${productId} already exists. Skipping.`);
                    return resolve();
                }

                // No existing transaction, so create one.
                const insertSql = `INSERT INTO transactions (lender_id, amount, description, category, date) VALUES (?, ?, ?, ?, ?)`;
                const description = `Initial stock value for product ID ${productId} from supplier ID ${supplierId}`;
                const category = 'Initial Stock Purchase (On Credit)';
                const date = new Date().toISOString().split('T')[0]; // Use today's date

                db.run(insertSql, [supplierId, stockValue, description, category, date], function(err) {
                    if (err) return reject(new Error('Failed to create initial stock transaction.'));
                    console.log(`[AUTO-TX] Automatically created initial stock purchase transaction ID: ${this.lastID} for product ${productId}`);
                    resolve();
                });
            });
        });
    });
}


// Get all suppliers for a specific product
router.get('/product/:productId', (req, res) => {
    const { productId } = req.params;
    const sql = `
        SELECT 
            ps.id as product_supplier_id, 
            ps.product_id, 
            ps.supplier_id, 
            ps.supplier_sku, 
            ps.purchase_price, 
            ps.lead_time_days,
            ps.is_preferred,
            ps.notes,
            l.lender_name as supplier_name,
            l.entity_type as supplier_type
        FROM product_suppliers ps
        JOIN lenders l ON ps.supplier_id = l.id
        WHERE ps.product_id = ? AND l.entity_type = 'Supplier'
        ORDER BY ps.is_preferred DESC, l.lender_name ASC
    `;
    db.all(sql, [productId], (err, rows) => {
        if (err) {
            console.error("Error fetching suppliers for product:", err.message);
            return res.status(500).json({ error: "Failed to fetch suppliers for product." });
        }
        res.json(rows || []);
    });
});

// Get all products for a specific supplier
router.get('/supplier/:supplierId', (req, res) => {
    const { supplierId } = req.params;
    const sql = `
        SELECT 
            ps.id as product_supplier_id, 
            ps.product_id, 
            ps.supplier_id, 
            ps.supplier_sku, 
            ps.purchase_price, 
            ps.lead_time_days,
            ps.is_preferred,
            ps.notes,
            p.product_name,
            p.sku as product_sku,
            p.current_stock
        FROM product_suppliers ps
        JOIN products p ON ps.product_id = p.id
        WHERE ps.supplier_id = ?
        ORDER BY p.product_name ASC
    `;
    db.all(sql, [supplierId], (err, rows) => {
        if (err) {
            console.error("Error fetching products for supplier:", err.message);
            return res.status(500).json({ error: "Failed to fetch products for supplier." });
        }
        res.json(rows || []);
    });
});


// Link a supplier to a product (MODIFIED TO BE SMARTER)
router.post('/', (req, res) => {
    const { 
        product_id, supplier_id, supplier_sku, 
        purchase_price, lead_time_days, is_preferred, notes 
    } = req.body;

    if (!product_id || !supplier_id) {
        return res.status(400).json({ error: "Product ID and Supplier ID are required." });
    }
    const finalPurchasePrice = purchase_price ? parseFloat(purchase_price) : 0;
    if (isNaN(finalPurchasePrice)) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }

    const sql = `INSERT INTO product_suppliers 
                 (product_id, supplier_id, supplier_sku, purchase_price, lead_time_days, is_preferred, notes, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    db.run(sql, [
        product_id, supplier_id, supplier_sku || null, 
        finalPurchasePrice, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred ? 1 : 0,
        notes || null
    ], async function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed")) {
                return res.status(400).json({ error: "This product is already linked to this supplier." });
            }
            console.error("Error linking product to supplier:", err.message);
            return res.status(500).json({ error: "Failed to link product to supplier." });
        }

        // --- AUTOMATION LOGIC ---
        // If this new link is for a preferred supplier, create the initial stock transaction.
        if (is_preferred && finalPurchasePrice > 0) {
            try {
                await createInitialStockTransaction(product_id, supplier_id, finalPurchasePrice);
            } catch (autoTxErr) {
                console.error("Critical error in automated transaction creation:", autoTxErr.message);
                // The link was saved, but we should warn the user.
                return res.status(500).json({ error: "Link saved, but failed to create automated stock transaction. Please check logs."});
            }
        }
        
        res.status(201).json({ id: this.lastID, message: "Product linked to supplier successfully." });
    });
});

// Update a product-supplier link (MODIFIED TO BE SMARTER)
router.put('/:productSupplierId', (req, res) => {
    const { productSupplierId } = req.params;
    const { 
        supplier_sku, purchase_price, lead_time_days, is_preferred, notes 
    } = req.body;

    const finalPurchasePrice = purchase_price ? parseFloat(purchase_price) : 0;
    if (isNaN(finalPurchasePrice)) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }
    
    const sql = `UPDATE product_suppliers 
                 SET supplier_sku = ?, purchase_price = ?, lead_time_days = ?, is_preferred = ?, notes = ?, updated_at = datetime('now')
                 WHERE id = ?`;
    db.run(sql, [
        supplier_sku || null, 
        finalPurchasePrice, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred ? 1 : 0,
        notes || null,
        productSupplierId
    ], async function(err) {
        if (err) {
            console.error("Error updating product-supplier link:", err.message);
            return res.status(500).json({ error: "Failed to update product-supplier link." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product-supplier link not found." });
        }

        // --- AUTOMATION LOGIC ---
        // If the update resulted in this supplier becoming preferred, create the transaction.
        if (is_preferred && finalPurchasePrice > 0) {
            // We need the product_id and supplier_id for the helper function
            db.get('SELECT product_id, supplier_id FROM product_suppliers WHERE id = ?', [productSupplierId], async (e, link) => {
                if (e || !link) {
                    console.error('Could not find link details after update for auto-tx.');
                    return res.json({ message: "Product-supplier link updated successfully (auto-tx skipped)." });
                }
                try {
                    await createInitialStockTransaction(link.product_id, link.supplier_id, finalPurchasePrice);
                } catch (autoTxErr) {
                    console.error("Critical error in automated transaction creation:", autoTxErr.message);
                    return res.status(500).json({ error: "Link updated, but failed to create automated stock transaction. Please check logs."});
                }
                 res.json({ message: "Product-supplier link updated successfully." });
            });
        } else {
             res.json({ message: "Product-supplier link updated successfully." });
        }
    });
});

// Unlink a supplier from a product
router.delete('/:productSupplierId', (req, res) => {
    const { productSupplierId } = req.params;
    db.run('DELETE FROM product_suppliers WHERE id = ?', [productSupplierId], function(err) {
        if (err) {
            console.error("Error unlinking product from supplier:", err.message);
            return res.status(500).json({ error: "Failed to unlink product from supplier." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product-supplier link not found." });
        }
        res.json({ message: "Product unlinked from supplier successfully." });
    });
});

module.exports = router;