import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyState, ErrorState, LoadingState } from '../components/states'

export function StoryProjectsPage() {
  const qc = useQueryClient()
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects })
  const [name, setName] = useState('')
  const [idea, setIdea] = useState('')

  const create = useMutation({
    mutationFn: () => api.createProject({ name, description: idea }),
    onSuccess: () => {
      setName('')
      setIdea('')
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  if (projects.isPending) return <LoadingState />
  if (projects.isError)
    return <ErrorState message={(projects.error as Error).message} onRetry={() => projects.refetch()} />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Story Factory</h1>
      {projects.data.data.length === 0 ? (
        <EmptyState title="Chưa có project. Tạo story đầu tiên của bạn." />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {projects.data.data.map((p) => (
            <li key={p.id} className="rounded border border-border bg-surface p-3 text-sm">
              <Link to={`/story/${p.id}`} className="font-semibold text-ink hover:text-accent">
                {p.name}
              </Link>
              <p className="text-xs text-secondary">
                {p.status} · {p.audience || '—'} · {p.duration_target}s
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Tên project"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên story..."
          className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
        />
        <input
          aria-label="Ý tưởng"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Ý tưởng mô tả..."
          className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
        />
        <button
          disabled={!name || create.isPending}
          onClick={() => create.mutate()}
          className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
        >
          Tạo project
        </button>
      </div>
      {create.isError ? (
        <p role="alert" className="text-sm text-accent">
          Tạo thất bại: {(create.error as Error).message} (request_id:{' '}
          {(create.error as { requestId?: string }).requestId})
        </p>
      ) : null}
    </div>
  )
}
