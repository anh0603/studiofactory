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
        cwd: str | Path | None = None) -> tuple[int, str]:
    """Run ffmpeg with argv array. Returns (returncode, stderr tail)."""
    exe = require()
    for a in args:
        if not isinstance(a, str) or "\x00" in a:
            raise ValueError("invalid ffmpeg argument")
    proc = subprocess.run([exe, "-y", *args], capture_output=True, text=True,
                          timeout=timeout_s, shell=False,
                          cwd=str(cwd) if cwd else tempfile.gettempdir())
    return proc.returncode, proc.stderr[-2000:]


def compose_scene(image: Path, audio: Path | None, subtitle: Path | None,
                  out: Path, duration_s: float, width: int = 720,
                  height: int = 1280, timeout_s: float = 120.0) -> None:
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
            "-t", f"{max(duration_s, 0.5):.2f}"]
    if audio is not None:
        cmd += ["-c:a", "aac"]
    if subtitle is not None:
        cmd += ["-c:s", "mov_text"]
    if audio is not None:
        cmd += ["-shortest"]
    cmd.append(str(out))
    code, err = run(cmd, timeout_s)
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
