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

# CORS — allow all in dev; in production the frontend is served from the same origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    # Serve any static file that exists in dist (favicons, logo.png, etc.)
    @app.get("/logo.png")
    @app.get("/favicon.svg")
    @app.get("/icons.svg")
    def serve_public_file(file: str = ""):
        # handled by catch-all below
        pass

    # Catch-all: return index.html for all non-API routes (SPA client-side routing)
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index)
else:
    @app.get("/")
    def read_root():
        return {
            "message": "Welcome to the RE-RTC Dispatch Optimizer API",
            "docs": "/docs",
            "status": "Healthy — frontend not built yet, run: cd frontend && npm install && npm run build",
        }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
