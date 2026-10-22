# FastAPI Backend — Participation Traceability Platform

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from contextlib import asynccontextmanager
import os

from app.database import get_db, engine
from app.auth import get_current_user, require_role
from app.api.routes import router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown
    await engine.dispose()

app = FastAPI(
    title="Participation Traceability Platform",
    description="Submission-to-Decision Traceability for Kenya's Legislatures",
    version="1.0.0",
    lifespan=lifespan
)

default_cors_origins = {
    "http://localhost:3000",
    "https://uraia-2.netlify.app",
    "https://uraia1.netlify.app",
}
configured_cors_origins = {
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
}
# Keep the known production sites allowed even if Render has an older
# CORS_ORIGINS value set; deployments can add additional exact origins there.
cors_origins = sorted(default_cors_origins | configured_cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router, prefix="/api/v1")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
