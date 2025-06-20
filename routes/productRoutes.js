// routes/productRoutes.js
// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all products
router.get('/', (req, res) => {
    const sql = `
        SELECT 
            p.*,
            (SELECT l.lender_name 
             FROM product_suppliers ps_pref 
             JOIN lenders l ON ps_pref.supplier_id = l.id 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = 1 LIMIT 1) as preferred_supplier_name,
            (SELECT ps_pref.purchase_price 
             FROM product_suppliers ps_pref 
             WHERE ps_pref.product_id = p.id AND ps_pref.is_preferred = 1 LIMIT 1) as preferred_supplier_purchase_price
        FROM products p 
        ORDER BY p.id DESC  -- <<< THIS IS THE CHANGE: From product_name ASC to id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("Error fetching products:", err.message);
            return res.status(500).json({ error: "Failed to fetch products." });
        }
        res.json(rows || []);
    });
});

// ... rest of the file remains the same ...

module.exports = router;

// Get a single product by ID, including its linked suppliers
router.get('/:id', (req, res) => {
    const productId = req.params.id;
    let productData;

    db.get('SELECT * FROM products WHERE id = ?', [productId], (err, productRow) => {
        if (err) {
            console.error("Error fetching product:", err.message);
            return res.status(500).json({ error: "Failed to fetch product." });
        }
        if (!productRow) {
            return res.status(404).json({ error: "Product not found." });
        }
        productData = productRow;

        const suppliersSql = `
            SELECT 
                ps.id as product_supplier_id, 
                ps.supplier_id, 
                l.lender_name as supplier_name,
                ps.supplier_sku,
                ps.purchase_price,
                ps.lead_time_days,
                ps.is_preferred,
                ps.notes as supplier_specific_notes
            FROM product_suppliers ps
            JOIN lenders l ON ps.supplier_id = l.id
            WHERE ps.product_id = ? AND l.entity_type = 'Supplier'
            ORDER BY ps.is_preferred DESC, l.lender_name ASC
        `;
        db.all(suppliersSql, [productId], (supplierErr, supplierRows) => {
            if (supplierErr) {
                console.error("Error fetching suppliers for product:", supplierErr.message);
                // Still return product data, but indicate supplier fetch error
                productData.suppliers = [];
                productData.supplier_error = "Could not fetch supplier details.";
                return res.json(productData);
            }
            productData.suppliers = supplierRows || [];
            res.json(productData);
        });
    });
});

// Create a new product
router.post('/', (req, res) => {
    const { 
        product_name, sku, description, cost_price, // cost_price is now the general/average
        sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level 
    } = req.body;

    if (!product_name || sale_price === undefined || current_stock === undefined) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }
    if (isNaN(parseFloat(sale_price)) || isNaN(parseInt(current_stock))) {
        return res.status(400).json({ error: "Sale Price and Current Stock must be valid numbers." });
    }
    if (cost_price !== undefined && cost_price !== null && isNaN(parseFloat(cost_price))) {
        return res.status(400).json({ error: "Cost Price must be a valid number if provided."})
    }

    const sql = `INSERT INTO products (
                    product_name, sku, description, cost_price, sale_price, current_stock, 
                    unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level, updated_at, created_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
    db.run(sql, [
        product_name,
        sku || null,
        description || null,
        (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0,
        parseFloat(sale_price),
        parseInt(current_stock),
        unit_of_measure || 'pcs',
        low_stock_threshold ? parseInt(low_stock_threshold) : 0,
        hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0
    ], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed: products.product_name")) {
                return res.status(400).json({ error: "Product name already exists." });
            }
            if (sku && err.message.includes("UNIQUE constraint failed: products.sku")) {
                return res.status(400).json({ error: "SKU already exists." });
            }
            console.error("Error creating product:", err.message);
            return res.status(500).json({ error: "Failed to create product." });
        }
        // Fetch the newly created product to send back complete data
        db.get('SELECT * FROM products WHERE id = ?', [this.lastID], (fetchErr, newProduct) => {
            if (fetchErr) {
                return res.status(201).json({ id: this.lastID, product_name, message: "Product created successfully, but failed to fetch details."});
            }
            res.status(201).json({ product: newProduct, message: "Product created successfully." });
        });
    });
});

// Update a product
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { 
        product_name, sku, description, cost_price, sale_price, current_stock, 
        unit_of_measure, low_stock_threshold, hsn_acs_code, reorder_level
    } = req.body;

    if (!product_name || sale_price === undefined || current_stock === undefined) {
        return res.status(400).json({ error: "Product Name, Sale Price, and Current Stock are required." });
    }
    if (isNaN(parseFloat(sale_price)) || isNaN(parseInt(current_stock))) {
        return res.status(400).json({ error: "Sale Price and Current Stock must be valid numbers." });
    }
    if (cost_price !== undefined && cost_price !== null && isNaN(parseFloat(cost_price))) {
        return res.status(400).json({ error: "Cost Price must be a valid number if provided."})
    }

    const sql = `UPDATE products
                 SET product_name = ?, sku = ?, description = ?, cost_price = ?, sale_price = ?, 
                     current_stock = ?, unit_of_measure = ?, low_stock_threshold = ?, hsn_acs_code = ?, 
                     reorder_level = ?, updated_at = datetime('now')
                 WHERE id = ?`;
    db.run(sql, [
        product_name,
        sku || null,
        description || null,
        (cost_price !== undefined && cost_price !== null) ? parseFloat(cost_price) : 0,
        parseFloat(sale_price),
        parseInt(current_stock),
        unit_of_measure || 'pcs',
        low_stock_threshold ? parseInt(low_stock_threshold) : 0,
        hsn_acs_code || null,
        reorder_level ? parseInt(reorder_level) : 0,
        id
    ], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed: products.product_name")) {
                return res.status(400).json({ error: "Product name already exists for another product." });
            }
            if (sku && err.message.includes("UNIQUE constraint failed: products.sku")) {
                return res.status(400).json({ error: "SKU already exists for another product." });
            }
            console.error("Error updating product:", err.message);
            return res.status(500).json({ error: "Failed to update product." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product not found." });
        }
        // Fetch the updated product to send back complete data including any default values or triggers
        db.get('SELECT * FROM products WHERE id = ?', [id], (fetchErr, updatedProduct) => {
             if (fetchErr) {
                return res.json({ message: "Product updated successfully, but failed to fetch details."});
            }
            res.json({ product: updatedProduct, message: "Product updated successfully." });
        });
    });
});

// Delete a product
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    // Check usage in transaction_line_items
    db.get('SELECT COUNT(*) as count FROM transaction_line_items WHERE product_id = ?', [id], (err, row) => {
        if (err) {
            console.error("Error checking product usage in transactions:", err.message);
            return res.status(500).json({ error: "Failed to check product usage in transactions." });
        }
        if (row && row.count > 0) {
            return res.status(400).json({ error: "Cannot delete product. It is used in existing financial transactions. Consider deactivating it instead." });
        }

        // Check usage in invoice_line_items
        db.get('SELECT COUNT(*) as count FROM invoice_line_items WHERE product_id = ?', [id], (errInv, rowInv) => {
            if (errInv) {
                console.error("Error checking product usage in invoices:", errInv.message);
                return res.status(500).json({ error: "Failed to check product usage in invoices." });
            }
            if (rowInv && rowInv.count > 0) {
                return res.status(400).json({ error: "Cannot delete product. It is used in existing invoices. Consider deactivating it or removing it from invoices first." });
            }
            
            // If not used in transactions or invoices, proceed to delete from product_suppliers and then products
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.run('DELETE FROM product_suppliers WHERE product_id = ?', [id], (psErr) => {
                    if (psErr) {
                        db.run("ROLLBACK");
                        console.error("Error deleting product-supplier links:", psErr.message);
                        return res.status(500).json({ error: "Failed to delete product-supplier links." });
                    }
                    db.run('DELETE FROM products WHERE id = ?', [id], function(prodErr) {
                        if (prodErr) {
                            db.run("ROLLBACK");
                            console.error("Error deleting product:", prodErr.message);
                            return res.status(500).json({ error: "Failed to delete product." });
                        }
                        if (this.changes === 0) {
                            db.run("ROLLBACK");
                            return res.status(404).json({ error: "Product not found for deletion." });
                        }
                        db.run("COMMIT");
                        res.json({ message: "Product and its supplier links deleted successfully." });
                    });
                });
            });
        });
    });
});

module.exports = router;