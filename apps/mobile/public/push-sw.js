self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Rolodex', body: '' }
  event.waitUntil(self.registration.showNotification(data.title || 'Rolodex', { body: data.body || '', data: { href: data.href || '/' } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const href = event.notification.data && event.notification.data.href ? event.notification.data.href : '/'
  event.waitUntil(self.clients.openWindow(href))
})
