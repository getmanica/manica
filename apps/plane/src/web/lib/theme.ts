import { useEffect, useState } from 'react'

// The console's color scheme, a per-browser preference: dark unless the
// viewer picks otherwise, or follows the system. The server can't know it,
// so it renders dark and `themeScript` corrects it before the first paint.

export const themes = ['dark', 'light', 'system'] as const
export type Theme = (typeof themes)[number]

const key = 'theme'

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

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)')

const apply = (theme: Theme) => {
  const dark = theme === 'dark' || (theme === 'system' && systemDark().matches)
  document.documentElement.classList.toggle('dark', dark)
}

// Inlined in the document's head: applies the stored theme before the page
// paints, the way `apply` does.
export const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(key)});document.documentElement.classList.toggle('dark',t!=='light'&&(t!=='system'||matchMedia('(prefers-color-scheme: dark)').matches))}catch(e){}`

// The viewer's theme, unknown until mounted (it's in the browser's storage).
export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>()

  useEffect(() => setTheme(stored()), [])

  useEffect(() => {
    if (!theme) return
    apply(theme)
    try {
      localStorage.setItem(key, theme)
    } catch {}
    if (theme !== 'system') return
    const follow = () => apply(theme)
    const media = systemDark()
    media.addEventListener('change', follow)
    return () => media.removeEventListener('change', follow)
  }, [theme])

  return [theme, setTheme] as const
}
