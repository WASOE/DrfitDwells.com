export const OPS_APPEARANCE_STORAGE_KEY = 'dd_ops_appearance';
export const OPS_APPEARANCE_MODES = ['system', 'light', 'dark'];
export const DEFAULT_OPS_APPEARANCE_MODE = 'system';

export const OPS_HTML_ATTR = {
  active: 'data-ops-active',
  mode: 'data-ops-appearance-mode',
  appearance: 'data-ops-appearance',
  themed: 'data-ops-themed'
};

export function isOpsPathname(pathname) {
  if (typeof pathname !== 'string') return false;
  return pathname === '/ops' || pathname.startsWith('/ops/');
}

export function parseStoredOpsAppearanceMode(value) {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return DEFAULT_OPS_APPEARANCE_MODE;
}

export function readOpsAppearanceMode(storage) {
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return DEFAULT_OPS_APPEARANCE_MODE;
    return parseStoredOpsAppearanceMode(store.getItem(OPS_APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_OPS_APPEARANCE_MODE;
  }
}

export function writeOpsAppearanceMode(mode, storage) {
  const parsed = parseStoredOpsAppearanceMode(mode);
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store) return parsed;
    store.setItem(OPS_APPEARANCE_STORAGE_KEY, parsed);
  } catch {
    /* private mode / unavailable storage */
  }
  return parsed;
}

export function getSystemPrefersDark(matchMediaFn) {
  try {
    const mq = matchMediaFn || (typeof window !== 'undefined' ? window.matchMedia.bind(window) : null);
    if (!mq) return false;
    return Boolean(mq('(prefers-color-scheme: dark)')?.matches);
  } catch {
    return false;
  }
}

export function resolveOpsAppearance(mode, systemPrefersDark) {
  const parsed = parseStoredOpsAppearanceMode(mode);
  if (parsed === 'light') return 'light';
  if (parsed === 'dark') return 'dark';
  return systemPrefersDark ? 'dark' : 'light';
}

export function applyOpsAppearanceToRoot(root, { active, mode, appearance }) {
  if (!root) return;
  if (!active) {
    root.removeAttribute(OPS_HTML_ATTR.active);
    root.removeAttribute(OPS_HTML_ATTR.mode);
    root.removeAttribute(OPS_HTML_ATTR.appearance);
    return;
  }
  root.setAttribute(OPS_HTML_ATTR.active, 'true');
  root.setAttribute(OPS_HTML_ATTR.mode, mode);
  root.setAttribute(OPS_HTML_ATTR.appearance, appearance);
}

export function getOpsRootDomProps({ appearance, mode, themed = false }) {
  const props = {
    className: 'ops-root',
    [OPS_HTML_ATTR.appearance]: appearance,
    [OPS_HTML_ATTR.mode]: mode
  };
  if (themed) {
    props[OPS_HTML_ATTR.themed] = 'true';
  }
  return props;
}

/**
 * Pre-React bootstrap. Same rules as the inline index.html script.
 * Public routes are a no-op. Never sets html.dark or color-scheme.
 */
export function initOpsAppearanceBootstrap({
  pathname,
  storage,
  matchMedia,
  root
} = {}) {
  const path = pathname ?? (typeof location !== 'undefined' ? location.pathname : '');
  if (!isOpsPathname(path)) {
    return { applied: false, mode: null, appearance: null };
  }
  const mode = readOpsAppearanceMode(storage);
  const appearance = resolveOpsAppearance(mode, getSystemPrefersDark(matchMedia));
  applyOpsAppearanceToRoot(root, { active: true, mode, appearance });
  return { applied: true, mode, appearance };
}
