/* Vietnamese-first text abstraction (no i18n dep in Phase 0/1).
   Call sites use t('key'). Later i18n replaces this dict without changing calls. */
export const strings = {
  'app.title': 'AI Short Factory',
  'nav.overview': 'Tổng quan',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.story': 'Story Factory',
  'nav.affiliate': 'Affiliate Factory',
  'nav.automation': 'Tự động hoá',
  'nav.ai': 'AI',
  'nav.system': 'Hệ thống',
  'dashboard.hero': 'Nhà máy của bạn đã sẵn sàng.',
  'dashboard.health': 'Trạng thái hệ thống',
  'state.loading': 'Đang tải…',
  'state.empty': 'Chưa có dữ liệu.',
  'state.error': 'Đã xảy ra lỗi.',
  'action.retry': 'Thử lại',
  'palette.title': 'Lệnh (Ctrl+K)',
} as const

export type StringKey = keyof typeof strings
export function t(key: StringKey): string {
  return strings[key]
}
