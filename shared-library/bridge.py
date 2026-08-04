#!/usr/bin/env python3
"""
Klangwerkstatt Unified Library Bridge

Serves the shared sample library to all three apps:
  - Klangwerkstatt (/:8000)
  - LOOPTiSCH (/:8777)
  - FASKA Flow Pro (/:5173)

Plus connects to the Buzz relay for agentic orchestration.

Usage:
  cd ~/klangwerkstatt && python3 shared-library/bridge.py
  → http://127.0.0.1:8778/api/samples
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared-library"
INDEX_PATH = SHARED / "_index.json"

# Load index
_index_cache: Optional[dict] = None
_index_mtime: float = 0


def load_index() -> dict:
    global _index_cache, _index_mtime
    try:
        mtime = INDEX_PATH.stat().st_mtime
    except FileNotFoundError:
        _index_cache = {"samples": [], "packs": [], "total_samples": 0}
        return _index_cache
    if _index_cache is not None and mtime <= _index_mtime:
        return _index_cache
    with open(INDEX_PATH, "r", encoding="utf-8") as f:
        _index_cache = json.load(f)
    _index_mtime = mtime
    return _index_cache


app = FastAPI(
    title="Klangwerkstatt Unified Library",
    description="Shared sample library for Klangwerkstatt + LOOPTiSCH + FASKA Flow Pro",
    version="2.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    idx = load_index()
    return {
        "status": "ok",
        "library": f"{idx['total_samples']} samples, {len(idx['packs'])} packs",
        "buzz_relay": bool(os.environ.get("BUZZ_RELAY_URL")),
        "last_scan": idx.get("generated_at", "never"),
    }


@app.get("/api/samples")
def list_samples(
    type: Optional[str] = Query(None, description="Filter: kick, snare, hat, perc, loop, melodic, full-track, long-loop"),
    pack: Optional[str] = Query(None, description="Filter by pack slug"),
    source: Optional[str] = Query(None, description="Filter: klangwerkstatt, looptisch, x8-musikarchiv, faska-flow-pro"),
    bpm_min: Optional[int] = Query(None, ge=20, le=300),
    bpm_max: Optional[int] = Query(None, ge=20, le=300),
    search: Optional[str] = Query(None, description="Search in name + tags"),
    limit: int = Query(200, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    idx = load_index()
    samples = idx["samples"]

    if type:
        samples = [s for s in samples if s["type"] == type]
    if pack:
        samples = [s for s in samples if s["pack"] == pack]
    if source:
        samples = [s for s in samples if s["source"] == source]
    if bpm_min is not None:
        samples = [s for s in samples if s["bpm"] >= bpm_min]
    if bpm_max is not None:
        samples = [s for s in samples if s["bpm"] <= bpm_max]
    if search:
        q = search.lower()
        samples = [
            s
            for s in samples
            if q in s["name"].lower() or any(q in t.lower() for t in s.get("tags", []))
        ]

    total = len(samples)
    page = samples[offset : offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "samples": page,
    }


@app.get("/api/samples/{sample_id}")
def get_sample(sample_id: str):
    idx = load_index()
    for s in idx["samples"]:
        if s["id"] == sample_id:
            return s
    return JSONResponse({"error": "not found"}, status_code=404)


@app.get("/api/packs")
def list_packs():
    idx = load_index()
    return {"packs": idx["packs"]}


@app.get("/api/stats")
def stats():
    idx = load_index()
    by_type: dict = {}
    by_source: dict = {}
    by_pack: dict = {}
    for s in idx["samples"]:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1
        by_source[s["source"]] = by_source.get(s["source"], 0) + 1
        by_pack[s["pack"]] = by_pack.get(s["pack"], 0) + 1
    return {
        "total": idx["total_samples"],
        "packs_count": len(idx["packs"]),
        "by_type": by_type,
        "by_source": by_source,
        "by_pack": by_pack,
    }


@app.get("/api/file/{sample_id:path}")
def serve_file(sample_id: str):
    """Serve a sample file directly (stream from disk)."""
    idx = load_index()
    for s in idx["samples"]:
        if s["id"] == sample_id:
            path = s.get("path", "")
            if path and os.path.isfile(path):
                return FileResponse(path, media_type="audio/wav")
    return JSONResponse({"error": "file not found"}, status_code=404)


@app.post("/api/rescan")
def rescan():
    """Trigger a library rescan."""
    try:
        result = subprocess.run(
            ["python3", str(SHARED / "scanner.py")],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(ROOT),
        )
        global _index_cache
        _index_cache = None  # force reload
        return {"ok": True, "output": result.stdout, "stderr": result.stderr}
    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "scan timed out"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# --- Serve v2 Klangwerkstatt frontend ---
app.mount("/v2", StaticFiles(directory=ROOT / "v2"), name="v2")


@app.get("/")
def frontend():
    """Serve the new v2 Klangwerkstatt UI."""
    return FileResponse(ROOT / "v2" / "index.html")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("LIBRARY_PORT", "8778"))
    print(f"🎛️  Unified Library Bridge → http://127.0.0.1:{port}")
    print(f"   API: http://127.0.0.1:{port}/api/samples")
    print(f"   Docs: http://127.0.0.1:{port}/docs")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
