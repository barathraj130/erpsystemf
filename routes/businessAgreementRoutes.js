// --- START OF FULL FILE businessAgreementRoutes.js ---
const express = require('express');
const router = express.Router();
const db = require('../db');

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
        
        if (!rows || rows.length === 0) {
            return res.json([]);
        }

        const agreementsWithCalculations = [];
        for (const agreement of rows) {
            let result = { ...agreement };

            if (agreement.agreement_type === 'loan_taken_by_biz' || agreement.agreement_type === 'loan_given_by_biz') {
                
                let principal_repayment_category_like = '';
                let interest_payment_category_like = '';

                if (agreement.agreement_type === 'loan_taken_by_biz') {
                    principal_repayment_category_like = 'Loan Principal Repaid%';
                    interest_payment_category_like = 'Loan Interest Paid%';
                } else { // loan_given_by_biz
                    principal_repayment_category_like = 'Loan Repayment Received from Customer%';
                    interest_payment_category_like = 'Interest on Customer Loan Received%';
                }
                
                try {
                    const allPayments = await new Promise((resolve, reject) => {
                        const sql = `
                            SELECT amount, date, category 
                            FROM transactions 
                            WHERE agreement_id = ? 
                              AND (category LIKE ? OR category LIKE ?) 
                            ORDER BY date ASC
                        `;
                        db.all(sql, [agreement.agreement_id, principal_repayment_category_like, interest_payment_category_like], (err, p_rows) => {
                            if (err) reject(err);
                            else resolve(p_rows || []);
                        });
                    });

                    const principalPayments = allPayments.filter(p => p.category.startsWith(principal_repayment_category_like.replace('%', '')));
                    const interestPayments = allPayments.filter(p => p.category.startsWith(interest_payment_category_like.replace('%', '')));
                    
                    let principalPaidOrReceived = principalPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
                    let interestPaidOrReceived = interestPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
                    
                    const outstandingPrincipal = parseFloat(agreement.total_amount || 0) - principalPaidOrReceived;

                    let total_accrued_interest = 0;
                    const monthly_breakdown = [];

                    if (agreement.interest_rate > 0) {
                        const monthlyRate = parseFloat(agreement.interest_rate) / 100;
                        
                        let currentPrincipalForInterestCalc = parseFloat(agreement.total_amount || 0);
                        let loopDate = new Date(agreement.start_date);
                        const endDate = new Date();

                        while (loopDate.getFullYear() < endDate.getFullYear() || (loopDate.getFullYear() === endDate.getFullYear() && loopDate.getMonth() <= endDate.getMonth())) {
                            const monthStr = `${loopDate.getFullYear()}-${String(loopDate.getMonth() + 1).padStart(2, '0')}`;
                            const interestDueThisMonth = currentPrincipalForInterestCalc * monthlyRate;
                            total_accrued_interest += interestDueThisMonth;

                            const interestPaymentThisMonth = interestPayments.find(p => p.date.startsWith(monthStr));
                            let status = 'Pending';
                            if(interestPaymentThisMonth) {
                                status = 'Paid';
                            } else if (new Date() > new Date(loopDate.getFullYear(), loopDate.getMonth() + 1, 0)) {
                                // If the month has passed and no payment was found
                                status = 'Skipped';
                            }

                            monthly_breakdown.push({
                                month: monthStr,
                                interest_due: parseFloat(interestDueThisMonth.toFixed(2)),
                                status: status
                            });

                            const nextMonth = new Date(loopDate.getFullYear(), loopDate.getMonth() + 1, 1);
                            const principalPaymentsThisMonth = principalPayments.filter(p => {
                                const paymentDate = new Date(p.date);
                                return paymentDate >= loopDate && paymentDate < nextMonth;
                            });

                            principalPaymentsThisMonth.forEach(p => {
                                currentPrincipalForInterestCalc -= Math.abs(p.amount);
                            });
                            
                            loopDate.setMonth(loopDate.getMonth() + 1);
                        }
                    }
                    const interest_payable_or_receivable = total_accrued_interest - interestPaidOrReceived;

                    result.outstanding_principal = parseFloat(outstandingPrincipal.toFixed(2));
                    result.interest_payable = parseFloat(interest_payable_or_receivable.toFixed(2));
                    result.calculated_principal_paid = parseFloat(principalPaidOrReceived.toFixed(2));
                    result.calculated_interest_paid = parseFloat(interestPaidOrReceived.toFixed(2));
                    result.monthly_breakdown = monthly_breakdown; // Attach the new detailed breakdown

                } catch (calcError) {
                    console.error(`Error calculating details for agreement ${agreement.agreement_id}:`, calcError);
                    result.outstanding_principal = parseFloat(agreement.total_amount || 0);
                    result.interest_payable = 0;
                    result.calculated_principal_paid = 0;
                    result.calculated_interest_paid = 0;
                    result.monthly_breakdown = [];
                }
            }
            agreementsWithCalculations.push(result);
        }

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
        // Fetch the newly created agreement to send back to the client
        db.get(`SELECT ba.id as agreement_id, ba.*, l.lender_name 
                FROM business_agreements ba 
                JOIN lenders l ON ba.lender_id = l.id 
                WHERE ba.id = ?`, [newAgreementId], (fetchErr, newAgreement) => {
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
                agreement: newAgreement, 
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
        
        res.json({ message: 'Business agreement updated successfully. Details will refresh on next load.' });
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