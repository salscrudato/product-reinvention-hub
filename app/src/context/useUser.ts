// useUser — custom hook in its own file to satisfy the react/only-export-components rule.
import { useContext } from 'react'
import { UserContext } from './UserContext'

export function useUser() {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used inside UserProvider')
  return ctx
}
