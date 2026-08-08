self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(data.title || 'Sendry notification', {
    body: data.body || '', icon: data.icon, image: data.image,
    data: { target_url: data.target_url || '/', ...(data.data || {}) },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.target_url || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url === new URL(target, self.location.origin).href)
    return existing ? existing.focus() : clients.openWindow(target)
  }))
})
