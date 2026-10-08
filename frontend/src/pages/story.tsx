import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clapperboard, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { ExplainError } from '../components/explain-error'
import { ErrorState, LoadingList } from '../components/states'
import { Btn, Card, Field, PageHeader, StatusBadge } from '../components/ui'

const FLOW = ['Ý tưởng', 'Kịch bản', 'Cảnh', 'Hình', 'Giọng đọc', 'Phụ đề', 'Dựng', 'Kiểm định']

export function StoryProjectsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [name, setName] = useState('')
  const [idea, setIdea] = useState('')

  const create = useMutation({
    mutationFn: () => api.createProject({ name: name.trim(), description: idea.trim(), factory_type: 'story' }),
    onSuccess: (res) => {
      setName('')
      setIdea('')
      qc.invalidateQueries({ queryKey: ['projects'] })
      // Real project id from the API, not a locally invented one.
      navigate(`/story/${res.data.id}`)
    },
  })

  if (projects.isPending) return <LoadingList rows={3} />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />

  const empty = projects.data.data.length === 0
  const canCreate = name.trim().length > 0 && !create.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        title="Story Factory"
        sub={`${projects.data.data.length} dự án`}
      />

      {empty ? (
        <section className="card hero-panel !px-5 !py-7">
          <h2 className="flex items-center gap-2 text-[17px] font-bold">
            <Sparkles className="h-[18px] w-[18px] text-accent" aria-hidden="true" />
            Bạn bắt đầu một video ở đây
          </h2>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-secondary">
            Nhập một ý tưởng. Nhà máy sẽ viết kịch bản, chia cảnh, tạo hình và giọng đọc,
            dựng video rồi kiểm định trước khi bạn duyệt đăng.
          </p>
          <ol className="mt-3.5 flex flex-wrap items-center gap-1.5">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1 text-[11px] font-semibold text-secondary">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-elevated font-mono text-[9px] font-bold text-accent">
                    {i + 1}
                  </span>
                  {s}
                </span>
                {i < FLOW.length - 1 ? <span aria-hidden="true" className="text-muted">→</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Card>
        <h2 className="section-title mb-1 flex items-center gap-2">
          <Plus className="h-4 w-4 text-accent" aria-hidden="true" />
          {empty ? 'Tạo Story đầu tiên' : 'Tạo Story mới'}
        </h2>
        <p className="mb-3 text-[13px] text-secondary">
          {empty ? 'Chỉ cần tên và ý tưởng. Phần còn lại nhà máy lo.' : 'Mỗi dự án là một video hoàn chỉnh.'}
        </p>
        <div className="flex flex-col gap-2">
          <Field
            aria-label="Tên câu chuyện"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên câu chuyện — ví dụ: Mèo Mộc đi tìm mẹ"
          />
          <Field
            aria-label="Ý tưởng"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="Ý tưởng — ví dụ: một chú mèo dũng cảm rời nhà đi tìm mẹ trong khu rừng sương"
          />
          <div>
            <Btn variant="accent" busy={create.isPending} disabled={!canCreate} onClick={() => create.mutate()}>
              {empty ? 'Tạo Story' : 'Tạo dự án'}
            </Btn>
          </div>
        </div>
        {create.isError ? (
          <div className="mt-3">
            <ExplainError
              what="Không tạo được dự án."
              error={create.error}
              todo={name.trim() ? 'Kiểm tra lại tên và thử lại.' : 'Nhập tên câu chuyện trước khi tạo.'}
              onRetry={() => create.mutate()}
            />
          </div>
        ) : null}
      </Card>

      {empty ? null : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.data.map((p) => (
            <li key={p.id} className="row-item row-item-hover group !p-4">
              <Link to={`/story/${p.id}`} className="block">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-panel text-secondary transition-colors duration-hover group-hover:border-ink/30 group-hover:text-accent" aria-hidden="true">
                    <Clapperboard className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold">{p.name}</p>
                      <StatusBadge value={p.status} raw={false} className="shrink-0" />
                    </div>
                    {p.description ? <p className="mt-1 line-clamp-2 text-[13px] text-secondary">{p.description}</p> : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="text-[12px] text-muted">
                        {p.audience || 'chưa rõ khán giả'} · {p.duration_target}s
                      </p>
                      <Btn
                        variant="link"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (window.confirm(`Xoá "${p.name}"? Toàn bộ cảnh, file và lịch sử sẽ bị xóa, không khôi phục được.`)) {
                            api.deleteProject(p.id).then(() => qc.invalidateQueries({ queryKey: ['projects'] }))
                          }
                        }}
                      >
                        Xoá
                      </Btn>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}