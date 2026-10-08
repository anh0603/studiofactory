"""FFmpeg wrapper. argv arrays only, bounded timeout, isolated tmp, cleanup."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


class FFmpegUnavailable(RuntimeError):
    pass


def executable() -> str | None:
    return shutil.which("ffmpeg")


def require() -> str:
    exe = executable()
    if not exe:
        raise FFmpegUnavailable("ffmpeg binary not found on PATH")
    return exe


def run(args: list[str], timeout_s: float = 120.0,
        cwd: str | Path | None = None,
        on_progress: object = None,
        progress_total_s: float = 0) -> tuple[int, str]:
    """Run ffmpeg with argv array. Returns (returncode, stderr tail).

    When on_progress (callable taking 0.0..1.0) and progress_total_s are
    given, ffmpeg emits machine-readable progress and the callback fires
    with REAL fractions parsed from out_time_ms. No guessing.
    """
    exe = require()
    for a in args:
        if not isinstance(a, str) or "\x00" in a:
            raise ValueError("invalid ffmpeg argument")
    if on_progress is None or progress_total_s <= 0:
        proc = subprocess.run([exe, "-y", *args], capture_output=True, text=True,
                              timeout=timeout_s, shell=False,
                              cwd=str(cwd) if cwd else tempfile.gettempdir())
        return proc.returncode, proc.stderr[-2000:]
    cmd = [exe, "-y", "-progress", "pipe:1", "-nostats", *args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, shell=False,
                            cwd=str(cwd) if cwd else tempfile.gettempdir())
    import threading as _threading
    import time as _time
    # Drain stderr on a side thread: a full stderr pipe would block ffmpeg
    # and deadlock the stdout loop. Only the tail is kept for errors.
    stderr_chunks: list[str] = []

    def _drain() -> None:
        try:
            assert proc.stderr is not None
            data = proc.stderr.read()
            if data:
                stderr_chunks.append(data[-4000:])
        except Exception:  # noqa: BLE001
            pass

    drainer = _threading.Thread(target=_drain, daemon=True)
    drainer.start()
    started = _time.monotonic()
    total_ms = max(progress_total_s * 1000.0, 1.0)
    last = -1
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if _time.monotonic() - started > timeout_s:
                raise TimeoutError("ffmpeg progress timeout")
            line = line.strip()
            if line.startswith("out_time_ms="):
                try:
                    ms = float(line.split("=", 1)[1])
                except ValueError:
                    continue
                pct = max(0, min(100, int(ms / total_ms * 100)))
                if pct != last:
                    last = pct
                    on_progress(pct / 100.0)  # type: ignore[operator]
        _, _ = proc.communicate(timeout=max(timeout_s - (_time.monotonic() - started), 1.0))
        drainer.join(timeout=5.0)
        stderr = "".join(stderr_chunks)
    except Exception as exc:  # noqa: BLE001 - timeout or io error
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass
        try:
            _, _ = proc.communicate(timeout=5.0)
        except Exception:  # noqa: BLE001
            pass
        drainer.join(timeout=5.0)
        stderr = "".join(stderr_chunks)
        tag = "timeout" if isinstance(exc, TimeoutError) else (stderr or "")
        return proc.returncode or 1, tag[-2000:]
    if proc.returncode != 0:
        return proc.returncode, (stderr or "")[-2000:]
    if last < 100:
        on_progress(1.0)  # type: ignore[operator]
    return proc.returncode, (stderr or "")[-2000:]


def compose_scene(image: Path, audio: Path | None, subtitle: Path | None,
                  out: Path, duration_s: float, width: int = 720,
                  height: int = 1280, timeout_s: float = 120.0,
                  on_progress: object = None) -> None:
    """Still-image + audio (+srt) -> mp4. Raises on failure.

    Subtitles are muxed as a real mov_text stream (selectable subtitles),
    never burned via libass: the subtitles filter hangs on this Windows
    build (verified), while muxing is fast, deterministic, and keeps the
    SRT content verifiable via ffprobe.
    """
    cmd: list[str] = ["-loop", "1", "-i", str(image)]
    if audio is not None:
        cmd += ["-i", str(audio)]
    if subtitle is not None:
        cmd += ["-i", str(subtitle)]
    vf = f"scale={width}:{height}:force_original_aspect_ratio=increase," \
         f"crop={width}:{height}"
    cmd += ["-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-t", f"{max(duration_s, 0.5):.2f}",
            # Faststart: moov before mdat so browsers start playback
            # immediately instead of hanging on the first frame.
            "-movflags", "+faststart"]
    if audio is not None:
        cmd += ["-c:a", "aac"]
    if subtitle is not None:
        cmd += ["-c:s", "mov_text"]
    if audio is not None:
        cmd += ["-shortest"]
    cmd.append(str(out))
    code, err = run(cmd, timeout_s, on_progress=on_progress,
                    progress_total_s=max(duration_s, 0.5))
    if code != 0 or not out.exists() or out.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg compose failed rc={code}: {err[-500:]}")


def concat(parts: list[Path], out: Path, timeout_s: float = 120.0) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        for p in parts:
            f.write(f"file '{p.as_posix()}'\n")
        list_file = f.name
    try:
        code, err = run(["-f", "concat", "-safe", "0", "-i", list_file,
                         "-c", "copy", str(out)], timeout_s)
        if code != 0 or not out.exists() or out.stat().st_size == 0:
            raise RuntimeError(f"ffmpeg concat failed rc={code}: {err[-500:]}")
    finally:
        Path(list_file).unlink(missing_ok=True)


def thumbnail(video: Path, out: Path, at_s: float = 1.0,
              timeout_s: float = 60.0) -> None:
    code, err = run(["-ss", f"{max(at_s, 0):.2f}", "-i", str(video),
                     "-frames:v", "1", str(out)], timeout_s)
    if code != 0 or not out.exists():
        raise RuntimeError(f"ffmpeg thumbnail failed rc={code}: {err[-500:]}")


def _esc(path: str) -> str:
    return path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
