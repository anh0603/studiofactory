# API_SPEC — AI Short Factory Web Pro (Phase 0, contract freeze candidate)

> Base: `/api/v1`. Giữ toàn bộ routes đã có trong `project.md #57`. File này BỔ SUNG routes còn thiếu theo quyết định Phase 0 §7.
> Sau sign-off: KHÔNG tự ý đổi contract. Mọi đổi cần proposal + version bump.
> Mọi response lỗi dùng typed error. Mọi response thành công bao gồm `request_id`.

## 0. Conventions (freeze)

- Auth Phase 0: single-user local, không auth header. Mọi secret chỉ đi chiều `client → server` lúc tạo/sửa, không bao giờ chiều ngược lại.
- `request_id`: server cấp (`req_<ulid>`), echo trong response header `X-Request-Id` + body + log + activity + provenance.
- `Idempotency-Key`: bắt buộc cho `POST /jobs`, `POST /autopilot/runs`, `POST /scheduler/schedules`, `POST /publisher/publish`, `POST /export`. Trùng key → trả bản ghi gốc (`200`, không tạo mới).
- Pagination: `?limit (default 20, max 100) &cursor`. Response `{ data[], next_cursor }`.
- Thời gian: ISO8601 UTC. Timezone chỉ là field hiển thị/lập lịch (`Asia/Ho_Chi_Minh` mặc định).
- Typed error duy nhất:

```json
{ "error": { "code": "QUOTA_EXHAUSTED", "message": "Provider quota exhausted.", "request_id": "req_..." } }
```

Codes freeze: `BAD_REQUEST, NOT_FOUND, CONFLICT, VALIDATION_FAILED, NOT_CONFIGURED, CREDENTIAL_MISSING, AUTH_FAILED, PERMISSION_DENIED, RATE_LIMITED, QUOTA_EXHAUSTED, TIMEOUT, PROVIDER_UNAVAILABLE, MODEL_UNAVAILABLE, INVALID_RESPONSE, CONTENT_POLICY_BLOCK, NETWORK_ERROR, LICENSE_BLOCKED, PAID_MODEL_BLOCKED, CAPABILITY_UNSUPPORTED, PRODUCTION_BLOCKED, PUBLISH_NOT_SUPPORTED, PUBLISH_CONFIG_REQUIRED, DUPLICATE_PUBLISH_BLOCKED, APPROVAL_REQUIRED, IDEMPOTENCY_REPLAY, UNKNOWN_ERROR`.

Amendment Phase 4: + `FFMPEG_UNAVAILABLE` (503, ffmpeg binary missing), + `RENDER_FAILED` (500, ffmpeg compose/concat failure). No other contract change.

- Secret rule: không field nào tên `api_key/apiKey/secret/token_value` xuất hiện trong GET/response/error/manifest/provenance/diagnostics. Credential chỉ trả `{ configured: true, last_verified_at, fingerprint_suffix4? }`.

## 1. Giữ nguyên (từ project.md #57, không đổi)

`GET /health`, projects CRUD, characters, scenes, `ai/providers`, `ai/models` CRUD + `POST /ai/models/{id}/test`, `POST /director/generate`, `GET /jobs`, `GET /jobs/{id}`, `POST /jobs/{id}/retry|cancel`, `GET /workflows/{id}`, `POST /qc`, `POST /export`, `GET /usage`, `GET /activity`, `GET /diagnostics`, `POST /diagnostics/run`.

## 2. Jobs (mở rộng, tương thích)

- `POST /jobs` — body `{ project_id, type: STORY|SCENE|TTS|IMAGE|COMPOSE|FULL_PIPELINE, input, idempotency_key }` → `201 { job_id, status: QUEUED, request_id }`. Trùng key → `200` replay.
- `GET /jobs/{id}` — `{ job_id, type, status, stage, provider, model, progress_percent|null, status_text, attempts, created/updated, artifacts[], error|null }`. `progress_percent=null` khi không tính được thật.
- `POST /jobs/{id}/pause | POST /jobs/{id}/resume` — automation control.
- `GET /jobs/{id}/events` — routing/stage events cho Job Detail + Activity.
- WS `/ws/jobs/{id}` events: `job.started, job.stage_changed, job.provider_selected, job.fallback, job.progress, job.artifact_completed, job.qc_result, job.export_complete, job.error`.

## 3. Autopilot

- `GET /autopilot/config` / `PUT /autopilot/config` — `{ enabled, daily_target, frequency_per_day, generation_window: {start,end,timezone}, topics[], randomization, max_retries_per_job, max_concurrent_jobs, allow_paid_models: false (default), require_approval_before_publish: true|false, stop_after_consecutive_failures, model_strategy }`.
- `POST /autopilot/runs` (`Idempotency-Key` bắt buộc) — tạo run theo Content Plan → `201 { run_id, status }`.
- `GET /autopilot/runs` + `GET /autopilot/runs/{id}` — status `RUNNING/PAUSED/COMPLETED/BLOCKED/FAILED`, counters `completed/total`, history.
- `POST /autopilot/pause | /resume | /stop` — bắt buộc (rule: mọi automation có pause/stop).
- `GET /autopilot/approvals` (jobs ở `AWAITING_APPROVAL`) + `POST /autopilot/approvals/{job_id}` `{ decision: APPROVED|REJECTED, note? }`. Khi `require_approval_before_publish=true`, job không sang scheduler nếu chưa `APPROVED`.

## 4. Scheduler

- `POST /scheduler/schedules` (`Idempotency-Key`) — `{ job_id|video_id, run_at, timezone, recurrence?, platforms[], account_refs }` → `201 { schedule_id, status: SCHEDULED }`.
- `GET /scheduler/schedules?from&to&platform&status` + `GET /scheduler/schedules/{id}` + `PATCH /scheduler/schedules/{id}` (reschedule) + `DELETE` (cancel).
- States: `SCHEDULED | CLAIMED | DISPATCHED | MISSED | CANCELLED`. Claim dùng lease nội bộ, không expose double-fire.

## 5. Publisher

- `GET /publisher/platforms` — `[{ id: youtube|tiktok|facebook, support_state: CONFIG_REQUIRED (Phase 0), capabilities[], connection: { connected, account?, token_expiry? } }]`. Phase 0 chưa OAuth live nên luôn `CONFIG_REQUIRED`.
- `POST /publisher/publish` (`Idempotency-Key` bắt buộc) — `{ video_id|job_id, platforms[], publish_mode: NOW|SCHEDULE, schedule_id?, title, description, hashtags }` → `202 { publish_job_id, per_platform: [{ platform, status: QUEUED }] }`. Nếu platform `NOT_SUPPORTED/CONFIG_REQUIRED` → `409 { code: PUBLISH_CONFIG_REQUIRED }`, không tạo post giả. Nếu Gate BLOCKED → `422 { code: PRODUCTION_BLOCKED }`.
- `GET /publisher/jobs/{id}` — per-platform `{ status: QUEUED|SENDING|CONFIRMED_PUBLISHED|RETRYABLE_ERROR|FATAL_ERROR, platform_post_id|null, reason, next_retry_at }`. `platform_post_id` chỉ có khi platform xác nhận.
- `POST /publisher/jobs/{id}/retry` — giữ idempotency key gốc để không duplicate.

## 6. Affiliate (isolated)

- `GET /affiliate/products` / `POST /affiliate/products` `{ name, description, price, affiliate_url, image_asset_id?, audience, tone, style }`.
- `POST /affiliate/products/{id}/analyze` → `{ benefits, hooks, pain_points, angles }` (qua Router, có provenance).
- `POST /affiliate/scripts` `{ product_id, style: REVIEW|UGC|PROBLEM_SOLUTION|SHOWCASE|COMPARISON|STORYTELLING|TOP_PRODUCT, hook/body/cta/disclosure }`.
- `POST /affiliate/videos` (tạo job affiliate, type riêng, không vào Story queue policy) + `GET /affiliate/videos/{id}/preview` + `POST /export` dùng chung với guard disclosure.
- Cấm field `autopilot/schedule/auto_publish` trong affiliate API Phase 0.

## 7. Connections

- `GET /connections` — `[{ id, kind: AI_PROVIDER|SOCIAL|STORAGE, label, status: CONNECTED|NOT_CONNECTED|DEGRADED|AUTH_FAILED|CONFIG_REQUIRED, last_verified_at }]`, không secret.
- `POST /connections/{id}/test` → `{ status, latency_ms, checked_at }` thật từ backend/probe.
- `POST /connections/{id}/disconnect` + (social, future) `POST /connections/oauth/start|callback` — Phase 0 chỉ contract, trả `CONFIG_REQUIRED` khi chưa có adapter.

## 8. Analytics

- `GET /analytics/overview?from&to` — `{ videos_created, videos_published, failed_jobs, avg_generation_seconds, qc_failures, published_by_platform, retries, scheduled }`. Views/likes/comments/shares chỉ khi platform API trả — nếu không có → field `null` + `verified: false`, cấm bịa số.
- `GET /analytics/activity` (alias chi tiết cho AI Activity), `GET /analytics/usage` (requests/success/failed/fallbacks/avg_latency/provider+model breakdown/cost `number|null`, `cost_state: KNOWN|UNKNOWN`).

## 9. QC / Gate / Export contract (khóa)

- `POST /qc` body `{ job_id|video_id }` → `{ verdict: PASS|REVIEW_REQUIRED|BLOCKED, checks: [{ key, status, detail }] }` (keys freeze ở DATA_MODEL).
- Production Gate là server-side guard trên `POST /export` và `POST /publisher/publish`: BLOCKED → `422 PRODUCTION_BLOCKED` kèm checklist fail. Không có query param `?skip_gate`; không silent bypass.
- `POST /export` → `{ export_id, files: [final.mp4, thumbnail.jpg, manifest.json, metadata.json], provenance_uri }`. Fail khi thiếu mandatory (media/audio/subtitle/license/disclosure).
