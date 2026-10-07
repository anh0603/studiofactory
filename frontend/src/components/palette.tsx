import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUi } from '../stores/ui'
import { t } from '../i18n/strings.vi'

type Cmd = { label: string; hint: string; to: string; keys: string }

const COMMANDS: Cmd[] = [
  { label: 'nav.dashboard', hint: '', to: '/', keys: 'bang dieu khien dashboard' },
  { label: 'nav.story.projects', hint: 'nav.story', to: '/story', keys: 'du an story' },
  { label: 'nav.affiliate.products', hint: 'nav.affiliate', to: '/affiliate', keys: 'san pham' },
  { label: 'nav.queue', hint: 'nav.automation', to: '/queue', keys: 'hang doi tac vu' },
  { label: 'nav.autopilot', hint: 'nav.automation', to: '/autopilot', keys: 'tu lai auto pilot' },
  { label: 'nav.scheduler', hint: 'nav.automation', to: '/scheduler', keys: 'lich dang' },
  { label: 'nav.publisher', hint: 'nav.automation', to: '/publisher', keys: 'dang bai' },
  { label: 'nav.ai.models', hint: 'nav.ai', to: '/ai/models', keys: 'kho mo hinh ai' },
  { label: 'nav.ai.router', hint: 'nav.ai', to: '/ai/router', keys: 'bo dinh tuyen' },
  { label: 'nav.analytics.overview', hint: 'nav.analytics', to: '/analytics', keys: 'so lieu phan tich' },
  { label: 'nav.diagnostics', hint: 'nav.system', to: '/diagnostics', keys: 'chan doan he thong' },
  { label: 'nav.settings', hint: 'nav.system', to: '/settings', keys: 'cai dat giao dien thu muc' },
]

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function CommandPalette() {
  const { paletteOpen, setPalette } = useUi()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)

  const list = useMemo(() => {
    const nq = norm(q.trim())
    if (!nq) return COMMANDS
    return COMMANDS.filter((c) => norm(`${t(c.label as never)} ${c.keys} ${c.to}`).includes(nq))
  }, [q])

  useEffect(() => {
    if (paletteOpen) { setQ(''); setActive(0) }
  }, [paletteOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette(!useUi.getState().paletteOpen)
        return
      }
      if (!useUi.getState().paletteOpen) return
      if (e.key === 'Escape') setPalette(false)
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
      if (e.key === 'Enter' && list[active]) {
        e.preventDefault()
        setPalette(false)
        navigate(list[active].to)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette, navigate, list, active])

  if (!paletteOpen) return null
  return (
    <div
      role="dialog"
      aria-label={t('palette.title')}
      className="fixed inset-0 z-40 animate-fade-rise bg-black/65 p-4 pt-[12vh]"
      onClick={() => setPalette(false)}
    >
      <div
        className="mx-auto max-w-lg animate-panel-in overflow-hidden rounded-xl border border-border bg-chrome shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0) }}
          placeholder={t('palette.title')}
          aria-label={t('palette.title')}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {list.length === 0 ? (
            <li className="px-3 py-4 text-center text-[13px] text-secondary">{t('state.empty')}</li>
          ) : list.map((c, i) => (
            <li key={c.to}>
              <button
                onClick={() => { setPalette(false); navigate(c.to) }}
                onMouseEnter={() => setActive(i)}
                className={
                  `flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] ` +
                  (i === active ? 'bg-raised text-ink' : 'text-secondary')
                }
              >
                <span className="font-medium">{t(c.label as never)}</span>
                <span className="mono text-muted">{c.to}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">{t('palette.hint')}</p>
      </div>
    </div>
  )
}
