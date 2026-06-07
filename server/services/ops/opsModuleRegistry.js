/**
 * OPS module registry — maps /api/ops relative paths to module keys.
 * Longest prefix wins. Used by module-access middleware and frontend nav guards.
 */

const OPS_MODULE_KEYS = [
  'dashboard',
  'calendar',
  'reservations',
  'finance',
  'property',
  'guests_comms',
  'operations',
  'cleaning',
  'users'
];

/** @type {{ prefix: string, module: string }[]} longest prefixes first */
const OPS_API_MODULE_ROUTES = [
  { prefix: '/users', module: 'users' },
  { prefix: '/cleaning', module: 'cleaning' },
  { prefix: '/reservations', module: 'reservations' },
  { prefix: '/creator-commissions', module: 'finance' },
  { prefix: '/gift-vouchers', module: 'finance' },
  { prefix: '/promo-codes', module: 'finance' },
  { prefix: '/payments', module: 'finance' },
  { prefix: '/creator-partners', module: 'property' },
  { prefix: '/cabins', module: 'property' },
  { prefix: '/messaging', module: 'guests_comms' },
  { prefix: '/communications', module: 'guests_comms' },
  { prefix: '/reviews', module: 'guests_comms' },
  { prefix: '/manual-review', module: 'operations' },
  { prefix: '/readiness', module: 'operations' },
  { prefix: '/foundation', module: 'operations' },
  { prefix: '/availability', module: 'reservations' },
  { prefix: '/sync', module: 'calendar' },
  { prefix: '/calendar', module: 'calendar' },
  { prefix: '/dashboard', module: 'dashboard' },
  { prefix: '/health', module: 'dashboard' }
];

/** Frontend route prefixes → module keys (longest first). */
const OPS_FRONTEND_MODULE_ROUTES = [
  { prefix: '/ops/settings/cleaning', module: 'cleaning' },
  { prefix: '/ops/cleaning', module: 'cleaning' },
  { prefix: '/ops/users', module: 'users' },
  { prefix: '/ops/reservations', module: 'reservations' },
  { prefix: '/ops/gift-vouchers', module: 'finance' },
  { prefix: '/ops/promo-codes', module: 'finance' },
  { prefix: '/ops/payments', module: 'finance' },
  { prefix: '/ops/creator-partners', module: 'property' },
  { prefix: '/ops/cabins', module: 'property' },
  { prefix: '/ops/messaging', module: 'guests_comms' },
  { prefix: '/ops/communications', module: 'guests_comms' },
  { prefix: '/ops/reviews', module: 'guests_comms' },
  { prefix: '/ops/manual-review', module: 'operations' },
  { prefix: '/ops/readiness', module: 'operations' },
  { prefix: '/ops/sync', module: 'calendar' },
  { prefix: '/ops/calendar', module: 'calendar' },
  { prefix: '/ops', module: 'dashboard' }
];

const OPERATOR_DEFAULT_MODULES = OPS_MODULE_KEYS.filter((key) => key !== 'users');

function resolveOpsApiModule(relativePath) {
  const path = relativePath || '';
  for (const entry of OPS_API_MODULE_ROUTES) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.module;
    }
  }
  return null;
}

function resolveOpsFrontendModule(pathname) {
  const path = pathname || '';
  if (!path.startsWith('/ops')) {
    return null;
  }
  for (const entry of OPS_FRONTEND_MODULE_ROUTES) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.module;
    }
  }
  return null;
}

function resolveModulesForRole(role) {
  if (role === 'admin') {
    return ['*'];
  }
  if (role === 'operator') {
    return [...OPERATOR_DEFAULT_MODULES];
  }
  if (role === 'cleaner') {
    return ['cleaning'];
  }
  return [];
}

function hasModuleAccess(modules, moduleKey) {
  if (!moduleKey) {
    return false;
  }
  const list = Array.isArray(modules) ? modules : [];
  if (list.includes('*')) {
    return true;
  }
  return list.includes(moduleKey);
}

function normalizeModulesForRole(role, modules) {
  const roleDefaults = resolveModulesForRole(role);
  if (role === 'admin') {
    return ['*'];
  }
  if (role === 'cleaner') {
    return ['cleaning'];
  }
  if (Array.isArray(modules) && modules.length > 0) {
    return modules.filter((m) => OPS_MODULE_KEYS.includes(m) && m !== 'users');
  }
  return roleDefaults;
}

function getDefaultRoute(role) {
  if (role === 'cleaner') {
    return '/ops/cleaning';
  }
  if (role === 'admin') {
    return '/ops/reservations';
  }
  return '/ops';
}

module.exports = {
  OPS_MODULE_KEYS,
  OPS_API_MODULE_ROUTES,
  OPS_FRONTEND_MODULE_ROUTES,
  OPERATOR_DEFAULT_MODULES,
  resolveOpsApiModule,
  resolveOpsFrontendModule,
  resolveModulesForRole,
  hasModuleAccess,
  normalizeModulesForRole,
  getDefaultRoute
};
