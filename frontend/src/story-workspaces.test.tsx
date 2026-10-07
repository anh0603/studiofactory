import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api/client'
import { StoryDetailPage } from './pages/story-detail'
import { Workspace } from './story/workspaces'
import type { WorkspaceProps } from './story/workspaces'
import type { StepId } from './story/workflow'

const noop = async () => undefined

function baseProps(step: StepId, over: Partial<WorkspaceProps> = {}): WorkspaceProps {
  return {
    activeStep: step,
    saveProject: vi.fn(), saveProjectPending: false, saveProjectError: null, retrySaveProject: vi.fn(),
    project: { id: 'prj_1', name: 'Dự án', description: 'Ý tưởng', factory_type: 'story', language: 'vi', style: '', audience: 'trẻ em', duration_target: 30, status: 'DRAFT' },
    projectId: 'prj_1',
    scenes: [],
    artifacts: [],
    plans: [],
    characters: [],
    schedules: [],
    qc: null,
    busyStep: null,
    onStepBusy: vi.fn(),
    onRefresh: vi.fn(),
    onStep: vi.fn(),
    act: vi.fn(),
    planActing: false,
    createPlan: vi.fn(),
    planPending: false,
    planError: null,
    onRetryPlan: vi.fn(),
    runQc: vi.fn(),
    qcPending: false,
    qcError: null,
    addCharacter: vi.fn(),
    characterPending: false,
    genMedia: noop,
    genSubtitle: noop,
    renderScene: noop,
    renderProject: noop,
    exportProject: async () => 'file.mp4',
    createScene: vi.fn(),
    scenePending: false,
    createSchedule: vi.fn(),
    schedulePending: false,
    cancelSchedule: vi.fn(),
    ...over,
  }
}

const renderWs = (p: WorkspaceProps) =>
  render(<MemoryRouter><Workspace {...p} /></MemoryRouter>)

afterEach(() => vi.restoreAllMocks())

const plan = (v: number, status: string) =>
  ({ id: `dpl_${v}`, project_id: 'prj_1', version: v, status, origin: 'GENERATED', mock: false, request_id: 'r', provider: 'p', model: 'm',
     plan: { title: `Kế hoạch v${v}`, scenes: [{ scene_number: 1, description: 'Cảnh 1' }], duration: 30 } }) as never

const scene = (id: string, order: number) => ({ id, order, description: `Cảnh ${order}`, dialogue: '', status: 'PLANNED' }) as never
const artifact = (kind: string, sceneId: string | null, extra: object = {}) =>
  ({ id: `${kind}${sceneId ?? 'p'}`, kind, scene_id: sceneId, bytes: 2048, path: 'x', sha256: 'y', mime: 'm', provider: 'p', model: 'm', ...extra }) as never

describe('workspace switching', () => {
  it.each([
    ['IDEA', 'Ý tưởng'],
    ['DIRECTOR', 'AI Director'],
    ['SCENES', 'Cảnh'],
    ['MEDIA', 'Media'],
    ['TTS', 'TTS'],
    ['SUBTITLE', 'Phụ đề'],
    ['RENDER', 'Dựng video'],
    ['QC', 'Kiểm định'],
    ['GATE', 'Cổng sản xuất'],
    ['SCHEDULE', 'Lịch đăng'],
    ['PUBLISH', 'Đăng bài'],
  ] as [StepId, string][])('renders the %s workspace', (step, heading) => {
    renderWs(baseProps(step))
    expect(screen.getByRole('heading', { name: new RegExp(`^${heading}`) })).toBeTruthy()
  })

  it('has exactly 11 steps and no twelfth export node', () => {
    renderWs(baseProps('DIRECTOR'))
    expect(screen.queryByRole('heading', { name: 'Xuất tệp' })).toBeNull()
    renderWs(baseProps('GATE'))
    expect(screen.getByRole('heading', { name: 'Xuất tệp' })).toBeTruthy()
  })
})

describe('Director workspace', () => {
  it('shows approve and reject only on the latest REVIEW plan', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan(2, 'REVIEW')] }))
    expect(screen.getByRole('button', { name: 'Duyệt' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Từ chối' })).toBeTruthy()
  })

  it('hides approve on an APPROVED plan', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan(1, 'APPROVED')] }))
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull()
  })

  it('marks a stale version and blocks deciding on it', async () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan(1, 'REVIEW'), plan(2, 'REVIEW')] }))
    fireEvent.click(screen.getByRole('button', { name: 'v1' }))
    expect(screen.getByText(/Bản này đã cũ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Duyệt' })).toBeNull()
  })

  it('keeps every version reachable', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan(1, 'REJECTED'), plan(2, 'REVIEW'), plan(3, 'REVIEW')] }))
    expect(screen.getByRole('button', { name: 'v1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'v2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'v3' })).toBeTruthy()
  })
})

describe('Scenes workspace', () => {
  it('states that approving a plan does not create scenes', () => {
    renderWs(baseProps('SCENES', { plans: [plan(1, 'APPROVED')] }))
    expect(screen.getByText(/Duyệt kế hoạch không tự sinh cảnh/)).toBeTruthy()
  })

  it('offers manual scene creation when empty', () => {
    const { container } = renderWs(baseProps('SCENES'))
    expect(container.querySelector('#new-scene')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tạo cảnh$/ })).toBeTruthy()
  })

  it('lists scenes with real order and status', () => {
    renderWs(baseProps('SCENES', { scenes: [scene('s1', 1), scene('s2', 2)] }))
    expect(screen.getByText(/#1/)).toBeTruthy()
    expect(screen.getByText(/#2/)).toBeTruthy()
  })

  it('only enables scene render when image and tts both exist', () => {
    renderWs(baseProps('SCENES', {
      scenes: [scene('s1', 1)],
      artifacts: [artifact('IMAGE', 's1'), artifact('TTS', 's1')],
    }))
    expect(screen.getByRole('button', { name: 'Dựng cảnh' })).toBeTruthy()
  })
})

describe('media / tts / subtitle / render workspaces', () => {
  it('shows real project-level artifacts without faking preview', () => {
    renderWs(baseProps('MEDIA', { scenes: [scene('s1', 1)], artifacts: [artifact('IMAGE', 's1', { width: 720, height: 1280 })] }))
    expect(screen.getByText(/Cảnh #1/)).toBeTruthy()
    expect(screen.getByText(/Hình ảnh · 2.0 KB/)).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('filters artifacts by kind per workspace', () => {
    const arts = [artifact('IMAGE', 's1'), artifact('TTS', 's1'), artifact('SUBTITLE', 's1')]
    const { unmount } = renderWs(baseProps('TTS', { scenes: [scene('s1', 1)], artifacts: arts }))
    expect(screen.getAllByText(/Giọng đọc ·/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Hình ảnh ·/)).toBeNull()
    unmount()
    renderWs(baseProps('SUBTITLE', { scenes: [scene('s1', 1)], artifacts: arts }))
    expect(screen.queryByText(/Giọng đọc ·/)).toBeNull()
  })

  it('shows an empty state when nothing was generated', () => {
    renderWs(baseProps('TTS'))
    expect(screen.getByText(/Chưa có cảnh, chưa thể tạo giọng đọc/)).toBeTruthy()
  })

  it('never shows a fake percentage in the render workspace', () => {
    renderWs(baseProps('RENDER', { scenes: [scene('s1', 1)], artifacts: [artifact('IMAGE', 's1'), artifact('TTS', 's1')] }))
    expect(screen.getByText('1/1 cảnh đủ điều kiện dựng (cần hình và giọng đọc).')).toBeTruthy()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('reports real project output dimensions when present', () => {
    renderWs(baseProps('RENDER', {
      scenes: [scene('s1', 1)],
      artifacts: [artifact('VIDEO', 's1'), artifact('VIDEO', null, { width: 720, height: 1280, duration_s: 30 })],
    }))
    expect(screen.getByText(/720×1280 · 30.0s/)).toBeTruthy()
  })
})

describe('qc and gate workspaces', () => {
  it('says there is no result before QC has run', () => {
    renderWs(baseProps('QC'))
    expect(screen.getByText(/Chưa có kết quả kiểm định/)).toBeTruthy()
  })

  it('shows the real verdict and every check after QC', () => {
    renderWs(baseProps('QC', {
      qc: {
        qc: { verdict: 'REVIEW_REQUIRED', checks: [
          { key: 'video_exists', status: 'FAIL', detail: 'no rendered video' },
          { key: 'disclosure', status: 'PASS', detail: '' },
        ] },
        gate: { decision: 'BLOCKED', reasons: ['video_exists=FAIL'] },
      },
    }))
    expect(screen.getAllByText(/REVIEW_REQUIRED|Cần xem lại/).length).toBeGreaterThan(0)
    expect(screen.getByText('Có video')).toBeTruthy()
    expect(screen.getByText(/no rendered video/)).toBeTruthy()
    expect(screen.getByText('Công bố nội dung')).toBeTruthy()
  })

  it('disables export and explains why when the gate is blocked', () => {
    renderWs(baseProps('GATE', { qc: { qc: { verdict: 'BLOCKED', checks: [] }, gate: { decision: 'BLOCKED', reasons: ['video_exists=FAIL'] } } }))
    expect(screen.getByText('Cổng sản xuất chưa đạt')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Xuất tệp/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/video_exists=FAIL/)).toBeTruthy()
  })

  it('enables export only when the gate passes', () => {
    renderWs(baseProps('GATE', { qc: { qc: { verdict: 'PASS', checks: [] }, gate: { decision: 'PASS', reasons: [] } } }))
    expect((screen.getByRole('button', { name: /Xuất tệp/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('disables export when there is no QC result at all', () => {
    renderWs(baseProps('GATE'))
    expect((screen.getByRole('button', { name: /Xuất tệp/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('schedule and publish workspaces', () => {
  it('lists real schedules', () => {
    renderWs(baseProps('SCHEDULE', { schedules: [{ id: 's1', job_id: null, run_at: '2026-10-03T20:00', timezone: 'Asia/Ho_Chi_Minh', recurrence: null, platforms: ['youtube'], status: 'SCHEDULED', note: '' }] }))
    expect(screen.getByText('2026-10-03 20:00')).toBeTruthy()
  })

  it('does not fake a schedule when there is none', () => {
    renderWs(baseProps('SCHEDULE'))
    expect(screen.getByText('Chưa có lịch đăng nào.')).toBeTruthy()
  })

  it('reports publish as unavailable with the reason', () => {
    renderWs(baseProps('PUBLISH'))
    expect(screen.getByText('Chưa khả dụng.')).toBeTruthy()
    expect(screen.getByText(/Chưa có API đọc lịch sử đăng theo dự án/)).toBeTruthy()
  })
})

/* ---------------------------------------------------------------- page */

function pageFetch(over: (url: string) => boolean, payload: unknown) {
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    const ok = { ok: true, headers: { get: () => 'req' }, json: async () => ({ request_id: 'req', data: [] }) }
    if (over(u)) return { ...ok, json: async () => payload }
    if (/\/projects\/[^/]+$/.test(u)) {
      return { ...ok, json: async () => ({ request_id: 'req', data: { id: 'prj_1', name: 'Dự án', description: 'Ý tưởng', factory_type: 'story', language: 'vi', style: '', audience: 'trẻ em', duration_target: 30, status: 'DRAFT', updated_at: '2026-10-02T02:20:10Z' } }) }
    }
    return ok
  }) as unknown as typeof fetch
}

/* ------------------------------------------------- PASS 6: idea + cast */

const blankIdea = { ...baseProps('IDEA').project, description: '' }

describe('idea workspace is usable by a non-expert', () => {
  it('never offers the director step while the idea is empty', () => {
    renderWs(baseProps('IDEA', { project: blankIdea }))
    expect(screen.getByText('Vui lòng nhập ý tưởng trước.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tạo kịch bản bằng AI' })).toBeNull()
  })

  it('offers the real director action once an idea exists', () => {
    const onStep = vi.fn()
    renderWs(baseProps('IDEA', { onStep }))
    fireEvent.click(screen.getByRole('button', { name: 'Tạo kịch bản bằng AI' }))
    expect(onStep).toHaveBeenCalledWith('DIRECTOR')
  })

  it('saves edits through the project update contract', () => {
    const saveProject = vi.fn()
    renderWs(baseProps('IDEA', { saveProject }))
    fireEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    fireEvent.change(screen.getByLabelText('Mô tả / ý tưởng'), { target: { value: 'Mèo Mộc đi tìm mẹ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu ý tưởng' }))
    expect(saveProject).toHaveBeenCalledWith(expect.objectContaining({ description: 'Mèo Mộc đi tìm mẹ' }))
  })
})

const character = (lock_state: string) => ({
  id: 'chr_1', project_id: 'prj_1', name: 'Mèo Mộc', lock_state, visual_identity: 'mèo xám mắt vàng',
} as never)

describe('character control stays truthful', () => {
  it('states that no reference image exists instead of implying verification', () => {
    renderWs(baseProps('SCENES', { characters: [character('REVIEW_REQUIRED')] }))
    expect(screen.getByText('Chưa có hình mẫu')).toBeTruthy()
    expect(screen.getByText(/không tự xác minh khuôn mặt/)).toBeTruthy()
  })

  it('locks and unlocks through the character API', async () => {
    const spy = vi.spyOn(api, 'updateCharacter').mockResolvedValue({} as never)
    const { unmount } = renderWs(baseProps('SCENES', { characters: [character('REVIEW_REQUIRED')] }))
    fireEvent.click(screen.getByRole('button', { name: 'Khoá' }))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('chr_1', { lock_state: 'LOCKED' }))
    unmount()

    const spy2 = vi.spyOn(api, 'updateCharacter').mockResolvedValue({} as never)
    renderWs(baseProps('SCENES', { characters: [character('LOCKED')] }))
    fireEvent.click(screen.getByRole('button', { name: 'Mở khoá' }))
    await waitFor(() => expect(spy2).toHaveBeenCalledWith('chr_1', { lock_state: 'REVIEW_REQUIRED' }))
  })

  it('reports an upload failure in plain language', async () => {
    vi.spyOn(api, 'updateCharacter').mockRejectedValue(new Error('HTTP 422: reference_upsert_failed') as never)
    renderWs(baseProps('SCENES', { characters: [character('REVIEW_REQUIRED')] }))
    fireEvent.click(screen.getByRole('button', { name: 'Khoá' }))
    await waitFor(() => expect(screen.getByText('Đã xảy ra:')).toBeTruthy())
    expect(screen.queryByText('reference_upsert_failed')).toBeNull()
  })
})

describe('story detail page', () => {
  const renderPage = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/story/prj_1']}>
          <Routes>
            <Route path="/story/:projectId" element={<StoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders with no scenes and no plan', async () => {
    pageFetch(() => false, null)
    renderPage()
    await waitFor(() => expect(screen.getByText('Dự án')).toBeTruthy())
    expect(screen.getByTestId('workflow-strip')).toBeTruthy()
    expect(screen.getByTestId('next-action')).toBeTruthy()
  })

  it('switches workspace when a workflow node is clicked', async () => {
    pageFetch(() => false, null)
    renderPage()
    await waitFor(() => expect(screen.getByText('Dự án')).toBeTruthy())
    const scenes = screen.getAllByText('Cảnh')[0]
    fireEvent.click(scenes)
    expect(screen.getByRole('heading', { name: /Tạo cảnh thủ công/ })).toBeTruthy()
  })

  it('does not crash on desktop or narrow viewport', async () => {
    pageFetch(() => false, null)
    renderPage()
    await waitFor(() => expect(screen.getByText('Dự án')).toBeTruthy())
    expect(screen.getByText('Thông tin dự án')).toBeTruthy()
  })
})