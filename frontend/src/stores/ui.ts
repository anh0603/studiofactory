import { create } from 'zustand'

interface Toast {
  id: number
  kind: 'success' | 'warning' | 'error' | 'info'
  title: string
  detail?: string
}

interface UiState {
  toasts: Toast[]
  paletteOpen: boolean
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  setPalette: (open: boolean) => void
}

let seq = 1

/* Minimal global UI state only (toast + palette). No domain state here. */
export const useUi = create<UiState>((set) => ({
  toasts: [],
  paletteOpen: false,
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: seq++ }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  setPalette: (open) => set({ paletteOpen: open }),
}))
