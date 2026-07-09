// useProductCtx — separate file satisfies react/only-export-components rule.
import { useContext } from 'react'
import { Ctx } from './ProductContext'

export function useProductCtx() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useProductCtx must be used inside ProductProvider')
  return ctx
}
