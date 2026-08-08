import type { AppConfig } from './config'

type PayPalOrder = { id: string; status: string; links?: Array<{ href: string; rel: string }> }

function baseUrl(config: AppConfig) {
  return config.paypalEnvironment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
}

async function accessToken(config: AppConfig) {
  if (!config.paypalClientId || !config.paypalClientSecret) throw new Error('PayPal credentials are not configured')
  const credentials = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64')
  const response = await fetch(`${baseUrl(config)}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  if (!response.ok) throw new Error(`PayPal authentication failed with status ${response.status}`)
  const payload = await response.json() as { access_token: string }
  return payload.access_token
}

export async function createPayPalOrder(config: AppConfig, input: { amount: number; currency: string; campaignId: string; returnUrl: string; cancelUrl: string }) {
  const token = await accessToken(config)
  const response = await fetch(`${baseUrl(config)}/v2/checkout/orders`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'paypal-request-id': `campaign-${input.campaignId}` }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: input.campaignId, description: 'Campaign delivery', amount: { currency_code: input.currency, value: input.amount.toFixed(2) } }], payment_source: { paypal: { experience_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl, user_action: 'PAY_NOW' } } } }) })
  if (!response.ok) throw new Error(`PayPal order creation failed with status ${response.status}`)
  return response.json() as Promise<PayPalOrder>
}

export async function capturePayPalOrder(config: AppConfig, orderId: string) {
  const token = await accessToken(config)
  const response = await fetch(`${baseUrl(config)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'paypal-request-id': `capture-${orderId}` }, body: '{}' })
  if (!response.ok) throw new Error(`PayPal capture failed with status ${response.status}`)
  return response.json() as Promise<PayPalOrder>
}
