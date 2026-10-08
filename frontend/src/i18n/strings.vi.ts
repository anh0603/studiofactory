/* Vietnamese-first text abstraction (no i18n dep in Phase 0/1).
   Call sites use t('key'). Later i18n replaces this dict without changing calls. */
export const strings = {
  'app.title': 'AI Short Factory',
  'app.subtitle': 'Xưởng sản xuất video tự động',
  'nav.overview': 'Tổng quan',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.story': 'Story Factory',
  'nav.story.projects': 'Dự án',
  'nav.affiliate': 'Affiliate Factory',
  'nav.affiliate.products': 'Sản phẩm',
  'nav.automation': 'Tự động hoá',
  'nav.queue': 'Hàng đợi',
  'nav.autopilot': 'Tự lái',
  'nav.scheduler': 'Lịch đăng',
  'nav.publisher': 'Đăng bài',
  'nav.ai': 'Trí tuệ nhân tạo',
  'nav.ai.models': 'Kho mô hình',
  'nav.ai.router': 'Bộ định tuyến',
  'nav.analytics': 'Phân tích',
  'nav.analytics.overview': 'Số liệu tổng quan',
  'nav.system': 'Hệ thống',
  'nav.diagnostics': 'Chẩn đoán',
  'nav.settings': 'Cài đặt',
  'nav.sidebar': 'Điều hướng chính',
  'nav.new': 'Tạo video mới',
  'nav.produce': 'Sản xuất',
  'nav.hint': 'Nhấn',
  'nav.hint.kbd': 'để mở bảng lệnh nhanh',
  'dashboard.hero': 'Nhà máy của bạn đã sẵn sàng.',
  'dashboard.hero.t1': 'Hôm nay bạn muốn kể',
  'dashboard.hero.t2': 'câu chuyện',
  'dashboard.hero.t3': 'gì?',
  'dashboard.hero.ph': 'Một chú mèo tên Milo sống trong khu rừng già…',
  'dashboard.hero.plan': 'Lên kế hoạch',
  'dashboard.new.default': 'Video mới',
  'dashboard.preset.kids': 'Truyện thiếu nhi',
  'dashboard.preset.review': 'Review sản phẩm',
  'dashboard.preset.facts': 'Kiến thức 60s',
  'dashboard.preset.calm': 'Thiền',
  'dashboard.health': 'Trạng thái hệ thống',
  'state.loading': 'Đang tải…',
  'state.empty': 'Chưa có dữ liệu.',
  'state.error': 'Đã xảy ra lỗi.',
  'action.retry': 'Thử lại',
  'palette.title': 'Bảng lệnh nhanh (Ctrl+K)',
  'palette.hint': 'Danh sách lệnh sẽ được bổ sung cùng các tính năng.',
  'settings.appearance': 'Giao diện',
  'settings.theme.light': 'Sáng',
  'settings.theme.dark': 'Tối',
  'affiliate.drop.image': 'Kéo thả ảnh sản phẩm vào đây',
  'affiliate.scripts.reorder.hint': 'Kéo thẻ để đổi thứ tự kịch bản.',
  'ai.preset.title': 'Chọn nhanh dịch vụ phổ biến',
  'ai.preset.hint': 'Chỉ điền sẵn địa chỉ giúp bạn — khoá API vẫn là của bạn, nhập ở bước sau.',
  'ai.key.inline': 'Khoá API (dán luôn để xong trong 1 bước)',
  'ai.key.inline.ph': 'dán khoá của bạn, để trống nếu chưa có',
  'ai.custom.more': 'Tùy chỉnh thêm',
  'ai.custom.less': 'Thu gọn',
  'ai.provider.what': 'Nhà cung cấp là nơi bạn thuê AI (ví dụ: OpenRouter, Google). Bạn tự tạo tài khoản ở đó rồi dán khoá vào đây.',
  'ai.model.what': 'Mô hình là “con AI” cụ thể và việc nó làm được: viết truyện, vẽ hình, đọc giọng…',
  'ai.test.what': 'Bấm Kiểm tra năng lực để web gọi thử thật một lần, biết ngay có dùng được không.',
} as const

export type StringKey = keyof typeof strings
export function t(key: StringKey): string {
  return strings[key]
}

/** Vietnamese labels for diagnostics/status keys returned by the API. */
export const statusVi: Record<string, string> = {
  QUEUED: 'Chờ xử lý', RUNNING: 'Đang chạy', PAUSED: 'Tạm dừng', SUCCEEDED: 'Thành công',
  FAILED: 'Thất bại', CANCELLED: 'Đã huỷ', SKIPPED_REUSE: 'Dùng lại kết quả',
  HEALTHY: 'Ổn định', DEGRADED: 'Suy giảm', NOT_CONFIGURED: 'Chưa cấu hình',
  NOT_RUNNING: 'Không chạy', ERROR: 'Lỗi', freellmapi: 'FreeLLMAPI',
  CONFIG_REQUIRED: 'Cần cấu hình', REVIEW_REQUIRED: 'Cần xem lại', DISABLED: 'Đã tắt',
  ACTIVE: 'Đang bật', UNVERIFIED: 'Chưa xác minh', VERIFIED: 'Đã xác minh',
  BANNED: 'Bị cấm', DEPRECATED: 'Ngừng dùng', UNAVAILABLE: 'Không dùng được',
  IDLE: 'Nhàn rỗi', AWAITING_APPROVAL: 'Chờ duyệt', SCHEDULED: 'Đã lên lịch',
  PUBLISHING: 'Đang đăng', CONFIRMED: 'Đã đăng', RETRYABLE_ERROR: 'Lỗi tạm thời',
  PARTIAL: 'Một phần', MOCK: 'Giả lập', REAL: 'Thật', CONNECTED: 'Đã liên kết',
  MISSED: 'Bỏ lỡ', COMPLETED: 'Đã hoàn tất', STOPPED: 'Đã dừng',
  DRAFT: 'Bản nháp', PLANNED: 'Đã lên kế hoạch', REVIEW: 'Chờ duyệt',
  REJECTED: 'Đã từ chối', UNSUPPORTED: 'Chưa hỗ trợ', LOCKED: 'Đã khoá',
  APPROVED: 'Đã duyệt', PASS: 'Đạt', FAIL: 'Chưa đạt', DISPATCHED: 'Đã phát',
  PUBLISHED: 'Đã đăng', BLOCKED: 'Bị chặn',
  ffmpeg: 'FFmpeg', ffprobe: 'FFprobe', database: 'Cơ sở dữ liệu', redis: 'Redis',
  object_store: 'Kho đối tượng', worker: 'Worker', provider: 'Nhà cung cấp',
  credential: 'Khoá truy cập', policy: 'Chính sách', storage: 'Lưu trữ',
  api_key: 'API key', cors: 'CORS', websockets: 'WebSocket', scheduler: 'Bộ lập lịch',
  scheduler_tick: 'Bộ lập lịch (tick)', autoscale: 'Tự co giãn', youtube: 'YouTube',
  tiktok: 'TikTok', facebook: 'Facebook',
  UNKNOWN: 'Chưa xác định', backend: 'Máy chủ', ai_router: 'Bộ định tuyến AI',
  publisher: 'Bộ đăng bài', engine: 'Động cơ',
  pricing: 'Bảng giá', watermarks: 'Watermark', storage_limit: 'Hạn mức lưu trữ',
  ai_providers: 'Nhà cung cấp AI', ai_models: 'Mô hình AI',
  ai_credentials: 'Khoá truy cập AI',
  AUTHENTICATED: 'Đã xác thực', CAPABILITY_VERIFIED: 'Đã kiểm tra năng lực',
  COOLDOWN: 'Đang nghỉ lỗi', QUOTA_EXHAUSTED: 'Hết hạn mức',
  NOT_CONNECTED: 'Chưa liên kết', AUTO: 'Tự động', PRIORITY: 'Theo ưu tiên',
  WEIGHTED: 'Theo trọng số', FASTEST: 'Nhanh nhất', CHEAPEST: 'Rẻ nhất',
  FREE: 'Miễn phí', FREE_WITH_LIMIT: 'Miễn phí có giới hạn', TRIAL: 'Dùng thử',
  PAID: 'Trả phí', LOCAL: 'Chạy nội bộ', VERIFIED_COMMERCIAL: 'Cho phép thương mại',
  VERIFIED_NONCOMMERCIAL: 'Không thương mại',
}

/** Typed error codes the AI Router returns. Plain language, no jargon. */
export const errorCodeVi: Record<string, string> = {
  MODEL_UNAVAILABLE: 'Chưa có mô hình nào dùng được',
  CREDENTIAL_MISSING: 'Chưa lưu khoá truy cập cho nhà cung cấp',
  PAID_MODEL_BLOCKED: 'Mô hình trả phí đang bị chính sách chặn',
  LICENSE_BLOCKED: 'Giấy phép chưa cho phép dùng thương mại',
  CAPABILITY_UNSUPPORTED: 'Mô hình không hỗ trợ năng lực này',
  CAPABILITY_MISMATCH: 'Mô hình không có năng lực cần dùng',
  AUTH_FAILED: 'Khoá truy cập bị từ chối',
  PERMISSION_DENIED: 'Không đủ quyền với khoá này',
  RATE_LIMITED: 'Bị giới hạn tần suất, đã dừng thử lại',
  QUOTA_EXHAUSTED: 'Hết hạn mức dùng',
  TIMEOUT: 'Hết thời gian chờ',
  PROVIDER_UNAVAILABLE: 'Nhà cung cấp đang không phản hồi',
  NETWORK_ERROR: 'Không kết nối được tới nhà cung cấp',
  INVALID_RESPONSE: 'Phản hồi của nhà cung cấp không dùng được',
  CONTENT_POLICY_BLOCK: 'Bị chặn bởi chính sách nội dung',
  BAD_REQUEST: 'Yêu cầu không hợp lệ',
  UNKNOWN_ERROR: 'Lỗi chưa xác định',
  FFMPEG_UNAVAILABLE: 'Máy chưa có FFmpeg',
  RENDER_FAILED: 'Dựng video thất bại',
  PRODUCTION_BLOCKED: 'Bị Cổng sản xuất chặn',
  VALIDATION_FAILED: 'Dữ liệu không hợp lệ',
  NOT_FOUND: 'Không tìm thấy',
  DISABLED: 'Đang tắt',
  MANUAL_SELECTION: 'Bị bỏ qua do chọn thủ công',
  UNHEALTHY_UNAVAILABLE: 'Nhà cung cấp không phản hồi',
  UNHEALTHY_AUTH_FAILED: 'Khoá truy cập không hợp lệ',
  UNHEALTHY_QUOTA_EXHAUSTED: 'Hết hạn mức',
}

/** Whether a block happened before any provider was contacted. */
export function isPreNetworkBlock(errorCode: string | null | undefined): boolean {
  return errorCode === 'MODEL_UNAVAILABLE' || errorCode === 'CREDENTIAL_MISSING'
    || errorCode === 'PAID_MODEL_BLOCKED' || errorCode === 'LICENSE_BLOCKED'
    || errorCode === 'CAPABILITY_MISMATCH' || errorCode === 'CAPABILITY_UNSUPPORTED'
}

/** Human label for a diagnostics check key. */
export function labelVi(raw: string): string {
  const key = raw.toLowerCase()
  if (statusVi[raw]) return statusVi[raw]
  if (statusVi[raw.toUpperCase()]) return statusVi[raw.toUpperCase()]
  return raw.replace(/_/g, ' ')
}