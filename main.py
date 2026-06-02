import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import schedule, generation, psp, export

app = FastAPI(
    title="RE-RTC Dispatch Optimizer API",
    description="Backend optimization engine for Aditya Birla Renewables' 100 MW RTC PPA with Hindalco Industries.",
    version="1.0.0"
)

# CORS — dev: allow all; production: same-origin (frontend served by FastAPI itself)
_ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(schedule.router, prefix="/api", tags=["Scheduling"])
app.include_router(generation.router, prefix="/api", tags=["Raw Generation"])
app.include_router(psp.router, prefix="/api/psp", tags=["PSP Storage"])
app.include_router(export.router, prefix="/api", tags=["Export"])

# ── Serve the built React frontend (production) ──────────────────────────────
# The frontend/dist directory is created by `npm run build` inside frontend/.
# In development, the Vite dev server (port 5173) handles the frontend.
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

if os.path.isdir(FRONTEND_DIST):
    # Mount the entire dist directory — StaticFiles with html=True serves
    # index.html as fallback for any path not matched by an API route,
    # which is exactly what a SPA (React Router) needs.
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIST, html=True),
        name="frontend",
    )
else:
    @app.get("/")
    def read_root():
        return {
            "message": "RE-RTC Dispatch Optimizer API is running.",
            "docs": "/docs",
            "status": "Frontend not built. Run: cd frontend && npm install && npm run build",
        }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    # Single worker + reload in dev so schema/code changes apply without a manual restart
    workers = int(os.getenv("WEB_CONCURRENCY", 1))
    use_reload = os.getenv("DEV_RELOAD", "true").lower() in ("1", "true", "yes")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        workers=workers,
        reload=use_reload and workers == 1,
    )
