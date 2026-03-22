/**
 * Ops routes: require full admin role (not operator). Use for destructive / cutover actions.
 * Relies on adminAuth running first and setting req.user.role.
 */
function requireOpsAdminRole(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      errorType: 'forbidden',
      message: 'This action requires a full admin session. Operator role is not permitted.'
    });
  }
  next();
}

module.exports = { requireOpsAdminRole };
