// functions/src/index.ts — re-exports every Cloud Function.
// Add new function modules here as they are implemented.
export { hello } from './health'
export { chat } from './ai'
export { draftRule } from './rules'
export { scaffoldProduct } from './scaffoldProduct'
export { extractCoverages } from './extract'
export { summarizeProduct } from './summarize'
export { analyzeClaim, identifyBaseForm } from './claims'
export { setUserRole } from './admin'
export { refreshNews, nightlyNews } from './news'
export { describeForm } from './describeForm'
export { createShare, getShare } from './share'
export { reindexGrounding } from './retrieval/indexer'
