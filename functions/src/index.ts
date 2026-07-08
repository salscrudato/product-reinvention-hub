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
export { reindexGrounding } from './retrieval/indexer'
// Invalidation triggers (Part B) — re-index chunks + evict stale summaries/cache on entity write.
export {
  onProductWrite, onCoverageWrite, onRuleWrite, onFormRuleWrite, onRatingProgramWrite,
  onFormWrite, onDictionaryWrite, onLdTableWrite, onRtTableWrite,
} from './invalidate'
