import { useEffect, useState } from 'react'

// The console's color scheme, a per-browser preference: dark unless the
// viewer picks otherwise, or follows the system.

export const themes = ['dark', 'light', 'system'] as const
export type Theme = (typeof themes)[number]

const key = 'theme'
const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

const isTheme = (value: unknown): value is Theme =>
  themes.includes(value as Theme)

// Storage can be unavailable (private windows, blocked site data).
const stored = (): Theme => {
  try {
    const value = localStorage.getItem(key)
    return isTheme(value) ? value : 'dark'
  } catch {
    return 'dark'
  }
}

const apply = (theme: Theme) => {
  const dark = theme === 'dark' || (theme === 'system' && systemDark.matches)
  document.documentElement.classList.toggle('dark', dark)
}

// Run once before the first render, so the page paints in the right scheme.
export const applyStoredTheme = () => apply(stored())

export const useTheme = () => {
  const [theme, setTheme] = useState(stored)

  useEffect(() => {
    apply(theme)
    try {
      localStorage.setItem(key, theme)
    } catch {}
    if (theme !== 'system') return
    const follow = () => apply(theme)
    systemDark.addEventListener('change', follow)
    return () => systemDark.removeEventListener('change', follow)
  }, [theme])

  return [theme, setTheme] as const
}
