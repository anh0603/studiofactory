# DATA_MODEL — AI Short Factory Web Pro (Phase 0)

> DB: SQLite (Alembic migrations) qua SQLAlchemy, PostgreSQL-compatible (không dùng dialect-specific DDL ở Phase 1+).
> Naming: snake_case tables, UUIDv7/ULID string PK (`id`), `created_at/updated_at` UTC trên mọi entity.
> Filesystem song song: `projects/<project-id>/{project.json,assets,characters,scenes,audio,subtitles,renders,exports,provenance,logs}` — DB là index, FS là bytes.
>
> Amendment Phase 2 (không đổi contract): `usage_events` đã có trong contract
> nhưng thiếu trong migration `0001_foundation` → bổ sung bằng migration
> `0002_usage_events` (cùng fields). Không thêm bảng mới cho router trace —
> trace đọc từ `usage_events` (append-only) + response `trace[]`.
>
> Amendment Phase 3 (scope yêu cầu, tương thích ngược): `projects.factory_type`
> (`story|affiliate`, default `story`) để tách 2 Factory + bảng mới
> `director_plans` (versioned, append-only, không overwrite). Migration `0003`.
>
> Amendment Phase 6: + `autopilot_configs` (policy per project),
> + `autopilot_runs` (counters, job/schedule ids), + `schedules`
> (run_at UTC, recurrence, idempotency UNIQUE). Migration `0005`.
>
> Amendment Phase 7: + `social_connections` (OAuth state, token_ref only —
> secrets in CredentialStore), + `publish_jobs` (idempotency UNIQUE),
> + `publish_attempts` (post_id ONLY when confirmed). Migration `0006`.
>
> Amendment Phase 8: + `affiliate_products` / `affiliate_scripts` /
> `affiliate_videos` — zero Story FKs (isolation by construction).
> Migration `0007`.

## 1. ERD (text, Phase 0 freeze entities)

```text
projects 1──* characters 1──* character_references
projects 1──* scenes 1──* scene_assets
projects 1──* jobs 1──* workflow_nodes 1──* job_events
jobs 1──* artifacts
jobs 1──* qc_results
jobs 1──* exports
ai_providers 1──* ai_models 1──* routing_events
credentials 1──0..1 ai_models (qua credential_ref, không FK cứng secret)
autopilot_configs 1──* autopilot_runs 1──* autopilot_approvals
schedules *──1 jobs (nullable video ref)
publish_jobs 1──* publish_attempts
affiliate_products 1──* affiliate_scripts 1──* affiliate_videos
usage_events (append-only) | settings (key-value)
```

Story ↔ Affiliate: KHÔNG FK chéo. Affiliate tables độc lập hoàn toàn (quyết định §5).

## 2. Entities + fields tối thiểu

- `projects { id, name, description, language, style, audience, duration_target, status: DRAFT|GENERATING|REVIEW|READY|EXPORTING|COMPLETED|FAILED|ARCHIVED, created/updated }`
- `characters { id, project_id, kind: MAIN|SUPPORTING, name, description, visual_identity, lock: {face,hair,clothes,colors,features}, lock_state: LOCKED|REVIEW_REQUIRED|UNSUPPORTED, reference_asset_id }`
- `character_references { id, character_id, asset_path, sha256, mime, width/height, created }`
- `scenes { id, project_id, idx, duration_s, camera, motion, environment, dialogue, visual_prompt, status, approved }`
- `scene_assets { id, scene_id, kind: IMAGE|VIDEO|AUDIO|SUBTITLE, artifact_id, created }`
- `ai_providers { id, name (OpenRouter/.../custom), base_url, adapter_key, enabled, health: HEALTHY|DEGRADED|RATE_LIMITED|AUTH_FAILED|UNAVAILABLE|UNKNOWN, last_probe_at }`
- `credentials { id, provider_id, ref (random), algo, fingerprint, configured: true, last_verified_at, created/updated }` — KHÔNG cột `secret_plain`; secret ciphertext chỉ đọc qua CredentialStore server-side.
- `ai_models { id, provider_id, credential_ref, name, model_id, capabilities[], priority, enabled, cost_class, license_status, context_window, metadata(json), health_status: ACTIVE|COOLDOWN|DISABLED|AUTH_FAILED|QUOTA_EXHAUSTED|UNAVAILABLE|UNKNOWN, last_test_at }`
- `jobs { id (JOB-YYYY-NNNNNN), project_id, kind: STORY|SCENE|IMAGE|TTS|COMPOSE|FULL_PIPELINE|AFFILIATE_VIDEO, status: QUEUED|RUNNING|PAUSED|AWAITING_APPROVAL|SCHEDULED|PUBLISHING|SUCCEEDED|BLOCKED|FAILED|CANCELLED|PUBLISHED, stage, provider, model, progress_percent nullable, status_text, idempotency_key UNIQUE, attempts, error_code, created/updated }`
- `workflow_nodes { id, job_id, type, status: PENDING|WAITING_DEPS|READY|RUNNING|SUCCEEDED|FAILED|SKIPPED_REUSE|RETRY_QUEUED, deps[], input_hash, provider, model, attempts, output_artifact_id, error_code, started/ended }`
- `job_events { id, job_id, node_id?, event, provider, model, attempt, latency_ms, status, error_category, fallback_reason, created }` — nguồn cho AI Activity.
- `artifacts { id, job_id, scene_id?, kind, path, sha256, bytes, mime, width/height?, duration_s?, provider, model, request_id, cost_class, license_status, created }`
- `qc_results { id, job_id, verdict: PASS|REVIEW_REQUIRED|BLOCKED, checks: [{key,status,detail}], created }` — keys freeze: `video_exists, video_readable, video_duration, resolution, audio_exists, audio_duration, subtitle_exists, subtitle_timing, artifact_integrity, character_policy, license, disclosure, provenance`.
- `exports { id, job_id, files_manifest, provenance_uri, idempotency_key UNIQUE, created }`
- `autopilot_configs { id (singleton `default`), enabled, daily_target, frequency_per_day, window_start/end, timezone, topics[], randomization, max_retries_per_job, max_concurrent_jobs, allow_paid_models=false, require_approval_before_publish, stop_after_consecutive_failures, model_strategy }`
- `autopilot_runs { id, config_snapshot, status: RUNNING|PAUSED|COMPLETED|BLOCKED|FAILED, planned, completed, failed, created/updated }`
- `autopilot_approvals { id, job_id UNIQUE, status: PENDING|APPROVED|REJECTED, decided_at }`
- `schedules { id, job_id, run_at, timezone, recurrence?, platforms[], account_refs, status: SCHEDULED|CLAIMED|DISPATCHED|MISSED|CANCELLED, idempotency_key UNIQUE }`
- `publish_jobs { id, job_id, video_id, mode: NOW|SCHEDULE, title, description, hashtags, idempotency_key UNIQUE, created }`
- `publish_attempts { id, publish_job_id, platform: youtube|tiktok|facebook, status: QUEUED|SENDING|CONFIRMED_PUBLISHED|RETRYABLE_ERROR|FATAL_ERROR, platform_post_id nullable, reason, next_retry_at, idempotency_key (kế thừa publish_job, giữ nguyên khi retry) }`
- `affiliate_products { id, name, description, price, affiliate_url, image_asset_id?, audience, tone, style, created }`, `affiliate_scripts { id, product_id, style, hook, body, cta, disclosure, provider, model, request_id }`, `affiliate_videos { id, product_id, script_id, job_id, status, preview_uri, export_id? }`
- `usage_events { id, request_id, job_id?, task, provider, model, latency_ms, status, error_category?, cost: number|null, cost_state: KNOWN|UNKNOWN, created }` — append-only, không update.
- `settings { key PK, value_json, updated_at }` — keys Phase 0: `cost_policy, license_policy, router_strategy, circuit_threshold/cooldown, concurrency_default, timezone_default`.

## 3. Constraints

- `ai_models.credential_ref` bắt buộc khi `enabled=true`; xóa credential → model tự `DISABLED` + event.
- `jobs.idempotency_key`, `exports.idempotency_key`, `schedules.idempotency_key`, `publish_jobs.idempotency_key` UNIQUE; replay trả bản ghi gốc.
- `publish_attempts.platform_post_id` NOT NULL iff `status=CONFIRMED_PUBLISHED`.
- `artifacts.sha256` + `bytes` NOT NULL; `path` phải nằm dưới `projects/<id>/` (guard ở SECURITY).
- `qc_results` giữ mọi lần chạy (history), verdict mới nhất quyết định Gate.
- Không lưu secret/plaintext token trong bất kỳ bảng nào ngoài ciphertext của `credentials` (server-side only).
