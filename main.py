import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import schedule, generation, psp, export

app = FastAPI(
    title="RE-RTC Dispatch Optimizer API",
    description="Backend optimization engine for Aditya Birla Renewables' 100 MW RTC PPA with Hindalco Industries.",
    version="1.0.0"
)

# Enable CORS for Next.js frontend calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For demo purposes, allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(schedule.router, prefix="/api", tags=["Scheduling"])
app.include_router(generation.router, prefix="/api", tags=["Raw Generation"])
app.include_router(psp.router, prefix="/api/psp", tags=["PSP Storage"])
app.include_router(export.router, prefix="/api", tags=["Export"])

@app.get("/")
def read_root():
    return {
        "message": "Welcome to the RE-RTC Dispatch Optimizer API",
        "docs": "/docs",
        "status": "Healthy"
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
