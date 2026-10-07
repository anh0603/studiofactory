import { useState } from 'react'
import { Card, PageHeader } from '../components/ui'
import { t } from '../i18n/strings.vi'
import { applyTheme, getTheme, type Theme } from '../lib/theme'

export function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(() => getTheme())

  const pickTheme = (next: Theme) => {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.settings')} sub="Giao diện của phần mềm" />

      <Card>
        <h2 className="section-title mb-1">{t('settings.appearance')}</h2>
        <p className="mb-3 text-[13px] text-secondary">Chọn giao diện sáng hoặc tối. Áp dụng ngay.</p>
        <div className="flex gap-2" role="radiogroup" aria-label={t('settings.appearance')}>
          {(['light', 'dark'] as Theme[]).map((opt) => (
            <button
              key={opt}
              role="radio"
              aria-checked={theme === opt}
              onClick={() => pickTheme(opt)}
              className={
                `flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold ` +
                `transition-colors duration-hover ` +
                (theme === opt
                  ? 'border-accent bg-tint text-ember'
                  : 'border-border bg-panel text-secondary hover:bg-raised hover:text-ink')
              }
            >
              <span
                aria-hidden="true"
                className={`h-4 w-4 rounded-full border ${opt === 'light' ? 'bg-white' : 'bg-[#0B0D10]'} border-muted`}
              />
              {opt === 'light' ? t('settings.theme.light') : t('settings.theme.dark')}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
