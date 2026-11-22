/* eslint-disable no-restricted-globals */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl =
    (event.notification && event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i += 1) {
        const client = clientList[i];
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});

self.addEventListener('push', function (event) {
  let payload = {
    title: 'Dolphin Road Carriers ERP Alert',
    body: 'Check E-Way Bill countdown or Statutory GST/KYC due alerts.',
    url: '/',
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    }
  } catch {
    // Use default payload
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/favicon-32x32.png',
      requireInteraction: true,
      data: { url: payload.url || '/' },
    })
  );
});
