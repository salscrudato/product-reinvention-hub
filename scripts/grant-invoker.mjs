// One-off infra fix: ensure the HTTP/callable Cloud Functions (gen2 = Cloud Run)
// allow unauthenticated invocation (allUsers → roles/run.invoker). Auth is enforced
// IN-CODE for these functions (Firebase ID token / callable context) — this is the
// standard Firebase posture; the binding just lets requests reach the function.
import { GoogleAuth } from 'google-auth-library'

const PROJECT = 'productreinvention', LOC = 'us-central1'
const SERVICES = ['chat', 'share', 'createsharelink', 'getsharesnapshot', 'refreshnews', 'setuserrole', 'hello']

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
const client = await auth.getClient()
const { token } = await client.getAccessToken()
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-goog-user-project': PROJECT }

for (const s of SERVICES) {
  const base = `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${LOC}/services/${s}`
  const gp = await fetch(`${base}:getIamPolicy`, { headers: H })
  if (gp.status !== 200) { console.log(`${s}: getIamPolicy ${gp.status} — ${(await gp.text()).slice(0, 100)}`); continue }
  const pol = await gp.json()
  const bindings = pol.bindings ?? []
  let b = bindings.find(x => x.role === 'roles/run.invoker')
  if (!b) { b = { role: 'roles/run.invoker', members: [] }; bindings.push(b) }
  if (b.members?.includes('allUsers')) { console.log(`${s}: already public`); continue }
  b.members = [...(b.members ?? []), 'allUsers']
  const sp = await fetch(`${base}:setIamPolicy`, { method: 'POST', headers: H, body: JSON.stringify({ policy: { bindings, etag: pol.etag } }) })
  console.log(`${s}: setIamPolicy ${sp.status} — ${sp.status === 200 ? 'granted allUsers invoker' : (await sp.text()).slice(0, 160)}`)
}
