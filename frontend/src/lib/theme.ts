/* Light-first theme. `dark` class on <html> flips the CSS-channel tokens.
 * Stored choice wins; default is light. No flash: index.html pre-applies it. */

export type Theme = 'light' | 'dark'

const KEY = 'sf-theme'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private mode: keep the class, skip persistence */
  }
}

/** Sync <html> with storage on boot (index.html already did the first pass). */
export function initTheme() {
  applyTheme(getTheme())
}
