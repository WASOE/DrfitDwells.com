/* eslint-disable no-restricted-globals */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { sanitizeOpsPushClickUrl } from '../../shared/ops/sanitizeOpsPushClickUrl.js';

// Do not call skipWaiting() on install — that replaces open checkout tabs mid-payment.
// Clients opt in via postMessage({ type: 'SKIP_WAITING' }) outside active payment flows.
self.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Network-first navigations so marketing pages (e.g. /winter-village) pick up the
// latest index.html shell instead of a weeks-old precached entry chunk graph.
// Offline / flaky network still falls back to the precached SPA shell.
const precachedShellHandler = createHandlerBoundToURL('/index.html');
const networkNavigationHandler = new NetworkFirst({
  cacheName: 'html-navigations-v1',
  networkTimeoutSeconds: 3
});

const navigationHandler = async (options) => {
  try {
    const response = await networkNavigationHandler.handle(options);
    if (response) return response;
  } catch {
    // fall through to precached shell
  }
  return precachedShellHandler(options);
};

const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [/^\/api\//, /^\/uploads\//, /\.pdf($|\?)/i]
});
registerRoute(navigationRoute);

// Payment/API routes are network-only — never serve cached create-payment-intent responses.
registerRoute(
  ({ url }) =>
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('create-payment-intent') ||
    url.pathname.includes('checkout-session'),
  new NetworkOnly()
);

registerRoute(
  ({ url }) => url.pathname.startsWith('/guides/the-cabin/'),
  new StaleWhileRevalidate({
    cacheName: 'cabin-arrival-assets',
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => (response && response.status === 200 ? response : null)
      }
    ]
  })
);

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {
        title: 'Drift & Dwells',
        body: '',
        url: '/ops',
        tag: 'ops-push'
      };

      try {
        if (event.data) {
          const parsed = event.data.json();
          payload = {
            ...payload,
            ...parsed
          };
        }
      } catch {
        // keep defaults
      }

      await self.registration.showNotification(payload.title || 'Drift & Dwells', {
        body: payload.body || '',
        tag: payload.tag || 'ops-push',
        data: {
          url: sanitizeOpsPushClickUrl(payload.url, self.location.origin)
        },
        icon: '/media/branding/favicon-48.png'
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = sanitizeOpsPushClickUrl(
    event.notification?.data?.url,
    self.location.origin
  );

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });

      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        const desired = new URL(targetUrl, clientUrl.origin);
        if (clientUrl.pathname === desired.pathname && 'focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        const absoluteUrl = new URL(targetUrl, self.location.origin).href;
        return self.clients.openWindow(absoluteUrl);
      }

      return undefined;
    })()
  );
});
