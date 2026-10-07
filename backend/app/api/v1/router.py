"""API v1 router composition. Future modules mount here without changing prefix."""
from __future__ import annotations

from fastapi import APIRouter

from .affiliate import router as affiliate_router
from .ai import router as ai_router
from .analytics import router as analytics_router
from .autopilot import router as autopilot_router
from .diagnostics import router as diagnostics_router
from .director import router as director_router
from .files import router as files_router
from .health import router as health_router
from .jobs import router as jobs_router
from .media import router as media_router
from .publisher import router as publisher_router
from .settings import router as settings_router
from .story import router as story_router

router = APIRouter()
router.include_router(health_router, tags=["health"])
router.include_router(diagnostics_router, tags=["diagnostics"])
router.include_router(files_router, tags=["files"])
router.include_router(ai_router, tags=["ai"])
router.include_router(story_router, tags=["story"])
router.include_router(director_router, tags=["director"])
router.include_router(media_router, tags=["media"])
router.include_router(autopilot_router, tags=["automation"])
router.include_router(publisher_router, tags=["publisher"])
router.include_router(settings_router, tags=["settings"])
router.include_router(affiliate_router, tags=["affiliate"])
router.include_router(analytics_router, tags=["analytics"])
router.include_router(jobs_router, tags=["jobs"])
router.include_router(diagnostics_router, tags=["diagnostics"])
