// routes/invoiceRoutes.js
console.log("<<<<< DEBUG: routes/invoiceRoutes.js is being loaded >>>>>");

const express = require('express');
const router = express.Router();
const db = require('../db');

// --- Helper function to create transactions and update stock ---
async function createAssociatedTransactionsAndStockUpdate(invoiceId, invoiceData, processedLineItems, res, isNewInvoice = true) {
    console.log(`<<<<< DEBUG TXN HELPER INVOKED: invoiceId=${invoiceId}, isNewInvoice=${isNewInvoice} >>>>>`);
    console.log(`<<<<< DEBUG TXN HELPER: Full invoiceData received:`, JSON.stringify(invoiceData, null, 2), ">>>>>");

    return new Promise((resolve, reject) => {
        const { customer_id, invoice_number, total_amount, paid_amount, invoice_type, invoice_date, party_bill_returns_amount, newPaymentMethod } = invoiceData;
        const transactionPromises = [];

        // `paid_amount` here is the `payment_being_made_now` from the route handler for this specific operation.
        const currentPaymentMade = parseFloat(paid_amount) || 0; 
        console.log(`<<<<< DEBUG TXN HELPER: currentPaymentMade (from paid_amount param): ${currentPaymentMade}, newPaymentMethod: ${newPaymentMethod} >>>>>`);

        let saleCategoryName;
        const saleTransactionAmount = parseFloat(total_amount); 

        // Determine Sale Transaction Category (Only if it's a new invoice AND there's a sale amount)
        if (isNewInvoice && saleTransactionAmount !== 0) {
            saleCategoryName = "Sale to Customer (On Credit)"; // Default

            if (currentPaymentMade >= saleTransactionAmount && newPaymentMethod) { // Full payment with method
                if (newPaymentMethod.toLowerCase() === 'cash') {
                    saleCategoryName = "Sale to Customer (Cash)";
                } else if (newPaymentMethod.toLowerCase() === 'bank') {
                    saleCategoryName = "Sale to Customer (Bank)";
                } else {
                    console.warn(`<<<<< WARN TXN HELPER (New Invoice Sale Cat): Full payment but newPaymentMethod ('${newPaymentMethod}') is not 'cash' or 'bank'. Sale remains 'On Credit'. >>>>>`);
                }
            } else if (currentPaymentMade > 0 && currentPaymentMade < saleTransactionAmount && newPaymentMethod) { // Partial payment with method
                 console.log(`<<<<< INFO TXN HELPER (New Invoice Sale Cat): Partial payment. Sale remains 'On Credit'. Separate payment tx will be created. >>>>>`);
            } else if (currentPaymentMade >= saleTransactionAmount && !newPaymentMethod && currentPaymentMade > 0) {
                 console.warn(`<<<<< WARN TXN HELPER (New Invoice Sale Cat): Full payment but newPaymentMethod was NOT provided. Sale remains 'On Credit'. >>>>>`);
            }
            
            console.log(`<<<<< DEBUG TXN HELPER (New Invoice Sale Cat): Determined Sale Category: ${saleCategoryName} for total: ${saleTransactionAmount}, payment_now: ${currentPaymentMade} >>>>>`);

            const saleTransactionSql = `INSERT INTO transactions (user_id, amount, description, category, date, related_invoice_id)
                                        VALUES (?, ?, ?, ?, ?, ?)`;
            // The amount for the "Sale" transaction is always the full invoice total (positive for the business)
            const saleTxActualAmount = saleTransactionAmount;
            const saleTransactionParams = [
                customer_id, 
                saleTxActualAmount, 
                `Invoice ${invoice_number} (${invoice_type.replace(/_/g, ' ')}) Sale`,
                saleCategoryName, 
                invoice_date, 
                invoiceId
            ];

            transactionPromises.push(new Promise((saleResolve, saleReject) => {
                db.run(saleTransactionSql, saleTransactionParams, function (saleErr) {
                    if (saleErr) {
                        console.error("<<<<< DB ERROR TXN HELPER: Error creating sale transaction for invoice:", saleErr.message, "Params:", saleTransactionParams, ">>>>>");
                        return saleReject(saleErr);
                    }
                    const saleTransactionId = this.lastID;
                    console.log("<<<<< DEBUG TXN HELPER: Sale transaction CREATED. Tx ID:", saleTransactionId, "Amount:",saleTxActualAmount, "Category:", saleCategoryName, ">>>>>");

                    let stockAndLineItemPromises = [];
                    if (processedLineItems && processedLineItems.length > 0) {
                        processedLineItems.forEach(item => {
                            if (!item.product_id || item.quantity === undefined || item.unit_price === undefined) {
                                console.warn("<<<<< WARN TXN HELPER: Skipping invalid line item for sale tx:", item, ">>>>>");
                                return;
                            }
                            const txLineItemSql = `INSERT INTO transaction_line_items (transaction_id, product_id, quantity, unit_sale_price)
                                                 VALUES (?, ?, ?, ?)`;
                            stockAndLineItemPromises.push(new Promise((txLiResolve, txLiReject) => {
                                db.run(txLineItemSql, [saleTransactionId, item.product_id, item.quantity, item.unit_price], function (txLiErr) {
                                    if (txLiErr) {
                                         console.error("<<<<< DB ERROR TXN HELPER: Error inserting transaction_line_item for sale tx:", txLiErr.message, ">>>>>");
                                         return txLiReject(txLiErr);
                                    }
                                    txLiResolve();
                                });
                            }));

                            const stockChange = -Math.abs(parseFloat(item.quantity)); 
                            if (stockChange !== 0 && item.product_id) {
                                const stockUpdateSql = `UPDATE products SET current_stock = current_stock + ?, updated_at = datetime('now') WHERE id = ?`;
                                stockAndLineItemPromises.push(new Promise((stockResolve, stockReject) => {
                                    db.run(stockUpdateSql, [stockChange, item.product_id], function (stockErr) {
                                        if (stockErr) {
                                            console.error("<<<<< DB ERROR TXN HELPER: Error updating stock for product ID:", item.product_id, stockErr.message, ">>>>>");
                                            return stockReject(stockErr);
                                        }
                                        if (this.changes === 0 && item.product_id) {
                                            console.warn("<<<<< WARN TXN HELPER: Product ID not found for stock update or stock unchanged:", item.product_id, ">>>>>");
                                        }
                                        console.log("<<<<< DEBUG TXN HELPER: Stock updated for product ID:", item.product_id, "Change:", stockChange, ">>>>>");
                                        stockResolve();
                                    });
                                }));
                            }
                        });
                    }
                    Promise.all(stockAndLineItemPromises).then(saleResolve).catch(saleReject);
                });
            }));
        } else if (!isNewInvoice) { // Existing invoice update
            console.log(`<<<<< DEBUG TXN HELPER: Existing invoice update (isNewInvoice=false). SKIPPING sale transaction recreation and associated stock updates within this helper. Original sale tx/stock should remain unless explicitly reverted by the calling PUT route. >>>>>`);
        } else if (isNewInvoice && saleTransactionAmount === 0) {
            console.log(`<<<<< DEBUG TXN HELPER: New invoice with ZERO total amount. SKIPPING sale transaction. Only payment transaction will be considered if payment_being_made_now > 0. >>>>>`);
        }


        // PAYMENT TRANSACTION - This applies to both NEW and UPDATED invoices if a payment is made.
        console.log(`<<<<< DEBUG TXN HELPER (Payment Tx Check): currentPaymentMade=${currentPaymentMade} >>>>>`);
        if (currentPaymentMade > 0) {
            console.log(`<<<<< DEBUG TXN HELPER (Payment Tx Check): Proceeding to create payment transaction. newPaymentMethod=${newPaymentMethod} >>>>>`);
            let paymentCategoryName;
            if (newPaymentMethod && newPaymentMethod.toLowerCase() === 'cash') {
                paymentCategoryName = "Payment Received from Customer (Cash)";
            } else if (newPaymentMethod && newPaymentMethod.toLowerCase() === 'bank') {
                paymentCategoryName = "Payment Received from Customer (Bank)";
            } else {
                console.error(`<<<<< ERROR TXN HELPER (Payment Tx): Payment amount ${currentPaymentMade} > 0 but NO VALID newPaymentMethod provided ('${newPaymentMethod}'). Cannot create payment transaction. >>>>>`);
                // This reject() will be caught by the route handler's try...catch
                return reject(new Error(`Payment method ('cash' or 'bank') is required when payment_being_made_now (${currentPaymentMade}) is greater than 0. Method received: '${newPaymentMethod}'.`));
            }
            
            // Payment received DECREASES customer's balance (liability for customer, asset/income for business)
            // So, the transaction amount from the business perspective is NEGATIVE for the customer's account.
            const paymentTransactionActualAmount = -Math.abs(currentPaymentMade); 
            
            const paymentTransactionSql = `INSERT INTO transactions (user_id, amount, description, category, date, related_invoice_id)
                                           VALUES (?, ?, ?, ?, ?, ?)`;
            const paymentTransactionParams = [
                customer_id, 
                paymentTransactionActualAmount, 
                `Payment for Invoice ${invoice_number}`,
                paymentCategoryName, 
                invoice_date, 
                invoiceId
            ];
            transactionPromises.push(new Promise((paymentResolve, paymentReject) => {
                db.run(paymentTransactionSql, paymentTransactionParams, function (paymentErr) {
                    if (paymentErr) {
                        console.error("<<<<< DB ERROR TXN HELPER: Error creating payment transaction for invoice:", paymentErr.message, "Params:", paymentTransactionParams, ">>>>>");
                        return paymentReject(paymentErr);
                    }
                    console.log("<<<<< DEBUG TXN HELPER: Payment transaction CREATED. Tx ID:", this.lastID, "Amount:", paymentTransactionActualAmount, "Category:", paymentCategoryName, ">>>>>");
                    paymentResolve();
                });
            }));
        } else {
            console.log(`<<<<< DEBUG TXN HELPER (Payment Tx Check): No payment being made now (currentPaymentMade=${currentPaymentMade}), SKIPPING payment transaction creation. >>>>>`);
        }

        Promise.all(transactionPromises)
            .then(() => {
                console.log("<<<<< DEBUG TXN HELPER: All transactionPromises resolved for invoice ID:", invoiceId, ">>>>>");
                resolve();
            })
            .catch(err => {
                console.error("<<<<< ERROR TXN HELPER: One or more transactionPromises rejected for invoice ID:", invoiceId, err.message, "Details:", err.details, ">>>>>");
                reject(err); // Propagate the error
            });
    });
}


router.get('/', (req, res) => {
    // console.log("<<<<< DEBUG: GET /api/invoices route hit >>>>>"); // Reduced logging for frequent calls
    const sql = `
        SELECT i.*, u.username as customer_name
        FROM invoices i
        LEFT JOIN users u ON i.customer_id = u.id 
        ORDER BY i.invoice_date DESC, i.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error("<<<<< ERROR: GET /api/invoices - Error fetching invoices:", err.message, ">>>>>");
            return res.status(500).json({ error: "Failed to fetch invoices." });
        }
        res.json(rows || []);
    });
});

router.get('/:id', (req, res) => {
    const { id } = req.params;
    console.log(`<<<<< DEBUG: GET /api/invoices/${id} route hit >>>>>`);
    
    const invoiceSql = `
        SELECT 
            i.*, 
            c.username as customer_name, 
            c.email as customer_email, 
            c.phone as customer_phone, 
            c.company as customer_company,
            c.address_line1 as customer_address_line1,
            c.address_line2 as customer_address_line2,
            c.city_pincode as customer_city_pincode,
            c.state as customer_state,
            c.gstin as customer_gstin,
            c.state_code as customer_state_code,
            bp.company_name as business_company_name,
            bp.address_line1 as business_address_line1,
            bp.address_line2 as business_address_line2,
            bp.city_pincode as business_city_pincode,
            bp.state as business_state,
            bp.gstin as business_gstin,
            bp.state_code as business_state_code,
            bp.phone as business_phone,
            bp.email as business_email,
            bp.bank_name as business_bank_name,
            bp.bank_account_no as business_bank_account_no,
            bp.bank_ifsc_code as business_bank_ifsc_code,
            bp.logo_url as business_logo_url
        FROM invoices i
        LEFT JOIN users c ON i.customer_id = c.id
        CROSS JOIN business_profile bp  
        WHERE i.id = ?
    `;
    db.get(invoiceSql, [id], (err, invoice) => {
        if (err) { 
            console.error(`<<<<< ERROR: GET /api/invoices/${id} - Failed to fetch invoice header:`, err.message, ">>>>>");
            return res.status(500).json({ error: "Failed to fetch invoice.", details: err.message }); 
        }
        if (!invoice) { 
             console.warn(`<<<<< WARN: GET /api/invoices/${id} - Invoice not found by db.get. SQL: ${invoiceSql.replace(/\s\s+/g, ' ')} Params: [${id}] >>>>>`);
            return res.status(404).json({ error: "Invoice not found." }); 
        }
        
        const itemsSql = `
            SELECT 
                ili.*, 
                p.product_name, 
                p.sku as product_sku,
                COALESCE(ili.hsn_acs_code, p.hsn_acs_code) as final_hsn_acs_code, 
                COALESCE(ili.unit_of_measure, p.unit_of_measure) as final_unit_of_measure
            FROM invoice_line_items ili
            LEFT JOIN products p ON ili.product_id = p.id
            WHERE ili.invoice_id = ?
        `;
        db.all(itemsSql, [id], (itemErr, items) => {
            if (itemErr) { 
                console.error(`<<<<< ERROR: GET /api/invoices/${id} - Failed to fetch line items:`, itemErr.message, ">>>>>");
                return res.status(500).json({ error: "Failed to fetch line items.", details: itemErr.message }); 
            }
            invoice.line_items = items.map(item => ({
                ...item,
                cgst_rate: item.cgst_rate || 0,
                cgst_amount: item.cgst_amount || 0,
                sgst_rate: item.sgst_rate || 0,
                sgst_amount: item.sgst_amount || 0,
                igst_rate: item.igst_rate || 0,
                igst_amount: item.igst_amount || 0,
            })) || [];
            res.json(invoice);
        });
    });
});


router.post('/', async (req, res) => {
    console.log("<<<<< DEBUG: POST /api/invoices - RAW Request Body:", JSON.stringify(req.body, null, 2) , ">>>>>");
    const {
        invoice_number, customer_id, invoice_date, due_date, status, notes,
        invoice_type, line_items,
        cgst_rate = 0, sgst_rate = 0, igst_rate = 0, 
        party_bill_returns_amount = 0,
        reverse_charge, transportation_mode, vehicle_number, date_of_supply,
        place_of_supply_state, place_of_supply_state_code, bundles_count,
        consignee_name, consignee_address_line1, consignee_address_line2,
        consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
        amount_in_words, 
        payment_being_made_now, 
        payment_method_for_new_payment 
    } = req.body;
    const initialPaymentAmount = parseFloat(payment_being_made_now) || 0;

    console.log(`<<<<< DEBUG: POST /api/invoices - Parsed payment_being_made_now: ${initialPaymentAmount}, payment_method_for_new_payment: ${payment_method_for_new_payment} >>>>>`);


    if (!invoice_number || !customer_id || !invoice_date || !due_date || !invoice_type) {
        return res.status(400).json({ error: "Invoice Number, Customer, Invoice Date, Due Date, and Invoice Type are required." });
    }
    if (!['TAX_INVOICE', 'BILL_OF_SUPPLY', 'PARTY_BILL', 'NON_GST_RETAIL_BILL'].includes(invoice_type)) {
        return res.status(400).json({ error: "Invalid invoice type specified." });
    }
    if (!Array.isArray(line_items) || line_items.length === 0) {
        return res.status(400).json({ error: "At least one line item is required." });
    }
    if (initialPaymentAmount > 0 && (!payment_method_for_new_payment || !['cash', 'bank'].includes(payment_method_for_new_payment.toLowerCase()) )) {
        console.error(`<<<<< VALIDATION ERROR: POST /api/invoices - Payment > 0 (${initialPaymentAmount}) but method ('${payment_method_for_new_payment}') invalid/missing >>>>>`);
        return res.status(400).json({ error: "Valid payment method (cash/bank) is required when payment_being_made_now is greater than 0."});
    }
    const parsedPartyBillReturnsAmount = parseFloat(party_bill_returns_amount) || 0;


    let amount_before_tax = 0;
    const processed_line_items = [];

    for (const item of line_items) {
        const quantity = parseFloat(item.quantity);
        const unit_price = parseFloat(item.unit_price);
        const discount_amount = parseFloat(item.discount_amount || 0);

        if (isNaN(quantity) || quantity <= 0 || isNaN(unit_price) || unit_price < 0 || isNaN(discount_amount) || discount_amount < 0) {
            return res.status(400).json({ error: `Invalid data (qty, price, or discount) in line item: ${item.description || 'Unknown Item'}` });
        }
        const item_total_before_discount = quantity * unit_price;
        const item_taxable_value = item_total_before_discount - discount_amount;

        if (item_taxable_value < 0) {
            return res.status(400).json({ error: `Discount cannot be greater than item total for: ${item.description || 'Unknown Item'}` });
        }
        amount_before_tax += item_taxable_value;
        
        let item_cgst_amount = 0, item_sgst_amount = 0, item_igst_amount = 0;
        let item_cgst_rate = 0, item_sgst_rate = 0, item_igst_rate = 0;

        if (invoice_type === 'TAX_INVOICE') {
            item_cgst_rate = parseFloat(cgst_rate || 0); 
            item_sgst_rate = parseFloat(sgst_rate || 0);
            item_igst_rate = parseFloat(igst_rate || 0);

            if (item_igst_rate > 0) {
                item_igst_amount = item_taxable_value * (item_igst_rate / 100);
                item_cgst_amount = 0; item_sgst_amount = 0; 
                item_cgst_rate = 0; item_sgst_rate = 0; 
            } else {
                item_cgst_amount = item_taxable_value * (item_cgst_rate / 100);
                item_sgst_amount = item_taxable_value * (item_sgst_rate / 100);
                item_igst_amount = 0; 
                item_igst_rate = 0; 
            }
        }
        const item_line_total = item_taxable_value + item_cgst_amount + item_sgst_amount + item_igst_amount;

        processed_line_items.push({ 
            product_id: item.product_id, 
            description: item.description, 
            hsn_acs_code: item.hsn_acs_code, 
            unit_of_measure: item.unit_of_measure, 
            quantity: quantity, 
            unit_price: unit_price, 
            discount_amount: discount_amount, 
            taxable_value: item_taxable_value, 
            cgst_rate: item_cgst_rate, cgst_amount: item_cgst_amount,
            sgst_rate: item_sgst_rate, sgst_amount: item_sgst_amount,
            igst_rate: item_igst_rate, igst_amount: item_igst_amount,
            line_total: item_line_total
        });
    }

    let total_cgst_amount_calc = 0;
    let total_sgst_amount_calc = 0;
    let total_igst_amount_calc = 0;

    if (invoice_type === 'TAX_INVOICE') {
        total_cgst_amount_calc = processed_line_items.reduce((sum, item) => sum + (item.cgst_amount || 0), 0);
        total_sgst_amount_calc = processed_line_items.reduce((sum, item) => sum + (item.sgst_amount || 0), 0);
        total_igst_amount_calc = processed_line_items.reduce((sum, item) => sum + (item.igst_amount || 0), 0);
    }
    
    let final_total_amount = amount_before_tax + total_cgst_amount_calc + total_sgst_amount_calc + total_igst_amount_calc;

    if (invoice_type === 'PARTY_BILL') {
        final_total_amount -= parsedPartyBillReturnsAmount;
    }


    db.serialize(() => {
        db.run("BEGIN TRANSACTION;", async (beginErr) => { 
            if (beginErr) {
                return res.status(500).json({ error: "Database transaction could not be started.", details: beginErr.message });
            }
            
            try {
                const invoiceSql = `INSERT INTO invoices (
                                    customer_id, invoice_number, invoice_date, due_date,
                                    total_amount, amount_before_tax, 
                                    total_cgst_amount, total_sgst_amount, total_igst_amount,
                                    party_bill_returns_amount,
                                    status, invoice_type, notes, updated_at, paid_amount,
                                    reverse_charge, transportation_mode, vehicle_number, date_of_supply,
                                    place_of_supply_state, place_of_supply_state_code, bundles_count,
                                    consignee_name, consignee_address_line1, consignee_address_line2,
                                    consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
                                    amount_in_words
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                const invoiceHeaderParams = [
                    customer_id, invoice_number, invoice_date, due_date,
                    final_total_amount, amount_before_tax,
                    total_cgst_amount_calc, total_sgst_amount_calc, total_igst_amount_calc,
                    parsedPartyBillReturnsAmount,
                    status || 'Draft', invoice_type, notes, initialPaymentAmount, 
                    reverse_charge, transportation_mode, vehicle_number, date_of_supply,
                    place_of_supply_state, place_of_supply_state_code, bundles_count,
                    consignee_name, consignee_address_line1, consignee_address_line2,
                    consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
                    amount_in_words
                ];

                const invoiceId = await new Promise((resolve, reject) => {
                    db.run(invoiceSql, invoiceHeaderParams, function(err) {
                        if (err) {
                            if (err.message && err.message.toLowerCase().includes("unique constraint failed: invoices.invoice_number")) {
                                return reject({ status: 400, error: "Invoice number already exists.", details: err.message });
                            }
                            console.error("<<<<< DB ERROR: POST /api/invoices - Error inserting invoice header:", err.message, "Params:", invoiceHeaderParams, ">>>>>");
                            return reject({ status: 500, error: "Failed to create invoice header.", details: err.message });
                        }
                        resolve(this.lastID);
                    });
                });

                const itemPromises = processed_line_items.map(item => {
                     return new Promise((resolve, reject) => {
                        const itemSql = `INSERT INTO invoice_line_items
                                         (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, 
                                          quantity, unit_price, discount_amount, taxable_value,
                                          cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                        const itemParams = [
                            invoiceId, item.product_id || null,item.description || "N/A", 
                            item.hsn_acs_code || null, item.unit_of_measure || null,
                            item.quantity, item.unit_price, item.discount_amount || 0, item.taxable_value,
                            item.cgst_rate || 0, item.cgst_amount || 0, item.sgst_rate || 0, item.sgst_amount || 0, 
                            item.igst_rate || 0, item.igst_amount || 0, item.line_total];
                        db.run(itemSql, itemParams, function(itemErr) { 
                            if (itemErr) {
                                console.error("<<<<< DB ERROR: POST /api/invoices - Error inserting line item:", itemErr.message, "Params:", itemParams, ">>>>>");
                                reject(itemErr);
                            } else resolve(); 
                        });
                    });
                });
                await Promise.all(itemPromises);
                
                const invoiceFullDataForTxHelper = { 
                    customer_id, 
                    invoice_number, 
                    total_amount: final_total_amount, 
                    paid_amount: initialPaymentAmount, 
                    invoice_type, 
                    invoice_date,
                    party_bill_returns_amount: (invoice_type === 'PARTY_BILL' ? parsedPartyBillReturnsAmount : 0),
                    newPaymentMethod: payment_method_for_new_payment 
                };
                console.log("<<<<< DEBUG: POST /api/invoices - Calling TXN HELPER with: ", JSON.stringify(invoiceFullDataForTxHelper, null, 2), ">>>>>");
                await createAssociatedTransactionsAndStockUpdate(invoiceId, invoiceFullDataForTxHelper, processed_line_items, res, true);

                db.run("COMMIT;", (commitErr) => {
                    if (commitErr) {
                        db.run("ROLLBACK;"); 
                        return res.status(500).json({ error: "Failed to commit invoice.", details: commitErr.message });
                    }
                    res.status(201).json({ id: invoiceId, invoice_number, message: "Invoice created successfully." });
                });

            } catch (error) {
                db.run("ROLLBACK;");
                const error_status = error.status || 500;
                console.error(`<<<<< ERROR: POST /api/invoices - Catch block error:`, error.message, "Details:", error.details || "N/A", error.stack, ">>>>>");
                res.status(error_status).json({ error: error.error || "Failed to process invoice.", details: error.details || error.message });
            }
        });
    });
});

router.put('/:id', async (req, res) => {
    const { id } = req.params; 
    const invoiceId = parseInt(id);

    console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - RAW Request Body:`, JSON.stringify(req.body, null, 2) , ">>>>>");

    const {
        invoice_number, customer_id, invoice_date, due_date, status: statusFromRequest, notes,
        invoice_type, line_items,
        cgst_rate = 0, sgst_rate = 0, igst_rate = 0,
        party_bill_returns_amount = 0,
        payment_being_made_now, 
        payment_method_for_new_payment, 
        reverse_charge, transportation_mode, vehicle_number, date_of_supply,
        place_of_supply_state, place_of_supply_state_code, bundles_count,
        consignee_name, consignee_address_line1, consignee_address_line2,
        consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
        amount_in_words
    } = req.body;
    
    const newPaymentAmount = parseFloat(payment_being_made_now) || 0;
    console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - Parsed newPaymentAmount: ${newPaymentAmount}, payment_method_for_new_payment: ${payment_method_for_new_payment} >>>>>`);


    if (!invoice_number || !customer_id || !invoice_date || !due_date || !invoice_type) {
        return res.status(400).json({ error: "Invoice Number, Customer, Invoice Date, Due Date, and Invoice Type are required for update." });
    }
    if (!['TAX_INVOICE', 'BILL_OF_SUPPLY', 'PARTY_BILL', 'NON_GST_RETAIL_BILL'].includes(invoice_type)) {
        return res.status(400).json({ error: "Invalid invoice type specified for update." });
    }
    if (!Array.isArray(line_items) || line_items.length === 0) {
        return res.status(400).json({ error: "At least one line item is required for update." });
    }
    if (newPaymentAmount > 0 && (!payment_method_for_new_payment || !['cash', 'bank'].includes(payment_method_for_new_payment.toLowerCase()) )) {
        console.error(`<<<<< VALIDATION ERROR: PUT /api/invoices - Payment > 0 (${newPaymentAmount}) but method ('${payment_method_for_new_payment}') invalid/missing >>>>>`);
        return res.status(400).json({ error: "Valid payment method (cash/bank) is required when payment_being_made_now is greater than 0 for update."});
    }
    const parsedPartyBillReturnsAmount = parseFloat(party_bill_returns_amount) || 0;

    let amount_before_tax = 0;
    const processed_line_items = [];
    for (const item of line_items) {
        // ... (line item processing as before)
        const quantity = parseFloat(item.quantity);
        const unit_price = parseFloat(item.unit_price);
        const discount_amount = parseFloat(item.discount_amount || 0);
        if (isNaN(quantity) || quantity <= 0 || isNaN(unit_price) || unit_price < 0 || isNaN(discount_amount) || discount_amount < 0) {
            return res.status(400).json({ error: `Invalid data in line item for update: ${item.description || 'Unknown Item'}` });
        }
        const item_total_before_discount = quantity * unit_price;
        const item_taxable_value = item_total_before_discount - discount_amount;
        if (item_taxable_value < 0) {
            return res.status(400).json({ error: `Discount cannot be greater than item total for update: ${item.description || 'Unknown Item'}` });
        }
        amount_before_tax += item_taxable_value;
        
        let item_cgst_amount = 0, item_sgst_amount = 0, item_igst_amount = 0;
        let item_cgst_rate = 0, item_sgst_rate = 0, item_igst_rate = 0;

        if (invoice_type === 'TAX_INVOICE') {
            item_cgst_rate = parseFloat(cgst_rate || 0);
            item_sgst_rate = parseFloat(sgst_rate || 0);
            item_igst_rate = parseFloat(igst_rate || 0);
            if (item_igst_rate > 0) {
                item_igst_amount = item_taxable_value * (item_igst_rate / 100);
                 item_cgst_rate = 0; item_sgst_rate = 0;
                 item_cgst_amount = 0; item_sgst_amount = 0;
            } else {
                item_cgst_amount = item_taxable_value * (item_cgst_rate / 100);
                item_sgst_amount = item_taxable_value * (item_sgst_rate / 100);
                 item_igst_rate = 0; item_igst_amount = 0;
            }
        }
        const item_line_total = item_taxable_value + item_cgst_amount + item_sgst_amount + item_igst_amount;
        processed_line_items.push({ 
            product_id: item.product_id, description: item.description, hsn_acs_code: item.hsn_acs_code, 
            unit_of_measure: item.unit_of_measure, quantity: quantity, unit_price: unit_price, 
            discount_amount: discount_amount, taxable_value: item_taxable_value, 
            cgst_rate: item_cgst_rate, cgst_amount: item_cgst_amount, sgst_rate: item_sgst_rate, 
            sgst_amount: item_sgst_amount, igst_rate: item_igst_rate, igst_amount: item_igst_amount, 
            line_total: item_line_total
        });
    }

    let total_cgst_amount_final_calc = 0;
    let total_sgst_amount_final_calc = 0;
    let total_igst_amount_final_calc = 0;

    if (invoice_type === 'TAX_INVOICE') {
        total_cgst_amount_final_calc = processed_line_items.reduce((sum, item) => sum + (item.cgst_amount || 0), 0);
        total_sgst_amount_final_calc = processed_line_items.reduce((sum, item) => sum + (item.sgst_amount || 0), 0);
        total_igst_amount_final_calc = processed_line_items.reduce((sum, item) => sum + (item.igst_amount || 0), 0);
    }
    
    let final_total_amount = amount_before_tax + total_cgst_amount_final_calc + total_sgst_amount_final_calc + total_igst_amount_final_calc;
    if (invoice_type === 'PARTY_BILL') {
        final_total_amount -= parsedPartyBillReturnsAmount;
    }
    console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - Calculated final_total_amount: ${final_total_amount} >>>>>`);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;", async (beginErr) => {
            if (beginErr) { return res.status(500).json({ error: "Database transaction could not be started.", details: beginErr.message }); }

            try {
                const existingInvoice = await new Promise((resolveFetch, rejectFetch) => {
                    db.get("SELECT paid_amount FROM invoices WHERE id = ?", [invoiceId], (errFetch, rowFetch) => {
                        if (errFetch) return rejectFetch(new Error(`DB Error fetching existing paid amount: ${errFetch.message}`));
                        if (!rowFetch) return rejectFetch({ status: 404, error: "Original invoice not found to get existing paid amount."});
                        resolveFetch(rowFetch);
                    });
                });
                const existingPaidAmount = parseFloat(existingInvoice.paid_amount) || 0;
                console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - Fetched existingPaidAmount from DB: ${existingPaidAmount} >>>>>`);
                
                const cumulativePaidAmount = existingPaidAmount + newPaymentAmount;
                console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - Calculated cumulativePaidAmount (to save): ${cumulativePaidAmount} >>>>>`);

                let newStatus = statusFromRequest;
                if (statusFromRequest !== 'Void') { 
                    if (cumulativePaidAmount >= final_total_amount && final_total_amount > 0) {
                        newStatus = 'Paid';
                    } else if (cumulativePaidAmount > 0 && cumulativePaidAmount < final_total_amount) {
                        newStatus = 'Partially Paid';
                    } else if (final_total_amount <= 0 && cumulativePaidAmount >= final_total_amount) { 
                        newStatus = 'Paid'; 
                    } else if (cumulativePaidAmount <= 0 && final_total_amount > 0 && due_date < new Date().toISOString().split('T')[0]) {
                         if (statusFromRequest !== 'Paid' && statusFromRequest !== 'Partially Paid') { 
                            newStatus = 'Overdue';
                         }
                    }
                }
                console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - Determined newStatus: ${newStatus} (from request: ${statusFromRequest}) >>>>>`);


                 await new Promise((resolve, reject) => { 
                    db.all("SELECT id, category FROM transactions WHERE related_invoice_id = ?", [invoiceId], (err, transactions) => {
                        if (err) { console.error("<<<<< DB ERROR PUT: Failed to fetch old txns:", err.message); return reject(err); }
                        if (transactions && transactions.length > 0) {
                            const txIds = transactions.map(t => t.id);
                            db.all("SELECT tli.product_id, tli.quantity, t.category as transaction_category FROM transaction_line_items tli JOIN transactions t ON tli.transaction_id = t.id WHERE tli.transaction_id IN (" + txIds.map(()=>'?').join(',') + ")", txIds, (errTLI, oldTxLineItems) => {
                                if(errTLI) { console.error("<<<<< DB ERROR PUT: Failed to fetch old tx line items:", errTLI.message); return reject(errTLI); }
                                const stockReversalPromises = (oldTxLineItems || []).map(tli => {
                                   return new Promise((resStock, rejStock) => {
                                       let stockChangeToRevert = 0;
                                       const absQuantity = Math.abs(parseFloat(tli.quantity));
                                       // Revert stock only for the original sale transaction(s)
                                       if (tli.transaction_category && tli.transaction_category.toLowerCase().includes('sale to customer') && !tli.transaction_category.toLowerCase().includes('return')) {
                                            stockChangeToRevert = absQuantity; 
                                       }
                                       
                                       if (stockChangeToRevert !== 0 && tli.product_id) {
                                           db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [stockChangeToRevert, tli.product_id], (errStock) => {
                                               if(errStock) { console.error("<<<<< DB ERROR PUT: Failed to revert stock:", errStock.message); return rejStock(errStock); }
                                               console.log(`<<<<< DEBUG PUT Revert: Stock reverted for product ${tli.product_id} by ${stockChangeToRevert} for invoice update ${invoiceId} >>>>>`);
                                               resStock();
                                           });
                                       } else {
                                           resStock();
                                       }
                                   });
                                });
                                Promise.all(stockReversalPromises)
                                .then(() => {
                                    db.run("DELETE FROM transaction_line_items WHERE transaction_id IN (" + txIds.map(()=>'?').join(',') + ")", txIds, (errDelTLI) => {
                                        if (errDelTLI) { console.error("<<<<< DB ERROR PUT: Failed to delete old tx line items:", errDelTLI.message); return reject(errDelTLI); }
                                        db.run("DELETE FROM transactions WHERE related_invoice_id = ?", [invoiceId], (errDelTX) => {
                                            if (errDelTX) { console.error("<<<<< DB ERROR PUT: Failed to delete old txns:", errDelTX.message); return reject(errDelTX); }
                                            console.log(`<<<<< DEBUG PUT: Old transactions and line items DELETED for invoice ${invoiceId} >>>>>`);
                                            resolve();
                                        });
                                    });
                                }).catch(reversalErr => {
                                    console.error("<<<<< ERROR PUT: Stock reversal failed:", reversalErr.message);
                                    reject(reversalErr);
                                });
                            });
                        } else { console.log(`<<<<< DEBUG PUT: No old transactions found to delete for invoice ${invoiceId} >>>>>`); resolve(); }
                    });
                });
                await new Promise((resolve, reject) => { 
                    db.run("DELETE FROM invoice_line_items WHERE invoice_id = ?", [invoiceId], (deleteErr) => {
                        if (deleteErr) { console.error("<<<<< DB ERROR PUT: Failed to delete old invoice line items:", deleteErr.message); return reject(deleteErr); }
                        console.log(`<<<<< DEBUG PUT: Old invoice line items DELETED for invoice ${invoiceId} >>>>>`);
                        resolve();
                    });
                });

                const updateInvoiceSql = `UPDATE invoices SET
                                        invoice_number = ?, customer_id = ?, invoice_date = ?, due_date = ?,
                                        total_amount = ?, amount_before_tax = ?,
                                        total_cgst_amount = ?, total_sgst_amount = ?, total_igst_amount = ?,
                                        party_bill_returns_amount = ?,
                                        status = ?, invoice_type = ?, notes = ?,
                                        paid_amount = ?, updated_at = datetime('now'),
                                        reverse_charge = ?, transportation_mode = ?, vehicle_number = ?, date_of_supply = ?,
                                        place_of_supply_state = ?, place_of_supply_state_code = ?, bundles_count = ?,
                                        consignee_name = ?, consignee_address_line1 = ?, consignee_address_line2 = ?,
                                        consignee_city_pincode = ?, consignee_state = ?, consignee_gstin = ?, consignee_state_code = ?,
                                        amount_in_words = ?
                                      WHERE id = ?`;
                await new Promise((resolveUpdate, rejectUpdate) => {
                     console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - About to run UPDATE SQL. CumulativePaidAmount: ${cumulativePaidAmount}, NewStatus: ${newStatus} >>>>>`);
                    db.run(updateInvoiceSql, [
                        invoice_number, customer_id, invoice_date, due_date,
                        final_total_amount, amount_before_tax,
                        total_cgst_amount_final_calc, total_sgst_amount_final_calc, total_igst_amount_final_calc,
                        parsedPartyBillReturnsAmount,
                        newStatus, invoice_type, notes,
                        cumulativePaidAmount, 
                        reverse_charge, transportation_mode, vehicle_number, date_of_supply,
                        place_of_supply_state, place_of_supply_state_code, bundles_count,
                        consignee_name, consignee_address_line1, consignee_address_line2,
                        consignee_city_pincode, consignee_state, consignee_gstin, consignee_state_code,
                        amount_in_words, invoiceId
                    ], function(updateErr) {
                        if (updateErr) { console.error("<<<<< DB ERROR PUT: Failed to update invoice header:", updateErr.message); return rejectUpdate(updateErr); }
                        if (this.changes === 0) return rejectUpdate({ status: 404, error: "Invoice not found for update or no changes made."});
                        console.log(`<<<<< DEBUG PUT: Invoice header UPDATED for invoice ${invoiceId} >>>>>`);
                        resolveUpdate();
                    });
                });
                
                const checkUpdatedInvoice = await new Promise((resCheck, rejCheck) => { 
                    db.get("SELECT paid_amount, status FROM invoices WHERE id = ?", [invoiceId], (err, row) => {
                        if (err) rejCheck(err); else resCheck(row);
                    });
                });
                if (checkUpdatedInvoice) {
                    console.log(`<<<<< DEBUG PUT /api/invoices/${invoiceId} - DB state AFTER invoice header update query: Paid Amount = ${checkUpdatedInvoice.paid_amount}, Status = ${checkUpdatedInvoice.status} >>>>>`);
                } else {
                    console.warn(`<<<<< WARN PUT /api/invoices/${invoiceId} - Could not re-fetch invoice immediately after header update query. >>>>>`);
                }

                const itemPromises = processed_line_items.map(item => {
                     return new Promise((resolveItem, rejectItem) => {
                        const itemSql = `INSERT INTO invoice_line_items
                                         (invoice_id, product_id, description, hsn_acs_code, unit_of_measure, 
                                          quantity, unit_price, discount_amount, taxable_value,
                                          cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, line_total)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                        const itemParams = [ 
                            invoiceId, item.product_id || null, item.description || "N/A", 
                            item.hsn_acs_code || null, item.unit_of_measure || null,
                            item.quantity, item.unit_price, item.discount_amount || 0, 
                            item.taxable_value, item.cgst_rate || 0, item.cgst_amount || 0, 
                            item.sgst_rate || 0, item.sgst_amount || 0, item.igst_rate || 0, 
                            item.igst_amount || 0, item.line_total];
                        db.run(itemSql, itemParams, function(itemErr) { 
                            if (itemErr) { console.error("<<<<< DB ERROR PUT: Failed to insert new invoice line item:", itemErr.message); rejectItem(itemErr); }
                            else resolveItem(); 
                        });
                    });
                });
                await Promise.all(itemPromises);
                console.log(`<<<<< DEBUG PUT: New invoice line items INSERTED for invoice ${invoiceId} >>>>>`);


                const invoiceFullDataForTxHelper = { 
                    customer_id, 
                    invoice_number, 
                    total_amount: final_total_amount, 
                    paid_amount: newPaymentAmount, 
                    invoice_type, 
                    invoice_date,
                    party_bill_returns_amount: (invoice_type === 'PARTY_BILL' ? parsedPartyBillReturnsAmount : 0),
                    newPaymentMethod: payment_method_for_new_payment
                };
                console.log("<<<<< DEBUG: PUT /api/invoices - Calling TXN HELPER with (isNewInvoice=true to recreate sale tx): ", JSON.stringify(invoiceFullDataForTxHelper, null, 2), ">>>>>");
                await createAssociatedTransactionsAndStockUpdate(invoiceId, invoiceFullDataForTxHelper, processed_line_items, res, true);


                db.run("COMMIT;", (commitErr) => {
                    if (commitErr) {
                        db.run("ROLLBACK;");
                        console.error("<<<<< DB ERROR PUT: Failed to commit invoice update:", commitErr.message);
                        return res.status(500).json({ error: "Failed to commit invoice update.", details: commitErr.message });
                    }
                    res.json({ message: "Invoice updated successfully." });
                });

            } catch (error) {
                db.run("ROLLBACK;");
                const errStatus = error.status || 500;
                console.error(`<<<<< ERROR: PUT /api/invoices/${id} - Catch block error:`, error.message, "Details:", error.details, error.stack, ">>>>>");
                res.status(errStatus).json({ error: error.error || "Failed to update invoice.", details: error.details || error.message });
            }
        });
    });
});


router.delete('/:id', (req, res) => {
    const { id } = req.params;
    console.log(`<<<<< DEBUG: DELETE /api/invoices/${id} route hit >>>>>`);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION;");
        db.all("SELECT id, category FROM transactions WHERE related_invoice_id = ?", [id], (err, transactions) => {
            if (err) {
                db.run("ROLLBACK;");
                console.error(`<<<<< DB ERROR: DELETE /api/invoices/${id} - Error fetching related transactions:`, err.message, ">>>>>");
                return res.status(500).json({ error: "Failed to prepare invoice deletion.", details: err.message });
            }

            const stockReversalPromises = [];
            if (transactions && transactions.length > 0) {
                const txIds = transactions.map(t => t.id);
                
                db.all("SELECT tli.product_id, tli.quantity, t.category as transaction_category FROM transaction_line_items tli JOIN transactions t ON tli.transaction_id = t.id WHERE tli.transaction_id IN (" + txIds.map(()=>'?').join(',') + ")", txIds, (errTLI, oldTxLineItems) => {
                    if(errTLI) {
                        db.run("ROLLBACK;");
                        console.error(`<<<<< DB ERROR: DELETE /api/invoices/${id} - Error fetching transaction line items for stock reversal:`, errTLI.message, ">>>>>");
                        return res.status(500).json({ error: "Failed to prepare stock reversal.", details: errTLI.message });
                    }

                    (oldTxLineItems || []).forEach(tli => {
                        stockReversalPromises.push(new Promise((resStock, rejStock) => {
                            let stockChangeToRevert = 0;
                            const absQuantity = Math.abs(parseFloat(tli.quantity));
                            if (tli.transaction_category && 
                                (tli.transaction_category.toLowerCase().includes('sale to customer') || tli.transaction_category.toLowerCase().includes('stock adjustment (decrease)')) &&
                                !tli.transaction_category.toLowerCase().includes('return')
                            ) {
                                stockChangeToRevert = absQuantity; 
                            } else if (tli.transaction_category &&
                                (tli.transaction_category.toLowerCase().includes('purchase from supplier') || tli.transaction_category.toLowerCase().includes('stock adjustment (increase)')) &&
                                !tli.transaction_category.toLowerCase().includes('return')
                            ) {
                                stockChangeToRevert = -absQuantity; 
                            }


                            if (stockChangeToRevert !== 0 && tli.product_id) {
                                db.run("UPDATE products SET current_stock = current_stock + ? WHERE id = ?", [stockChangeToRevert, tli.product_id], (errStock) => {
                                    if(errStock) return rejStock(errStock);
                                    console.log(`<<<<< DEBUG DELETE: Stock reverted for product ${tli.product_id} by ${stockChangeToRevert} for invoice ${id} >>>>>`);
                                    resStock();
                                });
                            } else {
                                resStock();
                            }
                        }));
                    });

                    Promise.all(stockReversalPromises)
                    .then(() => {
                        db.run("DELETE FROM transaction_line_items WHERE transaction_id IN (" + txIds.map(()=>'?').join(',') + ")", txIds, (errDelTLI) => {
                            if (errDelTLI) { db.run("ROLLBACK;"); return res.status(500).json({ error: "Failed to delete transaction line items.", details: errDelTLI.message }); }
                            
                            db.run("DELETE FROM transactions WHERE related_invoice_id = ?", [id], (errDelTX) => {
                                if (errDelTX) { db.run("ROLLBACK;"); return res.status(500).json({ error: "Failed to delete related financial transactions.", details: errDelTX.message }); }
                                
                                deleteActualInvoice(id, res, db);
                            });
                        });
                    })
                    .catch(stockErr => {
                        db.run("ROLLBACK;");
                        console.error(`<<<<< DB ERROR: DELETE /api/invoices/${id} - Error during stock reversal:`, stockErr.message, ">>>>>");
                        return res.status(500).json({ error: "Failed during stock reversal.", details: stockErr.message });
                    });
                });
            } else { 
                deleteActualInvoice(id, res, db);
            }
        });
    });
});

function deleteActualInvoice(invoiceId, res, dbInstance) {
    dbInstance.run('DELETE FROM invoice_line_items WHERE invoice_id = ?', [invoiceId], (iliErr) => { 
        if (iliErr) {
            dbInstance.run("ROLLBACK;");
            console.error(`<<<<< DB ERROR: DELETE /api/invoices/${invoiceId} - Failed to delete invoice line items:`, iliErr.message, ">>>>>");
            return res.status(500).json({ error: "Failed to delete invoice line items.", details: iliErr.message });
        }
        dbInstance.run('DELETE FROM invoices WHERE id = ?', [invoiceId], function(err) { 
            if (err) {
                dbInstance.run("ROLLBACK;");
                console.error(`<<<<< DB ERROR: DELETE /api/invoices/${invoiceId} - Failed to delete invoice:`, err.message, ">>>>>");
                return res.status(500).json({ error: "Failed to delete invoice.", details: err.message });
            }
            if (this.changes === 0) {
                dbInstance.run("ROLLBACK;"); 
                return res.status(404).json({ error: "Invoice not found." });
            }
            dbInstance.run("COMMIT;", (commitErr) => {
                if (commitErr) {
                    console.error(`<<<<< DB ERROR: DELETE /api/invoices/${invoiceId} - Failed to commit deletion:`, commitErr.message, ">>>>>");
                    return res.status(500).json({ error: "Failed to commit invoice deletion.", details: commitErr.message });
                }
                console.log(`<<<<< SUCCESS: DELETE /api/invoices/${invoiceId} - Invoice and related data deleted. >>>>>`);
                res.json({ message: "Invoice and related data deleted successfully." });
            });
        });
    });
}

router.get('/config/business-profile', (req, res) => {
    // console.log("<<<<< DEBUG: GET /api/invoices/config/business-profile route hit >>>>>"); // Reduced logging
    db.get('SELECT * FROM business_profile LIMIT 1', [], (err, profile) => {
        if (err) {
            console.error("<<<<< ERROR: GET /api/invoices/config/business-profile - Error fetching business profile:", err.message, ">>>>>");
            return res.status(500).json({ error: "Failed to fetch business profile." });
        }
        res.json(profile || {}); 
    });
});

router.get('/suggest-next-number', (req, res) => {
    db.get("SELECT invoice_number FROM invoices ORDER BY id DESC LIMIT 1", [], (err, row) => {
        if (err) {
            console.error("Error fetching last invoice number:", err.message);
            return res.status(500).json({ error: "Could not fetch last invoice number." });
        }

        if (!row || !row.invoice_number) {
             // Suggest a default starting number if no invoices exist
            const defaultFirstNumber = "INV-00001"; // Or read from a config if more dynamic needed
            console.log(`<<<<< DEBUG SuggestNext: No previous invoices, suggesting default: ${defaultFirstNumber} >>>>>`);
            return res.json({ next_invoice_number: defaultFirstNumber, message: "No previous invoices. Suggested first number." });
        }

        const lastInvoiceNumber = row.invoice_number;
        const match = lastInvoiceNumber.match(/^(.*?)(\d+)$/);

        if (match) {
            const prefix = match[1]; 
            const numericPartStr = match[2];
            const numericVal = parseInt(numericPartStr, 10);
            if (!isNaN(numericVal)) {
                const nextNumericVal = numericVal + 1;
                let nextNumericPartStr = String(nextNumericVal);
                // Pad with leading zeros to match original length if it was padded
                if (numericPartStr.length > nextNumericPartStr.length && numericPartStr.startsWith('0')) {
                    nextNumericPartStr = '0'.repeat(numericPartStr.length - nextNumericPartStr.length) + nextNumericPartStr;
                }
                console.log(`<<<<< DEBUG SuggestNext: Last: ${lastInvoiceNumber}, Prefix: ${prefix}, NumStr: ${numericPartStr}, NextNumStr: ${nextNumericPartStr} >>>>>`);
                return res.json({ next_invoice_number: prefix + nextNumericPartStr });
            }
        }
        // Fallback if pattern is not recognized
        const fallbackSuggestion = lastInvoiceNumber + "-1"; // Simple append
        console.log(`<<<<< DEBUG SuggestNext: Pattern not recognized for ${lastInvoiceNumber}, fallback: ${fallbackSuggestion} >>>>>`);
        return res.json({ message: "Could not automatically determine next number from pattern: '" + lastInvoiceNumber + "'. Fallback suggested.", next_invoice_number: fallbackSuggestion });
    });
});


console.log("<<<<< DEBUG: routes/invoiceRoutes.js - router object:", typeof router, router ? Object.keys(router) : 'router is null/undefined' ,">>>>>");
module.exports = router;