"""Klangi – der KI-Roboter der Klangwerkstatt (Kimi / Moonshot API).

Baut Song-Ideen fuer Kinder: Schlagzeug-Muster, Arrangement-Bausteine und
freundliche Erklaertexte. Faellt die API aus, uebernimmt ein lokaler
Musik-Generator – die App bleibt immer benutzbar.
"""
from __future__ import annotations

import json
import os
import random
import re

import requests

BASE_URL = os.environ.get("KIMI_BASE_URL", "https://api.moonshot.ai/v1")
API_KEY = os.environ.get("KIMI_API_KEY", "")
MODEL = os.environ.get("KIMI_MODEL", "kimi-k2.6")

PROMPT = """Du bist „Klangi“, ein freundlicher Musik-Roboter fuer Kinder ab 6 Jahren.
Ein Kind baut gerade einen Song. Tempo: {bpm} BPM, Tonart: {key} {scale}.

Verfuegbare Sounds (mit Emoji):
{sounds}

Der Wunsch des Kindes: „{wunsch}“

Baue einen Song! Antworte NUR mit JSON in diesem Format:
{{
  "gruss": "ein kurzer, begeisterter Satz an das Kind (max 12 Woerter, mit Emoji)",
  "muster": {{
    "<sound_id>": [0 oder 1, ... genau 16 Zahlen]
  }},
  "bausteine": [
    {{"name": "Intro", "emoji": "🌅", "takte": 2, "spuren": ["<sound_id>", ...]}},
    {{"name": "Groove", "emoji": "🎵", "takte": 4, "spuren": [...]}},
    {{"name": "Hit", "emoji": "🎉", "takte": 4, "spuren": [...]}}
  ],
  "tipp": "ein kurzer Musik-Tipp fuer Kinder (max 15 Woerter)"
}}

Regeln:
- Nur sound_ids aus der Liste verwenden, mindestens 4 verschiedene.
- Muster: 16 Schritte = 1 Takt (16tel). Kick-artige Sounds auf 1/5/9/13,
  Snare-artige auf 5/13, Hats oft auf geraden Schritten.
- Melodie-Sounds sparsam setzen (max 6 Toene pro Takt).
- Bausteine sollen von ruhig nach laut wachsen.
"""


def _extract_json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def _lokaler_generator(sounds: list[dict], bpm: float) -> dict:
    """Fallback ohne Netz: musikalische Zufallsmuster."""
    rnd = random.Random()
    muster = {}
    drums, mel = [], []
    for s in sounds:
        cat = s.get("kategorie", "")
        if cat in ("drums", "percussion"):
            drums.append(s)
        else:
            mel.append(s)
    for s in drums:
        n = s["name"].lower()
        p = [0] * 16
        if any(k in n for k in ("kick", "bass", "bd", "rohbeat", "bumm")):
            for i in (0, 4, 8, 12):
                p[i] = 1
        elif any(k in n for k in ("snare", "sd", "clap", "klatsch")):
            p[4] = p[12] = 1
        else:  # hats/percussion
            for i in range(0, 16, 2):
                p[i] = 1 if rnd.random() < 0.8 else 0
        muster[s["id"]] = p
    for s in mel:
        p = [0] * 16
        for i in rnd.sample(range(16), k=rnd.randint(2, 4)):
            p[i] = 1
        muster[s["id"]] = p
    ids_d = [s["id"] for s in drums][:3]
    ids_all = [s["id"] for s in sounds]
    return {
        "gruss": "Ich habe dir einen Song gebastelt! 🎶",
        "muster": muster,
        "bausteine": [
            {"name": "Intro", "emoji": "🌅", "takte": 2, "spuren": ids_d[:1]},
            {"name": "Groove", "emoji": "🎵", "takte": 4, "spuren": ids_d},
            {"name": "Hit", "emoji": "🎉", "takte": 4, "spuren": ids_all},
        ],
        "tipp": "Leise anfangen, dann immer mehr Sounds dazunehmen! 🚀",
        "quelle": "lokal",
    }


def baue_song(sounds: list[dict], bpm: float, key: str, scale: str,
              wunsch: str) -> dict:
    if not API_KEY:
        return _lokaler_generator(sounds, bpm) | {"quelle": "lokal-kein-key"}
    sound_liste = "\n".join(
        f"- id={s['id']}  {s.get('emoji','🎵')} {s['name']} ({s.get('kategorie','?')})"
        for s in sounds)
    try:
        r = requests.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {API_KEY}",
                     "Content-Type": "application/json"},
            json={
                "model": MODEL,
                "messages": [{"role": "user",
                              "content": PROMPT.format(
                                  bpm=bpm, key=key, scale=scale,
                                  sounds=sound_liste, wunsch=wunsch or "Überrasch mich!")}],
                "temperature": 0.9,
                "max_tokens": 2000,
            },
            timeout=45)
        if r.status_code == 400 and "temperature" in r.text:
            return baue_song_retry_ohne_temp(sounds, bpm, key, scale, wunsch)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
        data = _extract_json(text)
        if data and "muster" in data:
            data["quelle"] = "kimi"
            return data
    except Exception:
        pass
    return _lokaler_generator(sounds, bpm)


def baue_song_retry_ohne_temp(sounds, bpm, key, scale, wunsch):
    try:
        r = requests.post(
            f"{BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"model": MODEL,
                  "messages": [{"role": "user",
                                "content": PROMPT.format(
                                    bpm=bpm, key=key, scale=scale,
                                    sounds="\n".join(f"- id={s['id']} {s['name']}" for s in sounds),
                                    wunsch=wunsch or "Überrasch mich!")}],
                  "max_tokens": 2000},
            timeout=45)
        r.raise_for_status()
        data = _extract_json(r.json()["choices"][0]["message"]["content"])
        if data and "muster" in data:
            data["quelle"] = "kimi"
            return data
    except Exception:
        pass
    return _lokaler_generator(sounds, bpm)
