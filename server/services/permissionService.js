const ROLE_ADMIN = 'admin';
const ROLE_OPERATOR = 'operator';

const ACTIONS = {
  BOOKING_STATUS_UPDATE: 'booking.status.update',
  BOOKING_LIFECYCLE_EMAIL_RESEND: 'booking.lifecycle_email.resend',
  CABIN_IMAGE_DELETE: 'cabin.image.delete',
  OPS_RESERVATION_MANUAL_CREATE: 'ops.reservation.manual_create',
  OPS_RESERVATION_CONFIRM: 'ops.reservation.confirm',
  OPS_RESERVATION_CHECK_IN: 'ops.reservation.check_in',
  OPS_RESERVATION_COMPLETE: 'ops.reservation.complete',
  OPS_RESERVATION_CANCEL: 'ops.reservation.cancel',
  OPS_RESERVATION_REASSIGN: 'ops.reservation.reassign',
  OPS_RESERVATION_EDIT_DATES: 'ops.reservation.edit_dates',
  OPS_RESERVATION_EDIT_GUEST_CONTACT: 'ops.reservation.edit_guest_contact',
  OPS_RESERVATION_ADD_NOTE: 'ops.reservation.add_note',
  OPS_AVAILABILITY_MANUAL_BLOCK_CREATE: 'ops.availability.manual_block.create',
  OPS_AVAILABILITY_MANUAL_BLOCK_EDIT: 'ops.availability.manual_block.edit',
  OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE: 'ops.availability.manual_block.remove',
  OPS_AVAILABILITY_MAINTENANCE_BLOCK_CREATE: 'ops.availability.maintenance_block.create',
  OPS_AVAILABILITY_MAINTENANCE_BLOCK_EDIT: 'ops.availability.maintenance_block.edit',
  OPS_AVAILABILITY_MAINTENANCE_BLOCK_REMOVE: 'ops.availability.maintenance_block.remove',
  OPS_COMMUNICATION_SEND_ARRIVAL: 'ops.communication.send_arrival',
  OPS_COMMUNICATION_RESEND_ARRIVAL: 'ops.communication.resend_arrival',
  OPS_COMMUNICATION_MARK_ARRIVAL_COMPLETED: 'ops.communication.mark_arrival_completed',
  OPS_GIFT_VOUCHER_READ: 'ops.gift_voucher.read',
  OPS_GIFT_VOUCHER_MANAGE: 'ops.gift_voucher.manage'
};

const POLICY = {
  [ACTIONS.BOOKING_STATUS_UPDATE]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.BOOKING_LIFECYCLE_EMAIL_RESEND]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.CABIN_IMAGE_DELETE]: [ROLE_ADMIN],
  [ACTIONS.OPS_RESERVATION_CONFIRM]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_RESERVATION_CHECK_IN]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_RESERVATION_COMPLETE]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_RESERVATION_CANCEL]: [ROLE_ADMIN],
  [ACTIONS.OPS_RESERVATION_REASSIGN]: [ROLE_ADMIN],
  [ACTIONS.OPS_RESERVATION_EDIT_DATES]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_RESERVATION_EDIT_GUEST_CONTACT]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_RESERVATION_ADD_NOTE]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_CREATE]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_EDIT]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_AVAILABILITY_MANUAL_BLOCK_REMOVE]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_CREATE]: [ROLE_ADMIN],
  [ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_EDIT]: [ROLE_ADMIN],
  [ACTIONS.OPS_AVAILABILITY_MAINTENANCE_BLOCK_REMOVE]: [ROLE_ADMIN],
  [ACTIONS.OPS_COMMUNICATION_SEND_ARRIVAL]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_COMMUNICATION_RESEND_ARRIVAL]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_COMMUNICATION_MARK_ARRIVAL_COMPLETED]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_GIFT_VOUCHER_READ]: [ROLE_ADMIN, ROLE_OPERATOR],
  [ACTIONS.OPS_GIFT_VOUCHER_MANAGE]: [ROLE_ADMIN, ROLE_OPERATOR]
};

function normalizeRole(role) {
  if (!role) return ROLE_ADMIN;
  return String(role).toLowerCase();
}

function evaluatePermission({ role, action }) {
  const normalizedRole = normalizeRole(role);
  const allowedRoles = POLICY[action] || [];
  const allowed = allowedRoles.includes(normalizedRole);
  return { allowed, role: normalizedRole, action };
}

function requirePermission({ role, action }) {
  const result = evaluatePermission({ role, action });
  if (!result.allowed) {
    const err = new Error(`Permission denied for action: ${action}`);
    err.code = 'PERMISSION_DENIED';
    err.status = 403;
    err.permission = result;
    throw err;
  }
  return result;
}

module.exports = {
  ROLE_ADMIN,
  ROLE_OPERATOR,
  ACTIONS,
  evaluatePermission,
  requirePermission
};
