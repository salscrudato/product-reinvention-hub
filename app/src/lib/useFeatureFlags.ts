// useFeatureFlags — client-side surface gating (nav hiding), supplementary to the
// authoritative SERVER enforcement (server/lib/platform-config.js requireFlag + the
// central flag middleware in server.js). These hooks hide disabled surfaces from nav so a
// user is never shown a route the server would 403; they NEVER replace server enforcement.
//
// The effective flags ride on the auth user (from /auth/me). Before they load — or if the
// call fails — a surface defaults to ENABLED (fail-open UI): a flag is only hidden when the
// server has explicitly resolved it to `false`.
import { useUser } from '../context/useUser'

export function useFeatureFlags(): Record<string, boolean> {
  const { user } = useUser()
  return user?.flags ?? {}
}

/** True unless the server has explicitly disabled this surface for the tenant. */
export function useFlag(key: string): boolean {
  const flags = useFeatureFlags()
  return flags[key] !== false
}
