// CommandBar — realtime search input with an optional structured-token layer.
//
// Primary behavior is a smart, realtime search box: as you type, the free-text portion
// filters the current page's results live (debounced), scoped to that page. A Fuse
// typeahead resolves partial input against the active schema with no network call, so
// "opt cov" surfaces Optional Coverage Eligibility. Structured tokens still work
// (status:Active, sub:"Base Coverage", state:CA): pressing Enter (or picking a
// suggestion) lands them as visible, editable chips while the free text keeps filtering.
// Keyboard-first: Down/Up navigate suggestions, Enter applies, Backspace on an empty
// input removes the last active filter, Esc closes the typeahead.
//
// Entity-agnostic: it renders entirely from the schema and commits through the engine's
// applyState — structured tokens land as chips, never a hidden query.

import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { IconSearch } from '../../components/ui/icons'
import type { FacetSchema, FilterState } from './facetTypes'
import { createSchemaIndex } from './schemaIndex'
import { buildChips } from './filterEngine'
import { mergeStates, removeChip } from './stateOps'
import { type Suggestion, applySuggestion, buildSuggestionCorpus, parseCommandInput } from './tokenParse'

interface CommandBarProps<T> {
  schema:     FacetSchema<T>
  state:      FilterState
  applyState: (next: FilterState) => void
  placeholder?: string
  autoFocus?:   boolean
}

export function CommandBar<T>({ schema, state, applyState, placeholder = 'Search or filter…', autoFocus }: CommandBarProps<T>) {
  const index = useMemo(() => createSchemaIndex(schema), [schema])
  const corpus = useMemo(() => buildSuggestionCorpus(index), [index])
  const fuse = useMemo(() => new Fuse(corpus, { keys: ['keywords'], threshold: 0.4, ignoreLocation: true }), [corpus])

  const [input, setInput] = useState(state.text)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const listId = useRef(`cmd-list-${Math.random().toString(36).slice(2, 8)}`).current

  // Always read the freshest committed state inside async/debounced closures.
  const stateRef = useRef(state)
  stateRef.current = state
  // The last text value THIS bar committed — lets us tell our own live update apart from
  // an external change (Clear all, chip removal, a saved view) so we don't fight the URL.
  const ownText = useRef(state.text)

  // Reflect external text changes back into the box (e.g. Clear all, removing the text
  // chip, applying a saved view). Skipped when the change is one we just made ourselves.
  useEffect(() => {
    if (state.text !== ownText.current) { setInput(state.text); ownText.current = state.text }
  }, [state.text])

  // Realtime: debounce-apply the free-text residual of the input as the text filter. Tokens
  // are stripped (they apply as chips on Enter/select); only the free words filter live.
  useEffect(() => {
    const residual = parseCommandInput(index, input).additions.text
    if (residual === stateRef.current.text) { ownText.current = residual; return }
    const t = setTimeout(() => {
      ownText.current = residual
      applyState({ ...stateRef.current, text: residual })
    }, 160)
    return () => clearTimeout(t)
  }, [input, index, applyState])

  // Strip recognized "key:" prefixes so the fuzzy match runs against the value the user
  // is typing ("status:Act" -> "Act", "opt cov" -> "opt cov").
  const searchStr = input.replace(/[\w-]+:/g, ' ').trim()
  const suggestions = useMemo<Suggestion[]>(
    () => (searchStr ? fuse.search(searchStr).slice(0, 8).map((r) => r.item) : []),
    [fuse, searchStr],
  )

  useEffect(() => { setHighlight(-1) }, [searchStr])
  const showList = open && suggestions.length > 0

  function accept(s: Suggestion) {
    // Add the chosen facet as a chip and clear the box (the typed text was only there to
    // find the facet). Committing text: '' keeps the live effect from re-applying it.
    const base = { ...stateRef.current, text: '' }
    applyState(mergeStates(base, applySuggestion(index, base, s)))
    ownText.current = ''
    setInput(''); setOpen(false); setHighlight(-1)
  }

  // Enter with no suggestion highlighted: apply any complete structured tokens as chips and
  // strip them from the box, leaving the free text (which keeps filtering live).
  function commitTokens() {
    const { additions } = parseCommandInput(index, input)
    const structured =
      Object.keys(additions.enums).length + Object.keys(additions.hierarchies).length + Object.keys(additions.dateRanges).length
    if (structured) {
      const base = stateRef.current
      applyState(mergeStates(base, { ...additions, text: base.text }))
      setInput(additions.text)   // keep just the free text; live effect keeps text in sync
    }
    setOpen(false); setHighlight(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (showList && highlight >= 0) accept(suggestions[highlight]!); else commitTokens() }
    else if (e.key === 'Escape') { if (open) { setOpen(false); setHighlight(-1) } else setInput('') }
    else if (e.key === 'Backspace' && input === '') {
      const chips = buildChips(index, stateRef.current)
      if (chips.length) applyState(removeChip(index, stateRef.current, chips[chips.length - 1]!))
    }
  }

  return (
    <div className="relative">
      <div
        className="glass flex items-center gap-2 h-9 pl-3 pr-2 rounded-[10px] focus-within:ring-2 focus-within:ring-accent/30 transition-shadow"
        style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-chip)' }}
      >
        <IconSearch size={15} className="text-faint shrink-0" aria-hidden="true" />
        <input
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => { setInput(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
          className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder:text-faint focus:outline-none"
          aria-label={placeholder}
        />
        <kbd className="hidden sm:inline text-[10px] text-faint px-1.5 py-0.5 rounded-[4px] bg-[var(--color-chip)] shrink-0" aria-hidden="true">/ to filter</kbd>
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="glass absolute z-30 mt-1.5 left-0 right-0 max-h-72 overflow-y-auto rounded-[12px] p-1 facet-reveal list-none m-0"
          style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-dropdown)' }}
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.facetId}:${s.axis}:${s.value}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => { e.preventDefault(); accept(s) }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] cursor-pointer text-sm ${i === highlight ? 'bg-accent-soft' : ''}`}
            >
              <span className={`flex-1 min-w-0 truncate ${i === highlight ? 'text-accent font-medium' : 'text-text'}`}>{s.label}</span>
              <span className="text-[10px] text-faint uppercase tracking-wide shrink-0">{s.group}</span>
              <code className="text-[10px] text-faint font-mono shrink-0 hidden md:inline">{s.token}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
