// accenture.ts — typed, env-driven fetch client for an Accenture integration API.
// Documents the seam pattern: configuration comes from Vite env (never hardcoded),
// the client is created lazily, and callers get a typed surface. Not wired to a
// live endpoint yet — `createAccentureClient()` throws until configured.
// AWS-SWAP: the base URL + auth move to API Gateway + IAM/Cognito; the fetch
// shape below is unchanged. Keep secrets server-side — the browser only ever
// holds a short-lived token, never a long-lived key.
import type { ProductExport } from '../export/excel'

interface AccentureConfig { baseUrl: string; token?: string }

export interface AccentureClient {
  /** Push a product package to the integration API. */
  pushProduct(data: ProductExport): Promise<{ id: string; status: string }>
}

/** Read config from Vite env. Returns null when not configured. */
function readConfig(): AccentureConfig | null {
  const baseUrl = import.meta.env.VITE_ACCENTURE_API_URL as string | undefined
  if (!baseUrl) return null
  return { baseUrl, token: import.meta.env.VITE_ACCENTURE_API_TOKEN as string | undefined }
}

export function isAccentureConfigured(): boolean {
  return readConfig() !== null
}

export function createAccentureClient(): AccentureClient {
  const cfg = readConfig()
  if (!cfg) throw new Error('Accenture integration is not configured (set VITE_ACCENTURE_API_URL).')

  async function request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${cfg!.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg!.token ? { Authorization: `Bearer ${cfg!.token}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Accenture API ${path} failed: ${res.status}`)
    return res.json() as Promise<T>
  }

  return {
    pushProduct: (data) => request('/products', {
      refId: data.product.refId, name: data.product.name,
      coverages: data.coverages.length, forms: data.forms.length,
    }),
  }
}
