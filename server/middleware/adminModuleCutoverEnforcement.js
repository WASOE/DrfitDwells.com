const { assertAdminModuleWriteAllowed } = require('../services/ops/cutover/opsCutoverService');

function adminModuleWriteGate(moduleKey) {
  return async (req, res, next) => {
    try {
      await assertAdminModuleWriteAllowed(moduleKey);
      return next();
    } catch (err) {
      if (err?.code === 'CUTOVER_WRITE_BLOCKED') {
        return res.status(err.status || 403).json({
          success: false,
          errorType: 'cutover_blocked',
          message: err.message,
          details: { moduleKey: err.moduleKey || moduleKey }
        });
      }
      return next(err);
    }
  };
}

module.exports = { adminModuleWriteGate };

