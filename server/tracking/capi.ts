import { env } from '../env'
import { sha256 } from '../crypto'

export interface CapiUserData {
  em?: string[]
  ph?: string[]
  external_id?: string[]
  fbp?: string
  fbc?: string
  client_ip_address?: string
  client_user_agent?: string
  country?: string[]
  zp?: string[]
  ct?: string[]
  fn?: string[]
  ln?: string[]
}

export interface CapiEvent {
  event_name: string
  event_time: number
  event_id: string
  event_source_url?: string
  action_source: 'website'
  user_data: CapiUserData
  custom_data?: { value?: number; currency?: string; order_id?: string; content_ids?: string[] }
}

// Normalisation per Meta's customer information parameter rules before hashing.
export const hashEmail = (e?: string | null) => {
  const v = e?.trim().toLowerCase()
  return v && v.includes('@') ? sha256(v) : undefined
}
export const hashPhone = (p?: string | null, defaultCountry = '34') => {
  let v = p?.replace(/[^\d+]/g, '') ?? ''
  if (!v) return undefined
  if (v.startsWith('+')) v = v.slice(1)
  else if (v.startsWith('00')) v = v.slice(2)
  else if (v.length <= 9) v = defaultCountry + v
  return v.length >= 8 ? sha256(v) : undefined
}
export const hashText = (s?: string | null) => {
  const v = s?.trim().toLowerCase().replace(/\s+/g, '')
  return v ? sha256(v) : undefined
}

/** Send one event to the Conversions API. Returns null on success or the error message. */
export async function sendCapi(pixelId: string, accessToken: string, event: CapiEvent, testEventCode?: string | null): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.facebook.com/${env.graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], ...(testEventCode ? { test_event_code: testEventCode } : {}) }),
      signal: AbortSignal.timeout(15_000)
    })
    if (res.ok) return null
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return body.error?.message ?? `HTTP ${res.status}`
  } catch (e) {
    return (e as Error).message
  }
}
