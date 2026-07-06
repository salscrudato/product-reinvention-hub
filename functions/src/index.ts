// functions/src/index.ts — re-exports every Cloud Function.
// Add new function modules here as they are implemented.
export { hello } from './health'
export { createShareLink, getShareSnapshot, share } from './share'
export { chat } from './ai'
export { extractCoverages } from './extract'
export { analyzeClaim, identifyBaseForm } from './claims'
export { setUserRole } from './admin'
export { refreshNews, nightlyNews } from './news'
