self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'This One Living', body: event.data.text(), data: {} }
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'This One Living', {
    body: payload.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: payload.data || {},
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = typeof event.notification.data?.path === 'string'
    ? event.notification.data.path
    : '/notifications'
  const target = new URL(path, self.location.origin).href

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const appWindow = windows.find((windowClient) => new URL(windowClient.url).origin === self.location.origin)
    if (appWindow) {
      return appWindow.navigate(target).then(() => appWindow.focus())
    }
    return self.clients.openWindow(target)
  }))
})
