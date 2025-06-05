// routes/transactionRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// ========= START: router.post('/') =========
router.post('/', (req, res) => { // Route handler starts
  let { user_id, lender_id, agreement_id, amount, description, category, date, line_items, related_invoice_id } = req.body;

  let parsedUserId = null;
  if (user_id !== null && user_id !== undefined && user_id !== '') {
    parsedUserId = parseInt(user_id);
    if (isNaN(parsedUserId)) {
        return res.status(400).json({ error: 'User ID, if provided, must be a valid number.' });
    }
  }
  let parsedLenderId = null;
  if (lender_id !== null && lender_id !== undefined && lender_id !== '') {
    parsedLenderId = parseInt(lender_id);
    if (isNaN(parsedLenderId)) {
        return res.status(400).json({ error: 'Lender ID, if provided, must be a valid number.' });
    }
  }
  let parsedAgreementId = null;
  if (agreement_id !== null && agreement_id !== undefined && agreement_id !== '') {
    parsedAgreementId = parseInt(agreement_id);
    if (isNaN(parsedAgreementId)) {
        return res.status(400).json({ error: 'Agreement ID, if provided, must be a valid number.' });
    }
  }
  let parsedRelatedInvoiceId = null;
  if (related_invoice_id !== null && related_invoice_id !== undefined && related_invoice_id !== '') {
    parsedRelatedInvoiceId = parseInt(related_invoice_id);
    if (isNaN(parsedRelatedInvoiceId)) {
        return res.status(400).json({ error: 'Related Invoice ID, if provided, must be a valid number.' });
    }
  }

  if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
    // Allow 0 amount for certain neutral transactions if line items exist
    if (!((category.toLowerCase().includes('stock adjustment')) && Array.isArray(line_items) && line_items.length > 0)) {
        return res.status(400).json({ error: 'Amount is required and must be a number (or 0 for stock-only adjustments with items).' });
    }
  }
  // 'amount' here is the signed amount from the frontend logic (e.g., script.js handleTransactionSubmit)
  // which determines if it should be positive or negative based on category and context (user/lender).
  amount = parseFloat(amount); 

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date is required in YYYY-MM-DD format.' });
  }
  if (!category) {
    return res.status(400).json({ error: 'Category is required.' });
  }

  const isProductRelated = category.toLowerCase().includes('sale') || 
                           category.toLowerCase().includes('purchase') || 
                           category.toLowerCase().includes('product return') ||
                           category.toLowerCase().includes('stock adjustment');

  if (isProductRelated && (!Array.isArray(line_items) || line_items.length === 0)) {
      // Exception: Stock adjustments might not always need line items if it's a value adjustment not qty.
      // But typically, product related transactions SHOULD have line items.
      if (!category.toLowerCase().includes('stock adjustment (value')) { // Made up category for example
          console.warn(`Warning: Category '${category}' typically involves products but was created without line items. Stock will not be updated.`);
      }
  }


  db.serialize(() => { // Start of db.serialize
    db.run("BEGIN TRANSACTION;", (beginErr) => { // Start of db.run BEGIN
        if (beginErr) {
            console.error("❌ [API DB Error] Failed to start DB transaction for transaction post:", beginErr.message);
            return res.status(500).json({ error: "Failed to start DB transaction: " + beginErr.message });
        }

        const transactionSql = `INSERT INTO transactions (user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        const transactionParams = [parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId];

        db.run(transactionSql, transactionParams, function(txErr) { // Start of db.run INSERT transactions
            if (txErr) {
                console.error("❌ [API DB Error] Error inserting transaction record:", txErr.message, "Params:", transactionParams);
                db.run("ROLLBACK;");
                return res.status(500).json({ error: "Failed to create transaction record: " + txErr.message });
            }
            const transactionId = this.lastID;
            console.log("<<<<< DEBUG: Transaction header created. ID:", transactionId, "for category:", category, "Amount:", amount, ">>>>>");
            let itemPromises = [];

            if (Array.isArray(line_items) && line_items.length > 0) {
                 line_items.forEach(item => { // Start of forEach
                    if (!item.product_id || item.quantity === undefined || item.unit_price === undefined) { 
                        console.warn("<<<<< WARN: Skipping invalid line item in transaction processing:", item, ">>>>>");
                        return; 
                    }
                    // unit_sale_price here is just the value of the item in this transaction line, not necessarily a "sale"
                    const lineItemSql = `INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price)
                                         VALUES (?, ?, ?, ?)`;
                    itemPromises.push(new Promise((resolve, reject) => { // Start of new Promise for lineItem
                        db.run(lineItemSql, [transactionId, item.product_id, item.quantity, item.unit_price], function(liErr) { // Start of db.run for lineItem
                            if (liErr) {
                                console.error("<<<<< DB ERROR: Error inserting transaction_line_item:", liErr.message, "for item:", item, ">>>>>");
                                reject(liErr);
                            } else {
                                console.log("<<<<< DEBUG: transaction_line_item inserted. ID:", this.lastID, "for Tx ID:", transactionId, ">>>>>");
                                resolve();
                            }
                        }); // End of db.run for lineItem
                    })); // End of new Promise for lineItem

                    let stockChange = 0;
                    // Determine stock change based on category.
                    // item.quantity from frontend is always positive for line items.
                    const absQuantity = Math.abs(parseFloat(item.quantity));

                    if (category.toLowerCase().includes('sale to customer') && !category.toLowerCase().includes('return')) { 
                        stockChange = -absQuantity; // Sale decreases stock
                    } else if (category.toLowerCase().includes('purchase from supplier') && !category.toLowerCase().includes('return')) { 
                        stockChange = absQuantity; // Purchase increases stock
                    } else if (category.toLowerCase().includes('product return from customer')) { 
                        stockChange = absQuantity; // Customer return increases stock
                    } else if (category.toLowerCase().includes('product return to supplier')) { 
                        stockChange = -absQuantity; // Return to supplier decreases stock
                    } else if (category === "Stock Adjustment (Increase)") {
                        stockChange = absQuantity;
                    } else if (category === "Stock Adjustment (Decrease)") {
                        stockChange = -absQuantity;
                    }


                    if (stockChange !== 0 && item.product_id) { 
                        const stockUpdateSql = `UPDATE products SET current_stock = current_stock + ?, updated_at = datetime('now') WHERE id = ?`;
                        itemPromises.push(new Promise((resolve, reject) => { // Start of new Promise for stockUpdate
                            db.run(stockUpdateSql, [stockChange, item.product_id], function(stockErr) { // Start of db.run for stockUpdate
                                if (stockErr) {
                                     console.error("<<<<< DB ERROR: Error updating stock for product ID:", item.product_id, stockErr.message, ">>>>>");
                                    reject(stockErr);
                                } else if (this.changes === 0 && item.product_id) { 
                                    console.warn("<<<<< WARN: Product ID not found for stock update or stock unchanged:", item.product_id, ">>>>>");
                                    resolve(); 
                                } else {
                                    console.log("<<<<< DEBUG: Stock updated for product ID:", item.product_id, "Change:", stockChange, ">>>>>");
                                    resolve();
                                }
                            }); // End of db.run for stockUpdate
                        })); // End of new Promise for stockUpdate
                    }
                }); // End of line_items.forEach
            } // End of if (Array.isArray(line_items)...)

            Promise.all(itemPromises)
                .then(() => { // Start of Promise.all.then
                    db.run("COMMIT;", (commitErr) => { // Start of db.run COMMIT
                        if (commitErr) {
                             console.error("❌ [API DB Error] Error committing transaction:", commitErr.message);
                             db.run("ROLLBACK;");
                             return res.status(500).json({ error: "Failed to commit DB transaction: " + commitErr.message });
                        }
                        console.log(`✅ Transaction ${transactionId} and line items (if any) processed successfully.`);
                        db.get(`SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name 
                                FROM transactions t 
                                LEFT JOIN users u ON t.user_id = u.id 
                                LEFT JOIN lenders le ON t.lender_id = le.id 
                                WHERE t.id = ?`, [transactionId], (fetchErr, newTransaction) => { // Start of db.get
                            if (fetchErr) {
                                return res.status(201).json({ id: transactionId, message: 'Transaction and line items processed (failed to fetch full details).' });
                            }
                            res.status(201).json({ transaction: newTransaction, message: 'Transaction and line items processed.' });
                        }); // End of db.get
                    }); // End of db.run COMMIT
                }) // End of Promise.all.then
                .catch(itemProcessingError => { // Start of Promise.all.catch
                    console.error("❌ [API Logic/DB Error] Error processing line items or stock, rolling back:", itemProcessingError.message, itemProcessingError.stack);
                    db.run("ROLLBACK;", (rollbackErr) => { // Start of db.run ROLLBACK in catch
                        if(rollbackErr) console.error("❌ [API DB Error] Rollback failed after item processing error:", rollbackErr.message);
                    }); // End of db.run ROLLBACK in catch
                    return res.status(500).json({ error: "Failed to process transaction details: " + itemProcessingError.message });
                }); // End of Promise.all.catch
        }); // End of db.run INSERT transactions
    }); // End of db.run BEGIN
  }); // End of db.serialize
}); 
// ========= END: router.post('/') =========

// ========= START: router.get('/') =========
router.get('/', (req, res) => {
  db.all(
    `SELECT
        t.*,
        u.username AS customer_name, 
        le.lender_name AS external_entity_name,
        i.invoice_number AS related_invoice_number 
     FROM transactions t
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN lenders le ON t.lender_id = le.id
     LEFT JOIN invoices i ON t.related_invoice_id = i.id 
     ORDER BY t.date DESC, t.id DESC`,
    (err, rows) => {
      if (err) { console.error("❌ [API DB Error] Error fetching transactions:", err.message); return res.status(500).json({ error: err.message }); }
      res.json(rows || []);
    }
  );
});
// ========= END: router.get('/') =========

// ========= START: router.put('/:id') =========
router.put('/:id', (req, res) => {
  const { id } = req.params;
  let { user_id, lender_id, agreement_id, amount, description, category, date, related_invoice_id } = req.body;
  
  console.warn(`[API WARNING] PUT /api/transactions/${id}: Editing transactions with line items via this generic PUT endpoint is NOT fully supported for stock and line item integrity. Edit associated Invoices or re-create the transaction for complex changes.`);

  let parsedUserId = null;
  if (user_id !== null && user_id !== undefined && user_id !== '') {
    parsedUserId = parseInt(user_id);
    if (isNaN(parsedUserId)) return res.status(400).json({ error: 'User ID, if provided, must be a valid number.' });
  }
  let parsedLenderId = null;
  if (lender_id !== null && lender_id !== undefined && lender_id !== '') {
    parsedLenderId = parseInt(lender_id);
    if (isNaN(parsedLenderId)) return res.status(400).json({ error: 'Lender ID, if provided, must be a valid number.' });
  }
   let parsedAgreementId = null;
  if (agreement_id !== null && agreement_id !== undefined && agreement_id !== '') {
    parsedAgreementId = parseInt(agreement_id);
    if (isNaN(parsedAgreementId)) return res.status(400).json({ error: 'Agreement ID, if provided, must be a valid number.' });
  }
  let parsedRelatedInvoiceId = null;
  if (related_invoice_id !== null && related_invoice_id !== undefined && related_invoice_id !== '') {
    parsedRelatedInvoiceId = parseInt(related_invoice_id);
    if (isNaN(parsedRelatedInvoiceId)) return res.status(400).json({ error: 'Related Invoice ID, if provided, must be a valid number.' });
  }

  if (amount === undefined || amount === null || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Amount is required and must be a number.' });
  }
  // Amount is pre-signed from frontend
  amount = parseFloat(amount); 

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date is required in YYYY-MM-DD format.' });
  }
  if (!category) {
    return res.status(400).json({ error: 'Category is required.' });
  }

  // For generic transaction edits, we don't automatically adjust line items or stock here.
  // This is a simplification. Complex edits should ideally happen via the originating document (e.g., Invoice)
  // or require manual recreation of the transaction.

  const sql = `UPDATE transactions
               SET user_id = ?, lender_id = ?, agreement_id = ?, amount = ?, description = ?, category = ?, date = ?, related_invoice_id = ?
               WHERE id = ?`;
  const params = [parsedUserId, parsedLenderId, parsedAgreementId, amount, description, category, date, parsedRelatedInvoiceId, id];

  db.run(sql, params, function(err) {
    if (err) { 
        console.error("❌ [API DB Error] Error updating transaction:", err.message);
        if (err.message.includes("FOREIGN KEY constraint failed")) {
            return res.status(400).json({ error: 'Invalid related ID: A specified User, Entity, or Agreement does not exist.' });
        }
        return res.status(500).json({ error: "Failed to update transaction: " + err.message });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Transaction not found or no changes made' });
    
    db.get(`SELECT t.*, u.username AS customer_name, le.lender_name AS external_entity_name, i.invoice_number as related_invoice_number 
            FROM transactions t 
            LEFT JOIN users u ON t.user_id = u.id 
            LEFT JOIN lenders le ON t.lender_id = le.id 
            LEFT JOIN invoices i ON t.related_invoice_id = i.id
            WHERE t.id = ?`, [id], (fetchErr, updatedTransaction) => {
        if (fetchErr) {
            return res.json({ message: 'Transaction updated successfully (failed to fetch full details).' });
        }
        res.json({ transaction: updatedTransaction, message: 'Transaction updated successfully.' });
    });
  });
});
// ========= END: router.put('/:id') =========

// ========= START: router.delete('/:id') =========
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  
  db.serialize(() => { 
    db.run("BEGIN TRANSACTION;");

    // Step 1: Get original transaction category and its line items for stock reversal
    db.get('SELECT category FROM transactions WHERE id = ?', [id], (catErr, txRow) => {
        if (catErr) {
            db.run("ROLLBACK;");
            console.error("❌ [API DB Error] Error fetching transaction category for deletion:", catErr.message);
            return res.status(500).json({ error: "Failed to prepare for transaction deletion (fetch category)." });
        }
        if (!txRow) {
            db.run("ROLLBACK;");
            return res.status(404).json({ message: 'Transaction not found for category check.' });
        }
        const originalCategory = txRow.category;

        db.all('SELECT product_id, quantity FROM transaction_line_items WHERE transaction_id = ?', [id], (errTLI, lineItems) => {
            if (errTLI) {
                db.run("ROLLBACK;");
                console.error("❌ [API DB Error] Error fetching transaction line items for stock reversal:", errTLI.message);
                return res.status(500).json({ error: "Failed to prepare for transaction deletion (fetch TLI)." });
            }

            const stockReversalPromises = (lineItems || []).map(item => {
                return new Promise((resolve, reject) => {
                    let stockChangeToRevert = 0;
                    const absQuantity = Math.abs(parseFloat(item.quantity));

                    if (originalCategory.toLowerCase().includes('sale to customer') && !originalCategory.toLowerCase().includes('return')) { 
                        stockChangeToRevert = absQuantity; // Add back
                    } else if (originalCategory.toLowerCase().includes('purchase from supplier') && !originalCategory.toLowerCase().includes('return')) { 
                        stockChangeToRevert = -absQuantity; // Subtract back
                    } else if (originalCategory.toLowerCase().includes('product return from customer')) { 
                        stockChangeToRevert = -absQuantity; // It was added, so subtract
                    } else if (originalCategory.toLowerCase().includes('product return to supplier')) { 
                        stockChangeToRevert = absQuantity; // It was subtracted, so add back
                    } else if (originalCategory === "Stock Adjustment (Increase)") {
                        stockChangeToRevert = -absQuantity;
                    } else if (originalCategory === "Stock Adjustment (Decrease)") {
                        stockChangeToRevert = absQuantity;
                    }

                    if (stockChangeToRevert !== 0 && item.product_id) {
                        db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [stockChangeToRevert, item.product_id], (stockErr) => {
                            if (stockErr) {
                                console.error(`❌ [API DB Error] Error reverting stock for product ${item.product_id}:`, stockErr.message);
                                return reject(stockErr);
                            }
                            console.log(`✅ Stock for product ${item.product_id} reverted by ${stockChangeToRevert} due to transaction ${id} deletion.`);
                            resolve();
                        });
                    } else {
                        resolve(); // No stock change needed or product_id missing
                    }
                });
            });

            Promise.all(stockReversalPromises)
                .then(() => {
                    // Step 2: Delete transaction line items
                    db.run('DELETE FROM transaction_line_items WHERE transaction_id = ?', [id], (liErr) => {
                        if (liErr) { 
                            db.run("ROLLBACK;");
                            console.error("❌ [API DB Error] Error deleting transaction line items:", liErr.message);
                            return res.status(500).json({ error: "Failed to delete transaction details." });
                        }
                        // Step 3: Delete the main transaction
                        db.run('DELETE FROM transactions WHERE id = ?', [id], function(txErr) { 
                            if (txErr) { 
                                db.run("ROLLBACK;");
                                console.error("❌ [API DB Error] Error deleting transaction:", txErr.message);
                                return res.status(500).json({ error: "Failed to delete transaction." });
                            }
                            if (this.changes === 0) {
                                db.run("ROLLBACK;");
                                //This case should be caught by the txRow check earlier, but as a safeguard:
                                return res.status(404).json({ message: 'Transaction not found for final deletion.' });
                            }
                            // Step 4: Commit
                            db.run("COMMIT;", (commitErr) => { 
                                if (commitErr){
                                    console.error("❌ [API DB Error] Error committing delete transaction:", commitErr.message);
                                    db.run("ROLLBACK;"); 
                                    return res.status(500).json({ error: "Failed to commit delete operation." });
                                }
                                res.json({ message: 'Transaction, its line items, and stock adjustments (if applicable) processed successfully.' });
                            }); 
                        }); 
                    }); 
                })
                .catch(reversalError => {
                    db.run("ROLLBACK;");
                    console.error("❌ [API DB Error] Error during stock reversal for transaction deletion:", reversalError.message);
                    return res.status(500).json({ error: "Failed during stock reversal for transaction deletion." });
                });
        }); 
    });
  }); 
}); 
// ========= END: router.delete('/:id') =========

module.exports = router;