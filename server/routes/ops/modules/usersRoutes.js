const express = require('express');
const { body, validationResult } = require('express-validator');
const { requirePermission, ACTIONS } = require('../../../services/permissionService');
const { createOpsUser } = require('../../../services/ops/opsUserService');
const { OPS_USER_ROLES } = require('../../../models/OpsUser');

const router = express.Router();

function handleCreateUserErrors(err, res) {
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

// POST /api/ops/users — admin-only minimal user creation (Batch C)
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
      requirePermission({
        role: req.user?.role,
        modules: req.user?.modules,
        action: ACTIONS.OPS_USERS_MANAGE
      });

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
      return handleCreateUserErrors(err, res);
    }
  }
);

module.exports = router;
