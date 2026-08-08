export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'include' })
  if (response.status === 204) return undefined as T
  const type = response.headers.get('content-type') ?? ''
  const payload = type.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new ApiError(typeof payload === 'object' && payload?.error ? payload.error : `Request failed with ${response.status}`, response.status, payload)
  return payload as T
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, value?: unknown) => api<T>(path, { method: 'POST', body: value === undefined ? undefined : JSON.stringify(value) })
export const patch = <T>(path: string, value: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(value) })
export const remove = (path: string) => api<void>(path, { method: 'DELETE' })
