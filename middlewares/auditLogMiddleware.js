// middlewares/auditLogMiddleware.js
console.log("<<<<< DEBUG: middlewares/auditLogMiddleware.js is being loaded (Functional Placeholder) >>>>>");

const db = require('../db'); // Ensure db is correctly required

const auditLogMiddleware = (req, res, next) => {
    const originalSend = res.send;
    // We can try to capture original data for PUT/PATCH if needed, but it's complex.
    // For now, we primarily log the action and data sent *to* the server.

    res.send = function (body) { // 'this' will be 'res'
        // Log after the response is prepared but before it's sent,
        // or consider logging in a res.on('finish', ...) event for more accuracy on status.
        try {
            // Avoid logging for GET requests or OPTIONS, or for viewing the audit log itself
            if (req.method !== 'GET' && req.method !== 'OPTIONS' && !req.originalUrl.endsWith('/api/auditlog')) {
                
                console.log(`<<<<< AUDIT LOG MIDDLEWARE: Intercepted ${req.method} ${req.originalUrl}, Status: ${this.statusCode} >>>>>`);

                const pathParts = req.originalUrl.split('/').filter(p => p && p.toLowerCase() !== 'api');
                let entityType = 'Unknown';
                let entityId = req.params.id || null; // From URL like /api/users/:id

                if (pathParts.length > 0) {
                    entityType = pathParts[0]; // e.g., 'users', 'products'
                    if (pathParts.length > 1 && !isNaN(parseInt(pathParts[1]))) {
                        entityId = parseInt(pathParts[1]);
                    }
                }

                // Attempt to get ID from request body for POST if not in params
                if (req.method === 'POST' && req.body && req.body.id && !entityId) {
                    entityId = req.body.id;
                }
                // Attempt to get ID from response body for POST if it was generated
                if (req.method === 'POST' && !entityId) {
                    try {
                        const responseBody = JSON.parse(body);
                        if(responseBody && responseBody.id) {
                            entityId = responseBody.id;
                        } else if (responseBody && responseBody.user && responseBody.user.id) { // For user creation
                            entityId = responseBody.user.id;
                        } else if (responseBody && responseBody.agreement && responseBody.agreement.id) { // For agreement creation
                            entityId = responseBody.agreement.id;
                        }
                         // Add more else if for other entities that return ID differently
                    } catch (e) { /* ignore if body is not JSON or no id */ }
                }


                const auditEntry = {
                    user_id_acting: req.user ? req.user.id : null, // Assuming authMiddleware sets req.user
                    action: `${req.method}_${entityType.toUpperCase()}`,
                    entity_type: entityType.charAt(0).toUpperCase() + entityType.slice(1), // Capitalize first letter
                    entity_id: entityId,
                    details_before: null, // TODO: Implement fetching 'before' state for PUT/DELETE
                    details_after: (req.method === 'POST' || req.method === 'PUT') ? JSON.stringify(req.body) : null,
                    ip_address: req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress // Get IP address
                };

                // Prevent logging sensitive info like passwords in 'details_after'
                if (auditEntry.details_after) {
                    try {
                        let details = JSON.parse(auditEntry.details_after);
                        if (details.password) delete details.password;
                        if (details.confirmPassword) delete details.confirmPassword;
                        // Add other sensitive fields to redact
                        auditEntry.details_after = JSON.stringify(details);
                    } catch (e) { /* ignore if not valid JSON */ }
                }


                if (db && typeof db.run === 'function') {
                    db.run('INSERT INTO audit_log (user_id_acting, action, entity_type, entity_id, details_before, details_after, ip_address) VALUES (?,?,?,?,?,?,?)',
                        [auditEntry.user_id_acting, auditEntry.action, auditEntry.entity_type, auditEntry.entity_id, auditEntry.details_before, auditEntry.details_after, auditEntry.ip_address],
                        (err) => {
                            if(err) console.error("❌ Failed to write to audit log table:", err.message, auditEntry);
                            else console.log("✅ Audit log entry created for:", auditEntry.action, "on Entity:", auditEntry.entity_type, "ID:", auditEntry.entity_id || 'N/A');
                        }
                    );
                } else {
                    console.warn("⚠️ DB object not available or 'run' method missing in auditLogMiddleware.");
                }
            }
        } catch (error) {
            console.error("Error in auditLogMiddleware res.send override:", error);
        }
        originalSend.call(this, body); // Call the original res.send
    };
    next();
};

console.log("<<<<< DEBUG: middlewares/auditLogMiddleware.js - auditLogMiddleware type:", typeof auditLogMiddleware, " >>>>>");
module.exports = { auditLogMiddleware };