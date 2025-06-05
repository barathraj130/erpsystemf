// --- START OF FULL FILE businessAgreementRoutes.js ---
const express = require('express');
const router = express.Router();
const db = require('../db'); // Assuming your db connection is in ../db.js

router.get('/', async (req, res) => {
    console.log('[API] GET /api/business-agreements request received.');
    const sql = `
        SELECT ba.id as agreement_id, ba.agreement_type, ba.total_amount, ba.start_date, ba.details, ba.lender_id,
               ba.interest_rate,
               l.lender_name
        FROM business_agreements ba
        LEFT JOIN lenders l ON ba.lender_id = l.id
        ORDER BY ba.start_date DESC, ba.id DESC
    `;
    db.all(sql, [], async (err, rows) => {
        if (err) {
            console.error("❌ [API DB Error] Error fetching business agreements from DB:", err.message);
            return res.status(500).json({ error: "Database error while fetching business agreements.", details: err.message });
        }
        console.log(`[API] Initial agreements fetched: ${rows ? rows.length : 0}`);

        if (!rows || rows.length === 0) {
            console.log("✅ [API DB Success] No business agreements found.");
            return res.json([]);
        }

        const agreementsWithCalculations = await Promise.all(rows.map(async (agreement) => {
            console.log(`[API] Processing agreement ID: ${agreement.agreement_id}, Type: ${agreement.agreement_type}`);
            let interest_payable = 0;
            let calculated_principal_paid = 0; // For loan_taken_by_biz (principal paid by biz)
            let calculated_principal_received = 0; // For loan_given_by_biz (principal received by biz)
            // Interest paid/received will be factored into interest_payable/receivable

            if (agreement.agreement_type === 'loan_taken_by_biz' && agreement.interest_rate > 0) {
                const principal = parseFloat(agreement.total_amount);
                const rate = parseFloat(agreement.interest_rate) / 100; // Annual rate
                const startDate = new Date(agreement.start_date);
                const today = new Date();
                
                const timeDiff = today.getTime() - startDate.getTime();
                // Ensure timeDiff is not negative (e.g. if start_date is in future)
                const timeInYears = timeDiff > 0 ? timeDiff / (1000 * 3600 * 24 * 365.25) : 0; 
                console.log(`[API Calc] Agreement ID ${agreement.agreement_id} (Loan Taken): Principal=${principal}, Rate=${rate}, TimeInYears=${timeInYears}`);

                if (timeInYears > 0) {
                    const simpleInterestAccrued = principal * rate * timeInYears;
                    console.log(`[API Calc] Agreement ID ${agreement.agreement_id}: SimpleInterestAccrued=${simpleInterestAccrued}`);
                    
                    let interest_paid_by_biz_for_this_loan = 0;
                    const interestPaymentsSql = `
                        SELECT SUM(ABS(amount)) as total_interest_paid
                        FROM transactions
                        WHERE agreement_id = ? 
                          AND category LIKE 'Loan Interest Paid by Business%' 
                          AND amount < 0
                    `;
                    try {
                        const paymentRow = await new Promise((resolve, reject) => {
                            db.get(interestPaymentsSql, [agreement.agreement_id], (payErr, payRow) => {
                                if (payErr) reject(payErr);
                                else resolve(payRow);
                            });
                        });
                        if (paymentRow && paymentRow.total_interest_paid) {
                            interest_paid_by_biz_for_this_loan = parseFloat(paymentRow.total_interest_paid);
                        }
                        console.log(`[API Calc] Agreement ID ${agreement.agreement_id}: InterestPaidByBiz=${interest_paid_by_biz_for_this_loan}`);
                        
                        interest_payable = simpleInterestAccrued - interest_paid_by_biz_for_this_loan;
                        if (interest_payable < 0) interest_payable = 0; 

                    } catch (payErr) {
                        console.error("❌ [API DB Error] Error fetching interest payments for agreement ID " + agreement.agreement_id + ":", payErr.message);
                        interest_payable = simpleInterestAccrued; // Fallback: show full accrued if payments can't be fetched
                    }
                }
            }
            
            if (agreement.agreement_type === 'loan_taken_by_biz') {
                 const principalPaymentsSql = `
                    SELECT SUM(ABS(amount)) as total_principal_paid
                    FROM transactions
                    WHERE agreement_id = ? AND category LIKE 'Loan Principal Repaid by Business%' AND amount < 0
                `;
                try {
                    const principalRow = await new Promise((resolve, reject) => {
                        db.get(principalPaymentsSql, [agreement.agreement_id], (err, row) => {
                            if(err) reject(err); else resolve(row);
                        });
                    });
                    if (principalRow && principalRow.total_principal_paid) {
                        calculated_principal_paid = parseFloat(principalRow.total_principal_paid);
                    }
                     console.log(`[API Calc] Agreement ID ${agreement.agreement_id} (Loan Taken): CalculatedPrincipalPaid=${calculated_principal_paid}`);
                } catch (prinPayErr) {
                     console.error("❌ [API DB Error] Error fetching principal payments for loan_taken_by_biz ID " + agreement.agreement_id + ":", prinPayErr.message);
                }
            } else if (agreement.agreement_type === 'loan_given_by_biz') {
                // Calculate interest receivable and principal received by biz
                // (This part needs to be built out similar to loan_taken_by_biz if you want accurate tracking for loans given)
                console.log(`[API Calc] Agreement ID ${agreement.agreement_id} (Loan Given): Placeholder for interest receivable and principal received calculation.`);
                // For now, we'll assume backend might send these if logic was added for GET /api/users or a similar specialized route
                // If not, these will default to 0 from the declaration above.
                 const principalReceivedSql = `
                    SELECT SUM(ABS(amount)) as total_principal_received
                    FROM transactions
                    WHERE agreement_id = ? 
                        AND (category LIKE 'Loan Repayment Received from Customer%' OR category LIKE 'Loan Repayment (Principal) Received%') /* Adjust category names */
                        AND amount < 0 /* Payments received by biz are negative to customer balance */
                `;
                 try {
                    const principalRow = await new Promise((resolve, reject) => {
                        db.get(principalReceivedSql, [agreement.agreement_id], (err, row) => {
                            if(err) reject(err); else resolve(row);
                        });
                    });
                    if (principalRow && principalRow.total_principal_received) {
                        calculated_principal_received = parseFloat(principalRow.total_principal_received);
                    }
                    console.log(`[API Calc] Agreement ID ${agreement.agreement_id} (Loan Given): CalculatedPrincipalReceived=${calculated_principal_received}`);
                } catch (prinRecErr) {
                     console.error("❌ [API DB Error] Error fetching principal payments for loan_given_by_biz ID " + agreement.agreement_id + ":", prinRecErr.message);
                }
            }


            console.log(`[API Result] Agreement ID ${agreement.agreement_id}: Final interest_payable=${interest_payable}, calculated_principal_paid=${calculated_principal_paid}, calculated_principal_received=${calculated_principal_received}`);
            return {
                ...agreement,
                interest_payable: parseFloat(interest_payable.toFixed(2)),
                calculated_principal_paid: parseFloat(calculated_principal_paid.toFixed(2)), // For loans taken by biz
                calculated_principal_received_by_biz: parseFloat(calculated_principal_received.toFixed(2)) // For loans given by biz
            };
        }));

        console.log("✅ [API DB Success] Successfully fetched and calculated business agreements from DB. Count:", agreementsWithCalculations.length);
        res.json(agreementsWithCalculations);
    });
});

router.post('/', (req, res) => {
    console.log('[API] POST /api/business-agreements request received. Body:', req.body);
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields: lender, type, total amount, and start date are required.' });
    }
    if (isNaN(parseFloat(total_amount))) {
        return res.status(400).json({ error: 'Total amount must be a valid number.' });
    }
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `INSERT INTO business_agreements (lender_id, agreement_type, total_amount, start_date, details, interest_rate)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [lender_id, agreement_type, parseFloat(total_amount), start_date, details, parsedInterestRate], function(err) {
        if (err) {
            console.error("❌ [API DB Error] Error creating business agreement:", err.message);
            return res.status(500).json({ error: "Failed to create business agreement: " + err.message });
        }
        const newAgreementId = this.lastID;
        db.get(`SELECT ba.*, l.lender_name FROM business_agreements ba JOIN lenders l ON ba.lender_id = l.id WHERE ba.id = ?`, [newAgreementId], (fetchErr, newAgreement) => {
            if (fetchErr) {
                 console.error("❌ [API DB Error] Error fetching newly created agreement:", fetchErr.message);
                 return res.status(201).json({ id: newAgreementId, message: 'Business agreement created (but failed to fetch full details).' });
            }
            if (!newAgreement) {
                console.error("❌ [API Logic Error] Newly created agreement not found by ID:", newAgreementId);
                return res.status(201).json({ id: newAgreementId, message: 'Business agreement created (but not found immediately after).' });
            }
            console.log("✅ [API DB Success] Successfully created and fetched business agreement:", newAgreement);
            res.status(201).json({ 
                agreement: {
                    ...newAgreement, 
                    interest_payable: 0, 
                    calculated_principal_paid: 0,
                    calculated_principal_received_by_biz: 0 
                }, 
                message: 'Business agreement created successfully.' 
            });
        });
    });
});

router.put('/:id', (req, res) => {
    const { id } = req.params;
    const { lender_id, agreement_type, total_amount, start_date, details, interest_rate } = req.body;
    if (!lender_id || !agreement_type || total_amount === undefined || total_amount === null || !start_date) {
        return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (isNaN(parseFloat(total_amount))) { return res.status(400).json({ error: 'Total amount must be a valid number.' }); }
    
    const parsedInterestRate = (agreement_type.includes('loan') && interest_rate !== undefined) ? parseFloat(interest_rate) : 0;
    if (isNaN(parsedInterestRate) || parsedInterestRate < 0) {
        return res.status(400).json({ error: 'Interest rate must be a valid non-negative number if provided for a loan.' });
    }

    const sql = `UPDATE business_agreements SET lender_id = ?, agreement_type = ?, total_amount = ?, start_date = ?, details = ?, interest_rate = ? WHERE id = ?`;
    db.run(sql, [lender_id, agreement_type, parseFloat(total_amount), start_date, details, parsedInterestRate, id], function(err) {
        if (err) {
            console.error("Error updating business agreement:", err.message);
            return res.status(500).json({ error: "Failed to update business agreement: " + err.message });
        }
        if (this.changes === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        
        db.get(`SELECT ba.*, l.lender_name FROM business_agreements ba JOIN lenders l ON ba.lender_id = l.id WHERE ba.id = ?`, [id], (fetchErr, updatedAgreement) => {
            if (fetchErr) {
                 console.error("Error fetching updated agreement:", fetchErr.message);
                 return res.json({ message: 'Business agreement updated (but failed to fetch details).' });
            }
            res.json({ 
                agreement: {
                    ...updatedAgreement, 
                    interest_payable: 'Recalculate on next GET', 
                    calculated_principal_paid: 'Recalculate on next GET',
                    calculated_principal_received_by_biz: 'Recalculate on next GET'
                }, 
                message: 'Business agreement updated successfully.' 
            });
        });
    });
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM business_agreements WHERE id = ?', [id], function(err) {
        if (err) {
            console.error("Error deleting business agreement:", err.message);
            return res.status(500).json({ error: "Failed to delete business agreement: " + err.message });
        }
        if (this.changes === 0) { return res.status(404).json({ message: 'Business agreement not found.' }); }
        res.json({ message: 'Business agreement deleted successfully.' });
    });
});

module.exports = router;
// --- END OF FULL FILE businessAgreementRoutes.js ---