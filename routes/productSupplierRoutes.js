// routes/productSupplierRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

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


// Link a supplier to a product
router.post('/', (req, res) => {
    const { 
        product_id, supplier_id, supplier_sku, 
        purchase_price, lead_time_days, is_preferred, notes 
    } = req.body;

    if (!product_id || !supplier_id) {
        return res.status(400).json({ error: "Product ID and Supplier ID are required." });
    }
    if (purchase_price !== undefined && (purchase_price === null || isNaN(parseFloat(purchase_price)))) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }

    const sql = `INSERT INTO product_suppliers 
                 (product_id, supplier_id, supplier_sku, purchase_price, lead_time_days, is_preferred, notes, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
    db.run(sql, [
        product_id, supplier_id, supplier_sku || null, 
        purchase_price ? parseFloat(purchase_price) : null, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred ? 1 : 0,
        notes || null
    ], function(err) {
        if (err) {
            if (err.message.includes("UNIQUE constraint failed")) {
                return res.status(400).json({ error: "This product is already linked to this supplier." });
            }
            console.error("Error linking product to supplier:", err.message);
            return res.status(500).json({ error: "Failed to link product to supplier." });
        }
        res.status(201).json({ id: this.lastID, message: "Product linked to supplier successfully." });
    });
});

// Update a product-supplier link
router.put('/:productSupplierId', (req, res) => {
    const { productSupplierId } = req.params;
    const { 
        supplier_sku, purchase_price, lead_time_days, is_preferred, notes 
    } = req.body;

    if (purchase_price !== undefined && (purchase_price === null || isNaN(parseFloat(purchase_price)))) {
        return res.status(400).json({ error: "Purchase price must be a valid number if provided." });
    }
    
    const sql = `UPDATE product_suppliers 
                 SET supplier_sku = ?, purchase_price = ?, lead_time_days = ?, is_preferred = ?, notes = ?, updated_at = datetime('now')
                 WHERE id = ?`;
    db.run(sql, [
        supplier_sku || null, 
        purchase_price ? parseFloat(purchase_price) : null, 
        lead_time_days ? parseInt(lead_time_days) : null,
        is_preferred ? 1 : 0,
        notes || null,
        productSupplierId
    ], function(err) {
        if (err) {
            console.error("Error updating product-supplier link:", err.message);
            return res.status(500).json({ error: "Failed to update product-supplier link." });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: "Product-supplier link not found." });
        }
        res.json({ message: "Product-supplier link updated successfully." });
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