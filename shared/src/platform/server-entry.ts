// server-entry.ts — esbuild entry for server/lib/platform-shared.cjs.
// `pnpm build:platform` bundles this to CJS so server/lib/platform-config.js can
// require the SAME flag registry + config validators the app uses. Keep this a thin
// re-export of the pure platform module (mirrors shared/src/ai/api-server.ts).
export {
  FEATURE_FLAGS,
  FLAG_KEYS,
  TENANT_OVERRIDABLE_KEYS,
  isKnownFlag,
  flagDef,
  resolveFlag,
  resolveFlags,
  sanitizeFlagOverrides,
} from './featureFlags'
export {
  BRAND_ACCENTS,
  KNOWN_AI_ROLES,
  ENTITLEMENT_CAPS,
  DEFAULT_ENTITLEMENTS,
  validateConfigPatch,
  mergeConfig,
  effectiveEntitlements,
} from './tenantConfig'
