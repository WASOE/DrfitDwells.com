/* eslint-disable no-restricted-globals */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { sanitizeOpsPushClickUrl } from '../../shared/ops/sanitizeOpsPushClickUrl.js';

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const navigationHandler = createHandlerBoundToURL('/index.html');
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
