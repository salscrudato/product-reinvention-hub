// Reads back the mutation invariant after the live EDITOR edit: entity rev bump +
// Version snapshot + AuditEvent for the ZZTEST coverage (Admin SDK bypasses rules).
import * as admin from 'firebase-admin'

const COV_PATH = 'products/ZZTEST-PROD-001/coverages/ZZTEST-COV-C'

async function main() {
  admin.initializeApp({ projectId: 'productreinvention' })
  const db = admin.firestore()
  const cov = await db.doc(COV_PATH).get()
  const covData = cov.data() as { rev?: number; terms?: Array<{ default?: unknown }> } | undefined
  console.log('coverage rev:', covData?.rev, '| Cov C default now:', covData?.terms?.[0]?.default)

  const vers = await db.collection('versions').get()
  const vHit = vers.docs.filter(d => JSON.stringify(d.data()).includes('ZZTEST-COV-C'))
  console.log('Version snapshots referencing ZZTEST-COV-C:', vHit.length,
    '| fields:', vHit[0] ? Object.keys(vHit[0].data()).join(',') : 'none')

  const aud = await db.collection('auditEvents').get()
  const aHit = aud.docs.filter(d => JSON.stringify(d.data()).includes('ZZTEST-COV-C') || (d.data() as { productId?: string }).productId === 'ZZTEST-PROD-001')
  console.log('AuditEvents referencing ZZTEST coverage:', aHit.length,
    '| sample:', aHit[0] ? JSON.stringify(aHit[0].data()).slice(0, 160) : 'none')
}
main().catch(e => { console.error('invariant read-back failed:', e); process.exit(1) })
