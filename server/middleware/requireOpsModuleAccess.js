const { ROLE_CLEANER } = require('../services/permissionService');
const {
  resolveOpsApiModule,
  hasModuleAccess
} = require('../services/ops/opsModuleRegistry');

const MODULE_EXEMPT_PATHS = new Set(['/session']);

function requireOpsModuleAccess(req, res, next) {
  const relativePath = req.path || '';

  if (MODULE_EXEMPT_PATHS.has(relativePath)) {
    return next();
  }

  const role = req.user?.role;
  const modules = req.user?.modules || [];
  const moduleKey = resolveOpsApiModule(relativePath);

  if (role === 'admin' || modules.includes('*')) {
    return next();
  }

  if (role === ROLE_CLEANER) {
    if (!moduleKey) {
      return res.status(403).json({
        success: false,
        errorType: 'forbidden',
        message: 'Access denied for this OPS route.'
      });
    }
    if (!hasModuleAccess(modules, moduleKey)) {
      return res.status(403).json({
        success: false,
        errorType: 'forbidden',
        message: 'Access denied for this OPS module.'
      });
    }
    return next();
  }

  if (!moduleKey) {
    return next();
  }

  if (!hasModuleAccess(modules, moduleKey)) {
    return res.status(403).json({
      success: false,
      errorType: 'forbidden',
      message: 'Access denied for this OPS module.'
    });
  }

  return next();
}

module.exports = { requireOpsModuleAccess };
