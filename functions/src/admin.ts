// admin.ts — setUserRole callable (ADMIN only): create users, assign roles via
// custom claims (mirrored on users/{uid} for display), and (de)activate accounts.
// Custom claims are authoritative for security rules; the mirror doc is display-only.
// AWS-SWAP: Cognito AdminCreateUser + group assignment; mirror row in the users table.
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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
  const callerRole = (req.auth?.token as { role?: string } | undefined)?.role
  if (callerRole !== 'ADMIN') throw new HttpsError('permission-denied', 'Admin access required.')

  const db   = getFirestore()
  const auth = getAuth()
  const { action } = req.data

  switch (action) {
    case 'create': {
      const { email, password, name, role } = req.data
      if (!email || !password || !role) throw new HttpsError('invalid-argument', 'email, password and role are required.')
      const user = await auth.createUser({ email, password, displayName: name ?? email })
      await auth.setCustomUserClaims(user.uid, { role })
      await db.doc(`users/${user.uid}`).set({
        email, name: name ?? email, role, active: true, mustChangePassword: true,
        createdAt: FieldValue.serverTimestamp(),
      })
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
