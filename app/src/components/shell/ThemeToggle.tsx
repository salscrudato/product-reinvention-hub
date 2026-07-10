// ThemeToggle — the shell header control that flips light ⇄ dark.
// Reads/writes the persisted preference via `useTheme`; icon-only, so it carries an
// aria-label + title stating the action it performs.
import { useTheme } from '../../lib/theme'
import { IconSun, IconMoon } from '../ui/icons'

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      onClick={toggle}
      className="flex items-center justify-center w-8 h-8 rounded-[8px] text-dim hover:bg-raised hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      aria-label={label}
      title={label}
    >
      {isDark ? <IconSun size={16} aria-hidden="true" /> : <IconMoon size={16} aria-hidden="true" />}
    </button>
  )
}
