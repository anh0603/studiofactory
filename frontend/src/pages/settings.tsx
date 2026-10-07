import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../api/client'
import { ErrorState, LoadingState } from '../components/states'
import { Btn, Card, Field, PageHeader } from '../components/ui'
import { t } from '../i18n/strings.vi'
import { applyTheme, getTheme, type Theme } from '../lib/theme'

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['app-settings'], queryFn: api.appSettings })
  const [theme, setTheme] = useState<Theme>(() => getTheme())
  const [dir, setDir] = useState('')
  const [dirMsg, setDirMsg] = useState('')
  const [dirBusy, setDirBusy] = useState(false)
  const [dirTouched, setDirTouched] = useState(false)

  const pickTheme = (next: Theme) => {
    setTheme(next)
    applyTheme(next)
  }

  const saveDir = async () => {
    setDirBusy(true)
    setDirMsg('')
    try {
      const res = await api.saveExportDir(dir.trim())
      setDirMsg(
        res.data.export_dir_state === 'OK'
          ? `Đã lưu: ${res.data.export_dir}`
          : `Không dùng được: ${res.data.export_dir_state}`,
      )
      settings.refetch()
    } catch (e) {
      setDirMsg((e as Error & { code?: string }).message)
    } finally {
      setDirBusy(false)
    }
  }

  const clearDir = async () => {
    setDirBusy(true)
    try {
      await api.clearExportDir()
      setDir('')
      setDirMsg('')
      settings.refetch()
    } catch (e) {
      setDirMsg((e as Error).message)
    } finally {
      setDirBusy(false)
    }
  }

  if (settings.isPending && !dirTouched) {
    // Theme section works without backend; show it immediately.
  }

  const current = settings.data?.data

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.settings')} sub="Giao diện và nơi lưu tệp trên máy này" />

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

      <Card>
        <h2 className="section-title mb-1">{t('settings.export.title')}</h2>
        <p className="mb-3 text-[13px] text-secondary">{t('settings.export.hint')}</p>
        {settings.isPending ? <LoadingState /> : null}
        {settings.isError ? (
          <ErrorState message={(settings.error as Error).message} onRetry={() => settings.refetch()} />
        ) : null}
        {current ? (
          <div className="space-y-2.5">
            {current.export_dir ? (
              <p className="rounded-lg border border-border bg-panel px-3 py-2 text-[13px]">
                <span className="text-muted">Đang dùng: </span>
                <span className="mono">{current.export_dir}</span>
                <span className="mono text-muted"> · {current.export_dir_state}</span>
              </p>
            ) : (
              <p className="text-[13px] text-secondary">{t('settings.export.unset')}</p>
            )}
            <Field
              aria-label={t('settings.export.title')}
              value={dirTouched ? dir : (current.export_dir ?? '')}
              onChange={(e) => { setDir(e.target.value); setDirTouched(true) }}
              placeholder={t('settings.export.placeholder')}
              className="mono"
            />
            <div className="flex flex-wrap gap-2">
              <Btn variant="accent" size="sm" busy={dirBusy} disabled={dirBusy} onClick={saveDir}>
                {t('settings.export.save')}
              </Btn>
              {current.export_dir ? (
                <Btn size="sm" disabled={dirBusy} onClick={clearDir}>
                  {t('settings.export.clear')}
                </Btn>
              ) : null}
            </div>
            {dirMsg ? <p className="text-[13px] text-secondary">{dirMsg}</p> : null}
          </div>
        ) : null}
      </Card>
    </div>
  )
}
