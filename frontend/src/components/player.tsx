import { useState } from 'react'

/* Native video player for finished renders. The backend serves bytes with
 * HTTP Range support, so seeking works. Same-origin relative URL. */
export function VideoPlayer({ src, title, downloadName }: { src: string; title?: string; downloadName?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-black">
      {failed ? (
        <p className="px-4 py-8 text-center text-[13px] text-secondary">
          Không tải được video. Kiểm tra tệp trên máy chủ.
        </p>
      ) : (
        <video
          key={src}
          controls
          playsInline
          preload="metadata"
          src={src}
          aria-label={title ?? 'Video hoàn thành'}
          className="max-h-[420px] w-full bg-black"
          onError={() => setFailed(true)}
        />
      )}
      {downloadName && !failed ? (
        <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-panel px-3 py-2">
          <p className="truncate text-[12px] text-secondary">{title ?? downloadName}</p>
          <a href={src} download={downloadName} className="link-accent shrink-0 text-[12px]">
            Tải xuống
          </a>
        </div>
      ) : null}
    </div>
  )
}
