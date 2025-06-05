// middlewares/authMiddleware.js
console.log("<<<<< DEBUG: middlewares/authMiddleware.js is being loaded (placeholder) >>>>>");

const authMiddleware = (req, res, next) => {
    // This is a very basic placeholder.
    // In a real application, you would:
    // 1. Check for an Authorization header (e.g., Bearer token).
    // 2. Verify the token (e.g., JWT).
    // 3. If valid, extract user information and attach it to `req.user`.
    // 4. If invalid or missing, you might return a 401 Unauthorized or allow anonymous access.

    // For now, simulate a default admin user if no user is set.
    // THIS IS FOR DEVELOPMENT/TESTING ONLY. REMOVE OR SECURE FOR PRODUCTION.
    if (!req.user) {
        req.user = {
            id: 0, // A placeholder ID, not a real user from DB unless you have a system user with ID 0
            username: 'system_default_user',
            role: 'admin' // Granting admin for easier testing. BE VERY CAREFUL.
        };
        // console.log("<<<<< DEBUG: authMiddleware - No req.user, setting default test user >>>>>", req.user);
    }
    next();
};

const checkRole = (roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.role) {
            console.log("<<<<< DEBUG: checkRole - User not found or role not set on req.user >>>>>");
            return res.status(401).json({ error: 'Authentication required for this action.' });
        }
        if (!Array.isArray(roles)) { // Ensure roles is an array
            console.error("<<<<< DEBUG: checkRole - roles parameter is not an array >>>>>");
            return res.status(500).json({ error: 'Internal server error: Invalid role configuration.' });
        }
        if (!roles.includes(req.user.role)) {
            console.log(`<<<<< DEBUG: checkRole - Forbidden. User role: ${req.user.role}, Required roles: ${roles.join(', ')} >>>>>`);
            return res.status(403).json({ error: 'Forbidden: You do not have the necessary permissions.' });
        }
        // console.log(`<<<<< DEBUG: checkRole - Authorized. User role: ${req.user.role}, Required roles: ${roles.join(', ')} >>>>>`);
        next();
    };
};

console.log("<<<<< DEBUG: middlewares/authMiddleware.js - exports defined >>>>>");
module.exports = {
    authMiddleware,
    checkRole
};