class SendryPush {
  constructor(options) {
    this.brandId = options.brandId
    this.contactId = options.contactId
    this.vapidPublicKey = options.vapidPublicKey
    this.apiBase = options.apiBase || ''
    this.allowedOrigin = options.allowedOrigin || location.origin
  }

  async requestPermissionFromGesture(event) {
    if (!event || !event.isTrusted) throw new Error('Push permission must be requested from an explicit user gesture')
    if (location.origin !== this.allowedOrigin) throw new Error('This origin is not allowed for push registration')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { granted: false }
    const registration = await navigator.serviceWorker.register('/sendry-sw.js', { scope: '/' })
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: this.#key(this.vapidPublicKey) })
    const response = await fetch(`${this.apiBase}/api/v2/public/push/${this.brandId}/subscriptions`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact_id: this.contactId, platform: 'web', provider: 'webpush', endpoint: subscription.endpoint, subscription: subscription.toJSON(), origin: location.origin }),
    })
    if (!response.ok) throw new Error(`Push registration failed with ${response.status}`)
    return { granted: true, subscription: await response.json() }
  }

  #key(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4)
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
    return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
  }
}

window.SendryPush = SendryPush
