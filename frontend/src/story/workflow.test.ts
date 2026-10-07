import { describe, expect, it } from 'vitest'
import {
  activeSteps,
  gateAllowsExport,
  latestPlan,
  nodeTypeToStep,
  projectOutput,
  resolveNextAction,
  resolveWorkflow,
} from './workflow'
import type { ArtifactLite, SceneLite, WorkflowInput } from './workflow'

const scene = (id: string, status = 'PLANNED'): SceneLite => ({ id, order: 1, status, duration_s: 5 })

const art = (kind: string, sceneId: string | null, extra: Partial<ArtifactLite> = {}): ArtifactLite => ({
  id: `${kind}-${sceneId ?? 'project'}`,
  kind,
  scene_id: sceneId,
  bytes: 1000,
  ...extra,
})

function base(over: Partial<WorkflowInput> = {}): WorkflowInput {
  return {
    project: { description: 'Một chú mèo dũng cảm', status: 'DRAFT', duration_target: 30, language: 'vi' },
    plans: [],
    characters: [],
    scenes: [],
    artifacts: [],
    schedules: [],
    activeNodes: [],
    qc: null,
    autopilot: null,
    ...over,
  }
}

const stateOf = (input: WorkflowInput, id: string) => resolveWorkflow(input).find((n) => n.id === id)!.state

describe('workflow resolver', () => {
  it('marks idea complete only when the project actually has a description', () => {
    expect(stateOf(base(), 'IDEA')).toBe('COMPLETED')
    expect(stateOf(base({ project: { description: '  ', status: 'DRAFT', duration_target: 30, language: 'vi' } }), 'IDEA')).toBe('WAITING')
  })

  it('marks director from real plan status', () => {
    expect(stateOf(base(), 'DIRECTOR')).toBe('WAITING')
    expect(stateOf(base({ plans: [{ id: 'p1', version: 2, status: 'REVIEW' }] }), 'DIRECTOR')).toBe('REVIEW')
    expect(stateOf(base({ plans: [{ id: 'p1', version: 2, status: 'APPROVED' }] }), 'DIRECTOR')).toBe('COMPLETED')
    expect(stateOf(base({ plans: [{ id: 'p1', version: 2, status: 'REJECTED' }] }), 'DIRECTOR')).toBe('FAILED')
  })

  it('picks the highest plan version, not the last array entry', () => {
    const plans = [{ id: 'a', version: 1, status: 'REJECTED' }, { id: 'b', version: 3, status: 'REVIEW' }]
    expect(latestPlan(plans)!.version).toBe(3)
    expect(stateOf(base({ plans }), 'DIRECTOR')).toBe('REVIEW')
  })

  it('blocks scenes while the plan is unreviewed, but waits after approval', () => {
    expect(stateOf(base({ plans: [{ id: 'p', version: 1, status: 'REVIEW' }] }), 'SCENES')).toBe('BLOCKED')
    expect(stateOf(base({ plans: [{ id: 'p', version: 1, status: 'APPROVED' }] }), 'SCENES')).toBe('WAITING')
  })

  it('counts media per scene from project-level artifacts', () => {
    const input = base({
      scenes: [scene('s1'), scene('s2'), scene('s3')],
      artifacts: [art('IMAGE', 's1'), art('IMAGE', 's2')],
    })
    const node = resolveWorkflow(input).find((n) => n.id === 'MEDIA')!
    expect(node.state).toBe('WAITING')
    expect(node.count).toBe('2/3')
  })

  it('does not count a scene artifact as project output', () => {
    expect(projectOutput([art('VIDEO', 's1')])).toBeNull()
    expect(projectOutput([art('VIDEO', 's1'), art('VIDEO', null)])!.scene_id).toBeNull()
  })

  it('reports waiting instead of completed when scenes have no image yet', () => {
    expect(stateOf(base({ scenes: [scene('s1')] }), 'MEDIA')).toBe('WAITING')
    expect(stateOf(base({ scenes: [scene('s1')], artifacts: [art('IMAGE', 's1')] }), 'MEDIA')).toBe('COMPLETED')
  })

  it('marks publisher UNAVAILABLE once a schedule was dispatched', () => {
    expect(stateOf(base(), 'PUBLISH')).toBe('WAITING')
    expect(stateOf(base({ schedules: [{ id: 's', status: 'DISPATCHED', run_at: '2026-10-02T20:00' }] }), 'PUBLISH')).toBe('UNAVAILABLE')
  })

  it('treats a missed schedule as needing review', () => {
    expect(stateOf(base({ schedules: [{ id: 's', status: 'MISSED', run_at: 'x' }] }), 'SCHEDULE')).toBe('REVIEW')
  })

  it('never fakes a QC result before it is run', () => {
    expect(stateOf(base({ artifacts: [art('VIDEO', null)] }), 'QC')).toBe('WAITING')
    expect(stateOf(base({ artifacts: [art('VIDEO', null)] }), 'GATE')).toBe('WAITING')
  })

  it('reads qc verdict and gate decision from real result', () => {
    const qc = { qc: { verdict: 'REVIEW_REQUIRED', checks: [] }, gate: { decision: 'BLOCKED', reasons: ['a'] } }
    expect(stateOf(base({ qc }), 'QC')).toBe('REVIEW')
    expect(stateOf(base({ qc }), 'GATE')).toBe('BLOCKED')
    expect(gateAllowsExport(base({ qc }))).toBe(false)
  })

  it('blocks export until the gate passes', () => {
    const blocked = { qc: { verdict: 'BLOCKED', checks: [] }, gate: { decision: 'BLOCKED', reasons: ['a'] } }
    const passed = { qc: { verdict: 'PASS', checks: [] }, gate: { decision: 'PASS', reasons: [] } }
    expect(gateAllowsExport(base({ qc: blocked }))).toBe(false)
    expect(gateAllowsExport(base({ qc: passed }))).toBe(true)
  })
})

describe('node type mapping', () => {
  it('maps runner node types to workflow steps', () => {
    expect(nodeTypeToStep('IMAGE')).toBe('MEDIA')
    expect(nodeTypeToStep('TTS')).toBe('TTS')
    expect(nodeTypeToStep('SUBTITLE')).toBe('SUBTITLE')
    expect(nodeTypeToStep('COMPOSE')).toBe('RENDER')
    expect(nodeTypeToStep('PROJECT_COMPOSE')).toBe('RENDER')
    expect(nodeTypeToStep('QC')).toBe('QC')
  })

  it('returns null for unknown node types instead of guessing', () => {
    expect(nodeTypeToStep('SOMETHING_NEW')).toBeNull()
  })

  it('only treats in-flight node statuses as active', () => {
    expect(activeSteps([{ type: 'IMAGE', status: 'SUCCEEDED' }]).size).toBe(0)
    expect(activeSteps([{ type: 'IMAGE', status: 'RUNNING' }])).toEqual(new Set(['MEDIA']))
    expect(activeSteps([{ type: 'COMPOSE', status: 'WAITING_DEPS' }])).toEqual(new Set(['RENDER']))
  })
})

describe('next action resolution', () => {
  it('asks for a plan when none exists', () => {
    const a = resolveNextAction(base())
    expect(a.step).toBe('DIRECTOR')
    expect(a.ctas[0].intent).toBe('CREATE_PLAN')
  })

  it('asks for approval when a plan is in review', () => {
    const a = resolveNextAction(base({ plans: [{ id: 'p', version: 3, status: 'REVIEW', plan: { scenes: [{ scene_number: 1 }, { scene_number: 2 }], duration: 30 } }] }))
    expect(a.step).toBe('DIRECTOR')
    expect(a.title).toContain('v3')
    expect(a.ctas.map((c) => c.intent)).toContain('APPROVE_PLAN')
  })

  it('offers regenerate after rejection', () => {
    const a = resolveNextAction(base({ plans: [{ id: 'p', version: 1, status: 'REJECTED' }] }))
    expect(a.ctas[0].intent).toBe('REGENERATE_PLAN')
  })

  it('tells the truth that approving does not create scenes', () => {
    const a = resolveNextAction(base({ plans: [{ id: 'p', version: 1, status: 'APPROVED' }] }))
    expect(a.step).toBe('SCENES')
    expect(a.detail).toContain('không tự sinh cảnh')
    expect(a.ctas.map((c) => c.intent)).toEqual(['CREATE_SCENE', 'ENABLE_AUTOPILOT'])
  })

  it('walks media before tts, subtitle, then render', () => {
    const scenes = [scene('s1')]
    const noMedia = resolveNextAction(base({ scenes }))
    expect(noMedia.step).toBe('MEDIA')

    const media = resolveNextAction(base({ scenes, artifacts: [art('IMAGE', 's1')] }))
    expect(media.step).toBe('TTS')

    const tts = resolveNextAction(base({ scenes, artifacts: [art('IMAGE', 's1'), art('TTS', 's1')] }))
    expect(tts.step).toBe('SUBTITLE')

    const sub = resolveNextAction(base({ scenes, artifacts: [art('IMAGE', 's1'), art('TTS', 's1'), art('SUBTITLE', 's1')] }))
    expect(sub.step).toBe('RENDER')
  })

  it('requires project output before QC', () => {
    const scenes = [scene('s1')]
    const all = [art('IMAGE', 's1'), art('TTS', 's1'), art('SUBTITLE', 's1'), art('VIDEO', 's1')]
    const rendered = resolveNextAction(base({ scenes, artifacts: all }))
    expect(rendered.step).toBe('RENDER')

    const withOut = resolveNextAction(base({ scenes, artifacts: [...all, art('VIDEO', null)] }))
    expect(withOut.step).toBe('QC')
    expect(withOut.ctas[0].intent).toBe('RUN_QC')
  })

  it('does not offer export while the gate is blocked', () => {
    const scenes = [scene('s1')]
    const arts = [art('IMAGE', 's1'), art('TTS', 's1'), art('SUBTITLE', 's1'), art('VIDEO', null)]
    const qc = { qc: { verdict: 'BLOCKED', checks: [{ key: 'video_exists', status: 'FAIL', detail: '' }] }, gate: { decision: 'BLOCKED', reasons: ['video_exists=FAIL'] } }
    const a = resolveNextAction(base({ scenes, artifacts: arts, qc }))
    expect(a.step).toBe('GATE')
    expect(a.ctas.map((c) => c.intent)).not.toContain('EXPORT')
  })

  it('reports activity and offers nothing while a job is in flight', () => {
    const a = resolveNextAction(base({ scenes: [scene('s1')], activeNodes: [{ type: 'IMAGE', status: 'RUNNING' }] }))
    expect(a.kind).toBe('ACTIVITY')
    expect(a.ctas).toHaveLength(0)
  })

  it('moves to scheduling once the gate passes', () => {
    const scenes = [scene('s1')]
    const arts = [art('IMAGE', 's1'), art('TTS', 's1'), art('SUBTITLE', 's1'), art('VIDEO', null)]
    const qc = { qc: { verdict: 'PASS', checks: [] }, gate: { decision: 'PASS', reasons: [] } }
    const a = resolveNextAction(base({ scenes, artifacts: arts, qc }))
    expect(a.step).toBe('SCHEDULE')
    expect(a.ctas[0].intent).toBe('CREATE_SCHEDULE')
  })

  it('ends without a write action when everything is scheduled', () => {
    const scenes = [scene('s1')]
    const arts = [art('IMAGE', 's1'), art('TTS', 's1'), art('SUBTITLE', 's1'), art('VIDEO', null)]
    const qc = { qc: { verdict: 'PASS', checks: [] }, gate: { decision: 'PASS', reasons: [] } }
    const a = resolveNextAction(base({ scenes, artifacts: arts, qc, schedules: [{ id: 's1', status: 'SCHEDULED', run_at: 'x' }] }))
    expect(a.ctas).toHaveLength(0)
  })
})