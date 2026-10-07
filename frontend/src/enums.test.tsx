import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { StatusBadge } from './components/ui'
import { artifactKindVi, enumVi, hasEnum, planOriginVi, qcCheckVi, sceneStatusVi } from './i18n/enums.vi'
import { statusVi } from './i18n/strings.vi'
import { Workspace } from './story/workspaces'
import type { WorkspaceProps } from './story/workspaces'
import type { StepId } from './story/workflow'

const noop = async () => undefined

function baseProps(step: StepId, over: Partial<WorkspaceProps> = {}): WorkspaceProps {
  return {
    activeStep: step,
    saveProject: vi.fn(), saveProjectPending: false, saveProjectError: null, retrySaveProject: vi.fn(),
    project: { id: 'p1', name: 'D', description: 'Ý', factory_type: 'story', language: 'vi', style: '', audience: '', duration_target: 30, status: 'DRAFT' },
    projectId: 'p1', scenes: [], artifacts: [], plans: [], characters: [], schedules: [],
    qc: null, busyStep: null,
    onStepBusy: vi.fn(), onRefresh: vi.fn(), onStep: vi.fn(), act: vi.fn(), planActing: false,
    createPlan: vi.fn(), planPending: false, planError: null, onRetryPlan: vi.fn(),
    runQc: vi.fn(), qcPending: false, qcError: null,
    addCharacter: vi.fn(), characterPending: false,
    genMedia: noop, genSubtitle: noop, renderScene: noop, renderProject: noop,
    exportProject: async () => 'x', createScene: vi.fn(), scenePending: false,
    createSchedule: vi.fn(), schedulePending: false, cancelSchedule: vi.fn(),
    ...over,
  }
}
const renderWs = (p: WorkspaceProps) => render(<MemoryRouter><Workspace {...p} /></MemoryRouter>)
const scene = (id: string, order: number, status: string) =>
  ({ id, order, description: `C${order}`, dialogue: '', status }) as never
const artifact = (kind: string, sceneId: string | null, extra: object = {}) =>
  ({ id: `${kind}${sceneId ?? 'p'}`, kind, scene_id: sceneId, bytes: 2048, path: '', sha256: '', mime: '', provider: '', model: '', ...extra }) as never

describe('scene.status translation', () => {
  it.each([
    ['DRAFT', 'Bản nháp'],
    ['PLANNED', 'Đã lên kế hoạch'],
    ['REVIEW_REQUIRED', 'Cần duyệt'],
    ['APPROVED', 'Đã duyệt'],
  ])('maps %s to "%s"', (raw, vi) => {
    expect(sceneStatusVi[raw]).toBe(vi)
  })

  it.each(['DRAFT', 'PLANNED', 'REVIEW_REQUIRED', 'APPROVED'])('renders %s in Vietnamese, never raw', (raw) => {
    renderWs(baseProps('SCENES', { scenes: [scene('s1', 1, raw)] }))
    expect(screen.getByText(sceneStatusVi[raw])).toBeTruthy()
    expect(screen.queryByText(new RegExp(`\\b${raw}\\b`))).toBeNull()
  })

  it('falls back to "Chưa khả dụng" for an unknown scene status', () => {
    expect(enumVi('SOMETHING_NEW', sceneStatusVi)).toBe('Chưa khả dụng')
    renderWs(baseProps('SCENES', { scenes: [scene('s1', 1, 'SOMETHING_NEW')] }))
    expect(screen.getByText('Chưa khả dụng')).toBeTruthy()
    expect(screen.queryByText('SOMETHING_NEW')).toBeNull()
  })
})

describe('StatusBadge never leaks a raw enum', () => {
  it('shows "Chưa khả dụng" for an unmapped value and keeps it in title', () => {
    render(<StatusBadge value="TOTALLY_UNKNOWN" />)
    expect(screen.getByText('Chưa khả dụng')).toBeTruthy()
    expect(screen.queryByText('TOTALLY_UNKNOWN')).toBeNull()
  })

  it('does not print the raw code next to the label when raw={false}', () => {
    render(<StatusBadge value="PLANNED" raw={false} />)
    expect(screen.getByText('Đã lên kế hoạch')).toBeTruthy()
    expect(screen.queryByText('PLANNED')).toBeNull()
  })

  it('covers every status Story Detail can receive', () => {
    const needed = ['DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'PLANNED', 'REVIEW_REQUIRED',
      'LOCKED', 'UNSUPPORTED', 'PASS', 'FAIL', 'BLOCKED', 'SCHEDULED', 'MISSED', 'DISPATCHED']
    needed.forEach((v) => expect(statusVi[v], `missing vi for ${v}`).toBeTruthy())
  })
})

describe('plan origin', () => {
  const plan = (origin?: string) =>
    ({ id: 'd1', project_id: 'p1', version: 1, status: 'APPROVED', origin, mock: false, request_id: 'r', provider: 'p', model: 'm', plan: { title: 'T' } }) as never

  it('labels GENERATED with its real meaning', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan('GENERATED')] }))
    expect(screen.getByText(/Tạo bởi AI/)).toBeTruthy()
  })

  it('does not claim Auto Pilot for GENERATED', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan('GENERATED')] }))
    // Backends writes origin=GENERATED for both manual and autopilot paths,
    // so an Auto Pilot badge here would be a lie.
    expect(screen.queryByText(/Auto Pilot/)).toBeNull()
  })

  it('renders no origin text when origin is missing', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan(undefined)] }))
    expect(screen.queryByText('Chưa khả dụng')).toBeNull()
  })

  it('renders no origin text for an unmapped origin', () => {
    renderWs(baseProps('DIRECTOR', { plans: [plan('SOMETHING_ELSE')] }))
    expect(screen.queryByText('SOMETHING_ELSE')).toBeNull()
  })

  it.each([
    ['GENERATED', 'Tạo bởi AI'],
    ['REGENERATED', 'Tạo lại toàn bộ'],
    ['SECTION_REGENERATED', 'Tạo lại một phần'],
    ['USER_EDITED', 'Chỉnh sửa thủ công'],
  ])('maps origin %s', (raw, vi) => expect(planOriginVi[raw]).toBe(vi))
})

describe('artifact kind and qc check translation', () => {
  it('maps artifact kinds and falls back safely', () => {
    expect(artifactKindVi.IMAGE).toBe('Hình ảnh')
    expect(artifactKindVi.SUBTITLE).toBe('Phụ đề')
    expect(enumVi('WEIRD', artifactKindVi)).toBe('Chưa khả dụng')
  })

  it('maps qc check status', () => {
    expect(qcCheckVi.PASS).toBe('Đạt')
    expect(qcCheckVi.REVIEW).toBe('Cần xem lại')
    expect(qcCheckVi.FAIL).toBe('Chưa đạt')
  })

  it('never shows an artifact kind outside the workspace filter', () => {
    renderWs(baseProps('MEDIA', {
      scenes: [scene('s1', 1, 'PLANNED')],
      artifacts: [
        artifact('MYSTERY', 's1', { bytes: 100 }),
        artifact('IMAGE', 's1', { bytes: 100 }),
      ],
    }))
    expect(screen.queryByText(/MYSTERY/)).toBeNull()
    expect(screen.getByText((_c, el) => el?.tagName === 'SPAN' && /Hình ảnh · 100 B/.test(el.textContent ?? ''))).toBeTruthy()
  })

  it('hasEnum gates the badge', () => {
    expect(hasEnum('GENERATED', planOriginVi)).toBe(true)
    expect(hasEnum('NOPE', planOriginVi)).toBe(false)
    expect(hasEnum(undefined, planOriginVi)).toBe(false)
  })
})