// Shared domain types consumed by both app and functions.
// Mirrors Firestore collection shapes from docs/DATA_MODEL.md.

export type Status = 'ACTIVE' | 'INACTIVE' | 'FUTURE'
export type Lifecycle = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'
export type ReviewStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BUSINESS_REVIEW' | 'APPROVED' | 'REJECTED'
export type Requirement = 'MANDATORY' | 'OPTIONAL'
export type Source = 'BUREAU' | 'PROPRIETARY'
export type TermKind = 'LIMIT' | 'DEDUCTIBLE' | 'OPTION'
export type Role = 'VIEWER' | 'EDITOR' | 'ADMIN'

export interface GovernanceBlock {
  status: Status
  lifecycle: Lifecycle
  reviewStatus: ReviewStatus
  reviewer?: string
  createdAt: unknown   // Firestore Timestamp in Firebase; string ISO on the wire
  updatedAt: unknown
  updatedBy: string
  rev: number
}

export interface StateScope {
  allStates: boolean
  states: string[]
}

export interface CoverageTerm {
  id: string
  kind: TermKind
  label: string
  ldTableRef?: string
  options?: (string | number)[]
  min?: number
  max?: number
  default: string | number | boolean
  basis: string
  unit?: string
  notes?: string
}

export interface Coverage extends GovernanceBlock, StateScope {
  refId: string | null
  name: string
  parentId: string | null
  order: number
  requirement: Requirement
  claimsBasis: string
  premiumGenerating: boolean
  source: Source
  formNumbers: string[]
  terms: CoverageTerm[]
}

export interface RatingStep {
  id: string
  order: number
  label: string
  op: 'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  source: {
    type: 'RT' | 'LD' | 'INPUT' | 'CONST'
    ref?: string
    keys?: string[]
    value?: number
  }
  condition?: string
  roundTo?: number
}

export interface RatingProgram extends GovernanceBlock, StateScope {
  refId: string
  name: string
  minimumPremium: number
  steps: RatingStep[]
}

export interface LDRow {
  label: string
  value: number
  constraintNote?: string
}

export interface LDTable {
  name: string
  defaultValue?: number
  rows: LDRow[]
}

export interface RTTable {
  name: string
  columns: string[]
  rows: Record<string, unknown>[]
}

export type TaskColumn = 'IDEATION' | 'BUILD_FILE' | 'TEST_APPROVE' | 'LAUNCH_MONITOR'
export type FeedbackType = 'IDEA' | 'ISSUE' | 'PRAISE'
export type FeedbackStatus = 'NEW' | 'REVIEWING' | 'PLANNED' | 'SHIPPED' | 'DECLINED'

// Unsubscribe function returned by realtime subscriptions
export type Unsubscribe = () => void
