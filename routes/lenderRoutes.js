const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all external entities (can filter by type if needed in query: ?type=Supplier)
router.get('/', (req, res) => {
  let sql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders ORDER BY lender_name ASC';
  const params = [];

  if (req.query.type) {
    sql = 'SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE entity_type = ? ORDER BY lender_name ASC';
    params.push(req.query.type);
  }

  db.all(sql, params, async (err, rows) => {
    if (err) {
      console.error("Error fetching external entities:", err.message);
      return res.status(500).json({ error: err.message });
    }

    if (req.query.type === 'Supplier' && rows && rows.length > 0) {
      try {
        const suppliersWithPayable = await Promise.all(rows.map(async (supplier) => {
          return new Promise((resolve, reject) => {
            let currentPayable = parseFloat(supplier.initial_payable_balance || 0);

            // 1. Sum of actual financial transactions with this supplier
            // Amounts are signed:
            // - Purchase on Credit: + (increases payable)
            // - Payment Made: - (decreases payable)
            // - Product Return (Credit Note): - (decreases payable)
            // - Product Return (Cash/Bank Refund from supplier): + (this is income to us, effectively decreases payable)
            const financialTransactionsSql = `
              SELECT IFNULL(SUM(amount), 0) as transactions_sum
              FROM transactions
              WHERE lender_id = ?
                AND category IN (
                  'Purchase from Supplier (On Credit)', 
                  'Purchase from Supplier (Cash)',      -- Included if you consider cash purchases part of running payable until explicitly offset
                  'Purchase from Supplier (Bank)',      -- Same as above
                  'Payment Made to Supplier (Cash)',
                  'Payment Made to Supplier (Bank)',
                  'Product Return to Supplier (Credit Received)',
                  'Product Return to Supplier (Cash Refund)',
                  'Product Return to Supplier (Bank Refund)'
                )
            `;
            db.get(financialTransactionsSql, [supplier.id], (ftErr, ftRow) => {
              if (ftErr) {
                console.error(`Error fetching financial transaction sum for supplier ${supplier.id}:`, ftErr.message);
                // Continue calculation, financial transactions part will be 0 for this supplier
              } else {
                currentPayable += parseFloat(ftRow.transactions_sum || 0);
              }

              // 2. Sum of implicit payables from products where this supplier is preferred
              // This adds to the payable based on current stock of items for which this supplier is preferred.
              const implicitPayableSql = `
                SELECT SUM(p.current_stock * ps.purchase_price) as implicit_sum
                FROM products p
                JOIN product_suppliers ps ON p.id = ps.product_id
                WHERE ps.supplier_id = ? AND ps.is_preferred = 1 AND p.current_stock > 0 AND ps.purchase_price IS NOT NULL AND ps.purchase_price > 0;
              `;
              db.get(implicitPayableSql, [supplier.id], (ipErr, ipRow) => {
                if (ipErr) {
                  console.error(`Error fetching implicit payable sum for supplier ${supplier.id}:`, ipErr.message);
                  // Continue, implicit part will be 0
                } else {
                  currentPayable += parseFloat(ipRow.implicit_sum || 0);
                }
                
                // console.log(`Supplier ID: ${supplier.id}, Name: ${supplier.lender_name}, Initial: ${parseFloat(supplier.initial_payable_balance || 0).toFixed(2)}, FT Sum: ${parseFloat(ftRow?.transactions_sum || 0).toFixed(2)}, IP Sum: ${parseFloat(ipRow?.implicit_sum || 0).toFixed(2)}, Final Payable: ${currentPayable.toFixed(2)}`);
                resolve({ ...supplier, current_payable: currentPayable });
              });
            });
          });
        }));
        res.json(suppliersWithPayable);
      } catch (processingErr) {
        console.error("Error processing supplier payables:", processingErr.message);
        // Send back the original rows without calculated payables in case of a major error
        res.status(500).json({ error: "Failed to process supplier payables.", details: rows.map(r => ({...r, current_payable: r.initial_payable_balance})) });
      }
    } else {
      res.json(rows); // For non-supplier types or if no suppliers found
    }
  });
});

// Create a new external entity
router.post('/', (req, res) => {
  const { lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance } = req.body;
  if (!lender_name) {
    return res.status(400).json({ error: 'Entity name is required' });
  }
  const actualInitialPayable = (entity_type === 'Supplier') ? (parseFloat(initial_payable_balance) || 0) : 0;

  const sql = `INSERT INTO lenders (lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [lender_name, entity_type || 'General', contact_person, phone, email, notes, actualInitialPayable], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed: lenders.lender_name")) {
        return res.status(400).json({ error: "Entity name already exists." });
      }
      console.error("Error creating external entity:", err.message);
      return res.status(500).json({ error: err.message });
    }
    db.get('SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE id = ?', [this.lastID], (fetchErr, newEntity) => {
        if(fetchErr){
            console.error("Error fetching newly created entity:", fetchErr.message);
            return res.status(201).json({ id: this.lastID, message: 'External entity created successfully (failed to fetch details).' });
        }
        // For a new supplier, current_payable is initially its initial_payable_balance (implicit preferred stock value would be 0)
        const entityToSend = (newEntity && newEntity.entity_type === 'Supplier') 
            ? { ...newEntity, current_payable: parseFloat(newEntity.initial_payable_balance || 0) } 
            : newEntity;
        res.status(201).json({ entity: entityToSend, id: this.lastID, message: 'External entity created successfully' });
    });
  });
});

// Update an external entity
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance } = req.body;
  if (!lender_name) {
    return res.status(400).json({ error: 'Entity name is required' });
  }
  const actualInitialPayable = (entity_type === 'Supplier') ? (parseFloat(initial_payable_balance) || 0) : 0;

  const sql = `UPDATE lenders
               SET lender_name = ?, entity_type = ?, contact_person = ?, phone = ?, email = ?, notes = ?, initial_payable_balance = ?
               WHERE id = ?`;
  db.run(sql, [lender_name, entity_type || 'General', contact_person, phone, email, notes, actualInitialPayable, id], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed: lenders.lender_name")) {
        return res.status(400).json({ error: "Entity name already exists for another entity." });
      }
      console.error("Error updating external entity:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'External entity not found' });
    }
     db.get('SELECT id, lender_name, entity_type, contact_person, phone, email, notes, initial_payable_balance, created_at FROM lenders WHERE id = ?', [id], (fetchErr, updatedEntity) => {
        if(fetchErr){
             console.error("Error fetching updated entity:", fetchErr.message);
             return res.json({ message: 'External entity updated successfully (failed to fetch details).' });
        }
        // We don't calculate current_payable on PUT here, GET /?type=Supplier will do that when the list is re-requested.
        res.json({ entity: updatedEntity, message: 'External entity updated successfully' });
    });
  });
});

// Delete an external entity
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM lenders WHERE id = ?', [id], function (err) {
    if (err) {
      console.error("Error deleting external entity:", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'External entity not found' });
    }
    res.json({ message: 'External entity deleted successfully.' });
  });
});

module.exports = router;
