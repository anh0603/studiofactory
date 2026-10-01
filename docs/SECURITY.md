# SECURITY — AI Short Factory Web Pro (Phase 0)

> Nguyên tắc: BYOK, least-privilege, không tin input, không lộ secret, không chi tiền âm thầm, không PASS giả.

## 1. Secret handling (freeze)

- Lưu: `CredentialStore` duy nhất được chạm secret. Encrypt at rest (Phase 1 chọn libsodium/OS keyring, không hard-code key trong repo). DB chỉ giữ `ref + fingerprint`.
- API: `POST /ai/models` nhận `api_key` một lần; mọi GET/response/error/log/manifest/provenance/diagnostics/analytics/WS KHÔNG bao giờ chứa secret. UI nhận `{ configured: true }` + masked `sk-**** + last4?` — cấm trả full sau khi lưu. Delete cần confirm.
- Log: structured JSON `{ timestamp, level, event, provider, model, request_id }`. Scrubber bắt buộc chạy trước khi ghi: `api_key|authorization|bearer|password|secret|token`. Secret xuất hiện trong stacktrace → lỗi P0, block release.
- Data flow: `prompt → FastAPI local → Router → provider được chọn duy nhất`. Cấm fan-out cho provider không liên quan. Upload/URL provider custom phải validate `https://` + allowlist, chống SSRF (cấm IP private/metadata endpoints).

## 2. Input / file / FFmpeg

- Path: chuẩn hóa + jail dưới `projects/<id>/` hoặc tmp job dir; chặn `..`, symlink escape, absolute ngoài jail. Mọi `artifact.path` verify lại khi đọc.
- Upload: check `extension + MIME + magic bytes + size + dimensions`. Ảnh chỉ `JPEG/PNG/WEBP`. Audio/video chỉ format FFmpeg hỗ trợ đã liệt kê ở Phase 4. Quá size → `VALIDATION_FAILED`, không ghi đĩa.
- FFmpeg: cấm `shell=True`; dùng argv array; validate mọi path/arg số (duration, scale); chạy trong tmp dir per job; cleanup khi fail; timeout kill. Lệnh phải log dạng redacted-args (không user prompt thô nếu chứa PII? giữ prompt ID thay vì full text khi log debug).
- API validation: Pydantic strict, reject unknown fields ở publish/schedule/config; CORS lock `localhost` ở local-first; WS cùng origin; không internal endpoint lộ ra ngoài (`/diagnostics/run` rate-limit + confirm).

## 3. Cost policy (freeze)

Classes: `LOCAL | FREE | FREE_WITH_LIMIT | TRIAL | PAID | UNKNOWN`. Default `allow_paid_models=false` → chỉ `LOCAL/FREE/FREE_WITH_LIMIT` đi qua. `TRIAL/PAID/UNKNOWN` + policy OFF → `PAID_MODEL_BLOCKED`, zero network request, UI hiện `Model + Cost policy + Fallback N models + Estimated Unknown` trước task đắt tiền. Bật paid cần `PUT /autopilot/config` hoặc per-model explicit + confirm UI. Không invent giá: cost `null + UNKNOWN` khi thiếu data.

## 4. License policy (freeze)

States: `VERIFIED_COMMERCIAL | VERIFIED_NONCOMMERCIAL | UNKNOWN | UNVERIFIED`. Production Gate block `VERIFIED_NONCOMMERCIAL/UNKNOWN/UNVERIFIED` trừ khi bật testing/non-production mode tường minh. Cấm claim commercial-safe khi chưa evidence. Music/SFX artifact bắt buộc ghi `{ provider, model, license, source, duration, sha256 }`.

## 5. Production Gate (freeze checklist)

Gate chạy server-side trước `POST /export` và `POST /publisher/publish`: `character, media, audio, subtitle, video, qc(PASS), provenance, disclosure (AI + affiliate/FTC khi affiliate), license, cost policy, export completeness, platform metadata (khi publish)`. Fail mandatory → `BLOCKED` + `422 PRODUCTION_BLOCKED` + checklist chi tiết. Không param skip, không downgrade. Character Lock thiếu verification thật → `REVIEW_REQUIRED`, không `LOCKED` giả.

## 6. Idempotency / retry / circuit (freeze)

- Idempotency key bắt buộc cho create-side (jobs, autopilot runs, schedules, publish, export). Server lưu key→result 24h+; replay trả gốc. Publish retry giữ nguyên key → không duplicate post.
- Retry bounded: default `attempt 1 → backoff → attempt 2 → backoff → attempt 3 → stop` (config `max_retries_per_job`, `stop_after_consecutive_failures`). Exponential backoff + jitter. Không retry `BAD_REQUEST/AUTH/CONTENT_POLICY/LICENSE/PAID/CREDENTIAL` (trừ khi user sửa config rồi retry tay).
- Circuit breaker per model/provider: `HEALTHY → DEGRADED (1-2 fail) → OPEN (threshold, cooldown) → HALF_OPEN (probe) → HEALTHY`. Threshold/cooldown trong `settings`, Router tôn trọng tuyệt đối.
- No-credential rule: thiếu credential → `NOT_CONFIGURED/CREDENTIAL_MISSING`, skip live, không mượn provider khác trừ khi fallback policy cho phép tường minh.
- Mock rule: mock chỉ trong `tests/` + tên `Mock*` + field `mock: true`; production mode reject artifact có `mock:true`. Test matrix bắt buộc: router fallback, secret-absent 6 nơi, media bytes thật, recovery reuse, gate block.

## 7. Privacy / offline

Local-first: projects/media/credentials ở local mặc định, không telemetry ẩn. Cloud chỉ nhận data tối thiểu cho task đã chọn; UI diễn giải điều này. Offline: editing/diagnostics/DB local vẫn chạy; cloud gen trả `NETWORK_UNAVAILABLE`, không treo.
