const express = require('express');
const { body, validationResult } = require('express-validator');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');
const {
  createOpsUser,
  listOpsUsers,
  updateOpsUser,
  setOpsUserPassword
} = require('../../../services/ops/opsUserService');
const { OPS_USER_ROLES } = require('../../../models/OpsUser');
const { validateId } = require('../../../middleware/validateId');

const router = express.Router();

function handleUserRouteErrors(err, res) {
  if (err?.code === 'PERMISSION_DENIED') {
    return res.status(err.status || 403).json({
      success: false,
      errorType: 'permission',
      message: err.message
    });
  }
  if (err?.status) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  return res.status(500).json({ success: false, message: err.message });
}

function requireUsersManage(req, res, next) {
  try {
    requirePermission({
      role: req.user?.role,
      modules: req.user?.modules,
      action: ACTIONS.OPS_USERS_MANAGE
    });
    return next();
  } catch (err) {
    return handleUserRouteErrors(err, res);
  }
}

router.use(requireUsersManage);

// GET /api/ops/users
router.get('/', async (req, res) => {
  try {
    const users = await listOpsUsers();
    return res.json({ success: true, data: { users } });
  } catch (err) {
    return handleUserRouteErrors(err, res);
  }
});

// POST /api/ops/users
router.post(
  '/',
  [
    body('email').isEmail().withMessage('A valid email is required.'),
    body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name is required.'),
    body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').isIn(OPS_USER_ROLES).withMessage(`Role must be one of: ${OPS_USER_ROLES.join(', ')}`),
    body('modules').optional().isArray(),
    body('isActive').optional().isBoolean()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    try {
      const data = await createOpsUser({
        email: req.body.email,
        name: req.body.name,
        password: req.body.password,
        role: req.body.role,
        modules: req.body.modules,
        isActive: req.body.isActive
      });

      return res.status(201).json({ success: true, data });
    } catch (err) {
      return handleUserRouteErrors(err, res);
    }
  }
);

// PATCH /api/ops/users/:id
router.patch(
  '/:id',
  validateId('id'),
  [
    body('name').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name must be 1–120 characters.'),
    body('role').optional().isIn(OPS_USER_ROLES).withMessage(`Role must be one of: ${OPS_USER_ROLES.join(', ')}`),
    body('modules').optional().isArray(),
    body('isActive').optional().isBoolean()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    const { name, role, modules, isActive } = req.body || {};
    if (name === undefined && role === undefined && modules === undefined && isActive === undefined) {
      return res.status(400).json({ success: false, message: 'At least one field is required.' });
    }

    try {
      const data = await updateOpsUser(req.params.id, { name, role, modules, isActive });
      return res.json({ success: true, data });
    } catch (err) {
      return handleUserRouteErrors(err, res);
    }
  }
);

// POST /api/ops/users/:id/password
router.post(
  '/:id/password',
  validateId('id'),
  [body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    }

    try {
      const data = await setOpsUserPassword(req.params.id, req.body.password);
      return res.json({ success: true, data });
    } catch (err) {
      return handleUserRouteErrors(err, res);
    }
  }
);

module.exports = router;
