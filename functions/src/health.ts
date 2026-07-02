// health.ts — lightweight callable to verify the Functions pipeline is alive.
import { onCall } from 'firebase-functions/v2/https'

export const hello = onCall({ maxInstances: 10 }, (request) => {
  return {
    message: 'Product Factory Functions are alive.',
    uid: request.auth?.uid ?? null,
    at: new Date().toISOString(),
  }
})
