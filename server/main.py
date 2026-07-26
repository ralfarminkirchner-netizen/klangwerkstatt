"""Klangwerkstatt Server – kindgerechte Musik-App mit KI-Zauber.

Start lokal:  uvicorn main:app --host 0.0.0.0 --port 8000
Railway:      uvicorn main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    from server import audio_ai
    from server import kimi_client
except ImportError:
    import audio_ai
    import kimi_client

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SAMPLES_DIR = ASSETS / "samples"

app = FastAPI(title="Klangwerkstatt 🎵")


def _manifest() -> list[dict]:
    mf = SAMPLES_DIR / "samples.json"
    if mf.exists():
        return json.loads(mf.read_text(encoding="utf-8"))
    return []


@app.get("/api/samples")
def samples():
    return {"samples": _manifest()}


@app.post("/api/ki/song")
async def ki_song(payload: dict):
    bpm = float(payload.get("bpm", 100))
    key = payload.get("key", "C")
    scale = payload.get("scale", "dur")
    wunsch = str(payload.get("wunsch", ""))[:200]
    sounds = _manifest()
    if payload.get("sounds"):
        ids = {s["id"] for s in payload["sounds"] if isinstance(s, dict)}
        sounds = [s for s in sounds if s["id"] in ids] or sounds
    ergebnis = kimi_client.baue_song(sounds, bpm, key, scale, wunsch)
    return ergebnis


@app.post("/api/audio/fit")
async def audio_fit(file: UploadFile = File(...),
                    bpm: float = Form(100.0),
                    key: str = Form("C"),
                    scale: str = Form("dur")):
    """Sample in Takt + Tonart des Songs zaubern."""
    data = await file.read()
    if len(data) > 30_000_000:
        return JSONResponse({"fehler": "Datei zu groß"}, status_code=413)
    try:
        y, sr = audio_ai.load_audio(data)
        if not audio_ai.AUDIO_KI:
            return JSONResponse({"ok": False, "fehler": "Zauber schläft - auf Railway muss libsndfile1 installiert sein"}, status_code=200)
        y2, info = audio_ai.fit_to_beat(y, sr, bpm, key, scale)
        return JSONResponse({
            "ok": True,
            "info": info,
            "wav_hex": audio_ai.to_wav_bytes(y2, sr).hex(),
        })
    except Exception as e:  # Kindgerecht: nie haengen bleiben
        return JSONResponse({"ok": False, "fehler": str(e)}, status_code=200)


@app.post("/api/audio/tune")
async def audio_tune(file: UploadFile = File(...),
                     key: str = Form("C"),
                     scale: str = Form("dur"),
                     strength: float = Form(1.0),
                     auto_key: bool = Form(False)):
    """Autotune: schiefe Toene auf die Tonart richten."""
    data = await file.read()
    if len(data) > 30_000_000:
        return JSONResponse({"fehler": "Datei zu groß"}, status_code=413)
    try:
        y, sr = audio_ai.load_audio(data)
        if not audio_ai.AUDIO_KI:
            return JSONResponse({"ok": False, "fehler": "Zauber schläft - auf Railway muss libsndfile1 installiert sein"}, status_code=200)
        if auto_key:
            key, scale = audio_ai.detect_key(y, sr)
        y2, info = audio_ai.autotune(y, sr, key, scale,
                                     max(0.0, min(1.0, strength)))
        return JSONResponse({
            "ok": True,
            "key": key,
            "scale": scale,
            "info": info,
            "wav_hex": audio_ai.to_wav_bytes(y2, sr).hex(),
        })
    except Exception as e:
        return JSONResponse({"ok": False, "fehler": str(e)}, status_code=200)


@app.get("/api/health")
def health():
    return {"status": "ok", "samples": len(_manifest()),
            "ki": bool(os.environ.get("KIMI_API_KEY"))}


@app.post("/api/ki/lyrics")
async def ki_lyrics(payload: dict):
    """Generiert Songtexte + Style-Tags aus einem Prompt (Kimi oder Fallback)."""
    prompt = str(payload.get("prompt", ""))[:300]
    wunsch = str(payload.get("wunsch", ""))[:200]
    style = str(payload.get("style", "fröhlich"))
    bpm = float(payload.get("bpm", 100))
    key = payload.get("key", "C")
    scale = payload.get("scale", "dur")

    if os.environ.get("KIMI_API_KEY"):
        try:
            import requests
            r = requests.post(
                f"{os.environ.get('KIMI_BASE_URL', 'https://api.moonshot.ai/v1')}/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['KIMI_API_KEY']}",
                         "Content-Type": "application/json"},
                json={
                    "model": os.environ.get("KIMI_MODEL", "kimi-k2.6"),
                    "messages": [{"role": "user", "content": (
                        f"Schreibe einen KINDERLIED-TEXT (deutsch) zu diesem Thema: {prompt}\n"
                        f"Stil: {style}, Tempo: {bpm} BPM, Tonart: {key} {scale}.\n"
                        f"Der Text soll 2 Strophen und einen Refrain haben. Struktur: [Strophe], [Refrain].\n"
                        f"Reime, einfache Wörter, max 12 Zeilen. NUR den Text, keine Erklärungen.\n"
                        f"Am Ende eine Zeile 'TAGS: tag1, tag2, tag3' mit 3 Musikstil-Tags."
                    )}],
                    "temperature": 0.9, "max_tokens": 500,
                },
                timeout=30)
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                # Lyrics + Tags trennen
                if "TAGS:" in content:
                    parts = content.rsplit("TAGS:", 1)
                    lyrics = parts[0].strip()
                    tags = parts[1].strip()
                else:
                    lyrics = content.strip()
                    tags = style.lower().replace(" ", ",")
                return {"lyrics": lyrics, "tags": tags}
        except Exception:
            pass

    # Fallback-Lyrics (offline)
    return {
        "lyrics": (
            f"[Strophe]\n{prompt}, das ist unser Lied\n"
            f"Wir singen laut, dass jeder es sieht\n"
            f"Mit einem Lächeln und ganz viel Schwung\n"
            f"So macht Musik doch jedem Jung!\n\n"
            f"[Refrain]\nOh-oh-oh, wir singen heut\n"
            f"Oh-oh-oh, das ist uns're Zeit\n"
            f"Komm mach mit und tanz im Takt\n"
            f"Bis die ganze Erde lacht!"
        ),
        "tags": style.lower().replace(" ", ","),
    }


# --- Frontend statisch ausliefern ---
app.mount("/assets", StaticFiles(directory=ASSETS), name="assets")


@app.get("/{datei:path}")
def frontend(datei: str = ""):
    if datei in ("app.js", "style.css", "manifest.json", "sw.js"):
        return FileResponse(ROOT / datei)
    return FileResponse(ROOT / "index.html")
