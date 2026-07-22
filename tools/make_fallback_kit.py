#!/usr/bin/env python3
"""Baut ein Synthesizer-Grundkit als WAVs - rein mit Python-Stdlib.

So funktioniert die App immer, auch ohne iCloud-Samples und ohne pip.
"""
import json
import math
import random
import struct
import wave
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "assets" / "samples"
SR = 44100
random.seed(7)


def speichern(name, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(str(ZIEL / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(
            struct.pack("<h", int(max(-1, min(1, s / peak * 0.9)) * 32767))
            for s in samples))


def kick():
    n, out, phase = int(SR * 0.35), [], 0.0
    for i in range(n):
        t = i / SR
        f = 150 * math.exp(-t * 22) + 45
        phase += 2 * math.pi * f / SR
        out.append(math.sin(phase) * math.exp(-t * 10))
    speichern("kick", out)


def snare():
    n = int(SR * 0.25)
    out = []
    for i in range(n):
        t = i / SR
        noise = random.uniform(-1, 1) * math.exp(-t * 25)
        ton = math.sin(2 * math.pi * 180 * t) * math.exp(-t * 30)
        out.append(noise * 0.7 + ton * 0.5)
    speichern("snare", out)


def hat():
    n = int(SR * 0.08)
    out, prev = [], 0.0
    for i in range(n):
        t = i / SR
        x = random.uniform(-1, 1)
        hp = (x - prev) * math.exp(-t * 60)  # Differenz = einfacher Hochpass
        prev = x
        out.append(hp)
    speichern("hat", out)


def pluck():
    n = int(SR * 0.6)
    out = []
    for i in range(n):
        t = i / SR
        out.append((math.sin(2 * math.pi * 261.6 * t)
                    + 0.5 * math.sin(2 * math.pi * 523.2 * t)) * math.exp(-t * 6))
    speichern("pluck", out)


MANIFEST = [
    {"id": "kick", "name": "Bumm", "emoji": "🥁", "kategorie": "drums", "url": "assets/samples/kick.wav", "color": "#ff5d5d"},
    {"id": "snare", "name": "Klatsch", "emoji": "👏", "kategorie": "drums", "url": "assets/samples/snare.wav", "color": "#4d9fff"},
    {"id": "hat", "name": "Tss", "emoji": "✨", "kategorie": "drums", "url": "assets/samples/hat.wav", "color": "#ffc93c"},
    {"id": "pluck", "name": "Pling", "emoji": "🎹", "kategorie": "melodie", "url": "assets/samples/pluck.wav", "color": "#3ecf8e"},
]


def main():
    ZIEL.mkdir(parents=True, exist_ok=True)
    kick(); snare(); hat(); pluck()
    mf = ZIEL / "samples.json"
    alt = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else []
    ids = {s["id"] for s in alt}
    neu = alt + [s for s in MANIFEST if s["id"] not in ids]
    mf.write_text(json.dumps(neu, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Fallback-Kit gebaut. Manifest: {len(neu)} Sounds.")


if __name__ == "__main__":
    main()
