// laneSchedule.ts — the order the interaction sampler drains its lanes to the reporter.
// Paint lanes fill out of order (whichever crosses its budget first); replaying them
// on this fixed schedule reassembles the reference table deterministically per browser.
export const LANE_EMIT_ORDER = [2,5,0,3,1,4]
