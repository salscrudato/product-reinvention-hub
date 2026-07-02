// Auth state, Firestore profile, and sign-in/out helpers for the whole app.
// Never import firebase/* here — everything goes through the adapter seam.
import { createContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { adapter } from '../lib/backend'
import type { AuthUser } from '../lib/backend'

export interface UserProfile {
  mustChangePassword: boolean
  role: AuthUser['role']
}

interface UserContextValue {
  user:    AuthUser | null
  profile: UserProfile | null
  loading: boolean
}

const UserContext = createContext<UserContextValue | null>(null)

export function UserProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  // Ref to unsubscribe from the profile doc when the user changes
  const profileUnsub = useRef<(() => void) | null>(null)

  useEffect(() => {
    return adapter.auth.onUser((u) => {
      setUser(u)
      // Tear down previous profile subscription
      profileUnsub.current?.()
      profileUnsub.current = null

      if (u) {
        // Subscribe to own user doc so mustChangePassword updates immediately after write.
        profileUnsub.current = adapter.db.subscribe<{ mustChangePassword?: boolean }>(
          `users/${u.uid}`,
          (doc) => {
            if (doc && !Array.isArray(doc)) {
              setProfile({ mustChangePassword: doc.mustChangePassword ?? false, role: u.role })
            } else {
              setProfile({ mustChangePassword: false, role: u.role })
            }
            setLoading(false)
          },
        )
      } else {
        setProfile(null)
        setLoading(false)
      }
    })
  }, [])

  return (
    <UserContext value={{ user, profile, loading }}>
      {children}
    </UserContext>
  )
}

// exported for use in useUser.ts — do not call directly
export { UserContext }
