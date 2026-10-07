/**
 * Domain enum translation. Backend enums stay untouched; every value the UI
 * renders goes through here.
 *
 * Rule: unknown value -> "Chưa khả dụng". Never render the raw enum, never
 * guess a meaning. The raw code is preserved only in the DOM `title` so it can
 * still be looked up without polluting the visible surface.
 */

/* scene.status — api/v1/story.py:28 SCENE_STATUSES */
export const sceneStatusVi: Record<string, string> = {
  DRAFT: 'Bản nháp',
  PLANNED: 'Đã lên kế hoạch',
  REVIEW_REQUIRED: 'Cần duyệt',
  APPROVED: 'Đã duyệt',
}

/* character.lock_state — api/v1/story.py:30 LOCK_STATES */
export const lockStateVi: Record<string, string> = {
  REVIEW_REQUIRED: 'Cần xem lại',
  UNSUPPORTED: 'Chưa hỗ trợ',
  LOCKED: 'Đã khoá',
}

/* director plan origin — director.py:152, autopilot/service.py:141, _new_version calls */
export const planOriginVi: Record<string, string> = {
  GENERATED: 'Tạo bởi AI',
  REGENERATED: 'Tạo lại toàn bộ',
  SECTION_REGENERATED: 'Tạo lại một phần',
  USER_EDITED: 'Chỉnh sửa thủ công',
}

/* artifact.kind — media/pipeline.py:23 EXT */
export const artifactKindVi: Record<string, string> = {
  IMAGE: 'Hình ảnh',
  VIDEO: 'Video',
  TTS: 'Giọng đọc',
  SUBTITLE: 'Phụ đề',
  COMPOSE: 'Ghép cảnh',
  THUMBNAIL: 'Ảnh xem trước',
}

/* qc check status — media/qc.py checks use PASS / REVIEW / FAIL */
export const qcCheckVi: Record<string, string> = {
  PASS: 'Đạt',
  REVIEW: 'Cần xem lại',
  FAIL: 'Chưa đạt',
}

const UNKNOWN = 'Chưa khả dụng'

export function enumVi(raw: string | null | undefined, map: Record<string, string>): string {
  if (!raw) return UNKNOWN
  return map[raw] ?? UNKNOWN
}

/** Has a mapping, so a badge may be shown at all. */
export function hasEnum(raw: string | null | undefined, map: Record<string, string>): boolean {
  return !!raw && raw in map
}