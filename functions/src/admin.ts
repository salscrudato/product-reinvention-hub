// admin.ts — setUserRole callable (ADMIN only): create users, assign roles via
// custom claims (mirrored on users/{uid} for display), and (de)activate accounts.
// Custom claims are authoritative for security rules; the mirror doc is display-only.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { requireRole } from './runtime'

if (!getApps().length) initializeApp()

type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
interface SetUserRoleInput {
  action:    'create' | 'setRole' | 'deactivate' | 'reactivate'
  uid?:      string
  email?:    string
  password?: string
  name?:     string
  role?:     Role
}

export const setUserRole = onCall<SetUserRoleInput>({ maxInstances: 5 }, async (req) => {
  // ADMIN only — mirrors the isAdmin() Firestore rule on users/{uid}. requireRole (shared)
  // keeps this identical to the other admin-gated Functions and is covered by roleGuard.test.ts.
  requireRole(req.auth, 'ADMIN')

  const db   = getFirestore()
  const auth = getAuth()
  const { action } = req.data

  switch (action) {
    case 'create': {
      const { email, password, name, role } = req.data
      if (!email || !password || !role) throw new HttpsError('invalid-argument', 'email, password and role are required.')
      // B4: the create is three dependent writes (auth account → custom claim → mirror doc).
      // A crash after createUser but before the claim/mirror land would orphan an account with
      // no role claim and no users/{uid} doc. Compensate: if either follow-up fails, delete the
      // just-created auth user so a partial failure leaves NO half-provisioned account behind.
      const user = await auth.createUser({ email, password, displayName: name ?? email })
      try {
        await auth.setCustomUserClaims(user.uid, { role })
        await db.doc(`users/${user.uid}`).set({
          email, name: name ?? email, role, active: true, mustChangePassword: true,
          createdAt: FieldValue.serverTimestamp(),
        })
      } catch (err) {
        // Best-effort rollback of the orphan; swallow cleanup failures so the original cause
        // (below) is what surfaces to the caller, and log both for server-side diagnosis.
        await auth.deleteUser(user.uid).catch((cleanupErr) => {
          console.error('[setUserRole] rollback deleteUser failed for', user.uid, cleanupErr)
        })
        console.error('[setUserRole] create failed after auth account provisioned; rolled back:', err)
        throw new HttpsError('internal', 'Could not finish creating the user; the partial account was rolled back. Please retry.')
      }
      return { uid: user.uid }
    }
    case 'setRole': {
      const { uid, role } = req.data
      if (!uid || !role) throw new HttpsError('invalid-argument', 'uid and role are required.')
      await auth.setCustomUserClaims(uid, { role })
      await db.doc(`users/${uid}`).set({ role }, { merge: true })
      return { uid }
    }
    case 'deactivate':
    case 'reactivate': {
      const { uid } = req.data
      if (!uid) throw new HttpsError('invalid-argument', 'uid is required.')
      const disabled = action === 'deactivate'
      await auth.updateUser(uid, { disabled })
      await db.doc(`users/${uid}`).set({ active: !disabled }, { merge: true })
      return { uid }
    }
    default:
      throw new HttpsError('invalid-argument', `Unknown action: ${String(action)}`)
  }
})
