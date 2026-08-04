#!/usr/bin/env python3
"""
Unified Sample Library Scanner — Klangwerkstatt + LOOPTiSCH + FASKA Flow Pro

Scannt ALLE Quellen und schreibt einen vereinigten Index nach
shared-library/_index.json. Das Format ist mit LOOPTiSCHs library_scan.py
kompatibel, aber erweitert um source-App + FASKA-Instrumente.

Quellen:
  1. /Volumes/2TB X8/30-Musik-Archiv/          (~809 WAV/AIFF)
  2. Klangwerkstatt assets/samples/              (~4 WAVs)
  3. LOOPTiSCH flagship/samples/ + library/packs/
  4. FASKA Flow Pro (synth-voices, programmatisch)
  5. iCloud Drive (später, per Symlink)

Ausgabe: shared-library/_index.json
         shared-library/packs/ (Symlinks zu Quellen)
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # klangwerkstatt root
SHARED = ROOT / "shared-library"
PACKS_OUT = SHARED / "packs"
INDEX_OUT = SHARED / "_index.json"

AUDIO_EXT = {".wav", ".aif", ".aiff", ".mp3", ".ogg", ".flac"}

TYPE_RULES = [
    ("kick", re.compile(r"\b(kick|kik|bd|bass\s?drum|bassdrum)\b|(^|[_\-])kd([_\-]|$)", re.I)),
    ("snare", re.compile(r"\b(snare|snr|clap|rimshot|rim|snap|sidestick)\b", re.I)),
    ("hat", re.compile(r"\b(hat|hh|hihat|hi[-_ ]?hat|cymbal|cym|ride|crash|shaker[-_ ]?hat)\b", re.I)),
    ("perc", re.compile(r"\b(perc|tom|conga|bongo|shaker|tamb(ourine)?|cowbell|wood|clave|guiro|bell|agogo|triangle|tabla|djembe)\b", re.I)),
    ("loop", re.compile(r"\b(loop|break|brk|groove|beat|rhythm|fill|drumloop)\b", re.I)),
    ("melodic", re.compile(r"\b(bass|sub|808|keys|piano|rhodes|lead|pluck|pad|chord|synth|melod|arp|vox|vocal|stab|string|guitar|flute|horn)\b", re.I)),
    ("fx", re.compile(r"\b(fx|sweep|riser|impact|downlifter|atmos|drone|noise)\b", re.I)),
]

BPM_RE = re.compile(r"(?:^|[^0-9])((?:[6-9]\d|1\d\d|200))\s?(?:bpm|BPM)(?:[^0-9]|$)")
BPM_RE2 = re.compile(r"(?:^|[_\-\s])((?:[6-9]\d|1\d\d|200))(?:[_\-\s]|$)")

TAG_WORDS = {
    "dusty": re.compile(r"dust|vinyl|lofi|lo-fi|old|vintage", re.I),
    "hard": re.compile(r"hard|909|dist|punch|aggro", re.I),
    "open": re.compile(r"open|_oh\b|\boh\b", re.I),
    "closed": re.compile(r"closed|_ch\b|\bch\b", re.I),
    "sub": re.compile(r"\bsub\b|808", re.I),
    "bass": re.compile(r"\bbass\b|808", re.I),
    "break": re.compile(r"break|amen|funky", re.I),
    "clap": re.compile(r"clap", re.I),
    "room": re.compile(r"room|live|hall", re.I),
    "dry": re.compile(r"\bdry\b", re.I),
    "analog": re.compile(r"analog|analogue|machine|drm|tr[-_ ]?\d{3}", re.I),
    "house": re.compile(r"house|deep|garage", re.I),
}


def stable_id(relpath: str) -> str:
    h = hashlib.md5(relpath.encode("utf-8")).hexdigest()[:10]
    return f"pk_{h}"


def wav_duration(path: Path) -> float | None:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as w:
                frames = w.getnframes()
                rate = w.getframerate()
                if rate and rate > 0:
                    return round(frames / float(rate), 3)
        except Exception:
            pass
    return None


def guess_type(name: str, folder: str, duration: float | None) -> str:
    blob = f"{name} {folder}"
    for typ, rx in TYPE_RULES:
        if rx.search(blob):
            if typ in ("kick", "snare", "hat", "perc") and duration and duration > 2.5:
                return "loop"
            return typ
    if duration and duration > 2.5:
        return "loop"
    return "perc"


def classify_audio(name: str, folder: str, duration: float | None, size: int) -> str:
    """Classify audio: one-shot vs loop vs full-track."""
    # Full tracks: > 30 seconds = song, not a sample
    if duration and duration > 30:
        return "full-track"
    # Long loops: 8-30 seconds
    if duration and duration > 8:
        return "long-loop"
    return guess_type(name, folder, duration)


def parse_bpm(name: str, folder: str) -> int:
    for rx in (BPM_RE, BPM_RE2):
        m = rx.search(name) or rx.search(folder)
        if m:
            b = int(m.group(1))
            if 60 <= b <= 200:
                return b
    return 0


def parse_tags(name: str, folder: str, pack_slug: str) -> list[str]:
    blob = f"{name} {folder}"
    tags = [t for t, rx in TAG_WORDS.items() if rx.search(blob)]
    tags.append("real")
    tags.append("pack:" + pack_slug)
    return tags


def scan_source_dir(source_root: Path, pack_slug: str, label: str) -> list[dict]:
    """Scan a directory recursively, return sample dicts."""
    samples = []
    if not source_root.exists():
        return samples
    for f in sorted(source_root.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in AUDIO_EXT:
            continue
        # Skip tiny files (< 1 KB = likely corrupt/metadata)
        try:
            fsize = f.stat().st_size
        except OSError:
            continue
        if fsize < 1000:
            continue
        rel = f.relative_to(ROOT).as_posix() if ROOT in f.parents else str(f)
        name = f.stem
        folder = f.parent.relative_to(source_root).as_posix() if f.parent != source_root else ""
        dur = wav_duration(f)
        typ = classify_audio(name, folder, dur, fsize)
        bpm = parse_bpm(name, folder)
        samples.append({
            "id": stable_id(rel),
            "name": name,
            "path": str(f),   # Absolute path for local access
            "relpath": rel,
            "pack": pack_slug,
            "source": label,
            "type": typ,
            "bpm": bpm,
            "tags": parse_tags(name, folder, pack_slug),
            "duration": dur,
            "size": fsize,
            "ext": f.suffix.lower().lstrip("."),
        })
    return samples


def scan_klangwerkstatt() -> list[dict]:
    """Scan the local Klangwerkstatt samples."""
    return scan_source_dir(
        ROOT / "assets" / "samples",
        "klangwerkstatt-builtin",
        "klangwerkstatt",
    )


def scan_looptisch() -> list[dict]:
    """Scan LOOPTiSCH samples + library packs."""
    lt = Path.home() / "Projects" / "looptisch" / "flagship"
    samples = scan_source_dir(lt / "samples", "looptisch-demo", "looptisch")
    # Library packs
    lib = lt / "library" / "packs"
    if lib.exists():
        for pack_dir in lib.iterdir():
            if pack_dir.is_dir():
                samples += scan_source_dir(
                    pack_dir, f"looptisch-{pack_dir.name}", "looptisch"
                )
    return samples


def scan_x8_musikarchiv() -> list[dict]:
    """Scan Ralfs Musik-Archiv auf der X8."""
    x8 = Path("/Volumes/2TB X8/30-Musik-Archiv")
    if not x8.exists():
        print("[scanner] X8 nicht gemountet — skip", file=sys.stderr)
        return []
    samples = []
    # Top-level folders as separate "packs"
    for d in sorted(x8.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            slug = f"x8-{d.name[:30].replace(' ', '-').lower()}"
            samples += scan_source_dir(d, slug, "x8-musikarchiv")
    return samples


def scan_x8_klangwerkstatt_old() -> list[dict]:
    """Scan old Klangwerkstatt backup on X8."""
    x8 = Path("/Volumes/2TB X8/40-Projekte-Archiv-ruhend/klangwerkstatt-2026-07/assets/samples")
    return scan_source_dir(x8, "klangwerkstatt-old-x8", "x8-klangwerkstatt-old")


def gen_faska_instruments() -> list[dict]:
    """Generate FASKA Flow Pro synth instruments as index entries."""
    # These are programmatic Web Audio synths from FASKA — no files,
    # but we register them so Klangwerkstatt/LOOPTiSCH can reference them.
    voices = [
        # From sounds_drums.js
        {"id": "faska-kick", "name": "FASKA Kick", "type": "kick",
         "tags": ["synth", "faska", "kick"], "bpm": 0},
        {"id": "faska-snare", "name": "FASKA Snare", "type": "snare",
         "tags": ["synth", "faska", "snare"], "bpm": 0},
        {"id": "faska-hat", "name": "FASKA Hi-Hat", "type": "hat",
         "tags": ["synth", "faska", "hat"], "bpm": 0},
        {"id": "faska-tom", "name": "FASKA Tom", "type": "perc",
         "tags": ["synth", "faska", "tom"], "bpm": 0},
        # From sounds_basses.js
        {"id": "faska-bass", "name": "FASKA Bass", "type": "melodic",
         "tags": ["synth", "faska", "bass"], "bpm": 0},
        {"id": "faska-sub", "name": "FASKA Sub Bass", "type": "melodic",
         "tags": ["synth", "faska", "sub", "bass"], "bpm": 0},
        # From sounds_leads.js
        {"id": "faska-lead", "name": "FASKA Lead", "type": "melodic",
         "tags": ["synth", "faska", "lead"], "bpm": 0},
        {"id": "faska-pluck", "name": "FASKA Pluck", "type": "melodic",
         "tags": ["synth", "faska", "pluck"], "bpm": 0},
        # From sounds_acoustic.js
        {"id": "faska-piano", "name": "FASKA Piano", "type": "melodic",
         "tags": ["synth", "faska", "piano"], "bpm": 0},
        # From sounds_electronic.js
        {"id": "faska-pad", "name": "FASKA Pad", "type": "melodic",
         "tags": ["synth", "faska", "pad"], "bpm": 0},
    ]
    return [
        {
            "id": v["id"],
            "name": v["name"],
            "path": f"snippet:faska:{v['id']}",
            "pack": "faska-flow-pro",
            "source": "faska-flow-pro",
            "type": v["type"],
            "bpm": v["bpm"],
            "tags": v["tags"],
            "duration": None,
            "size": 0,
            "ext": "synth",
        }
        for v in voices
    ]


def scan_shared_packs() -> list[dict]:
    """Scan downloaded packs in shared-library/packs/, each subdir = one pack."""
    packs_root = SHARED / "packs"
    if not packs_root.exists():
        return []
    samples = []
    for pack_dir in sorted(p for p in packs_root.iterdir() if p.is_dir()):
        slug = f"download-{pack_dir.name[:30]}"
        samples += scan_source_dir(pack_dir, slug, "downloads")
    return samples


def scan_all() -> dict:
    all_samples: list[dict] = []
    packs: dict[str, dict] = {}

    sources = [
        ("Klangwerkstatt lokal", scan_klangwerkstatt),
        ("LOOPTiSCH", scan_looptisch),
        ("X8 Musik-Archiv", scan_x8_musikarchiv),
        ("X8 Klangwerkstatt old", scan_x8_klangwerkstatt_old),
        ("Shared Packs (Downloads)", scan_shared_packs),
    ]

    for label, fn in sources:
        samples = fn()
        print(f"  {label}: {len(samples)} Dateien")
        all_samples += samples

    # FASKA instruments
    faska = gen_faska_instruments()
    print(f"  FASKA Flow Pro: {len(faska)} Synth-Voices")
    all_samples += faska

    # Build pack summaries
    for s in all_samples:
        pk = s["pack"]
        if pk not in packs:
            packs[pk] = {"slug": pk, "source": s["source"], "count": 0}
        packs[pk]["count"] += 1

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scanner_version": "1.0.0",
        "total_samples": len(all_samples),
        "packs": sorted(packs.values(), key=lambda p: p["slug"]),
        "samples": all_samples,
    }

    SHARED.mkdir(exist_ok=True)
    INDEX_OUT.write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return out


if __name__ == "__main__":
    print("=" * 60)
    print("🎛️  Unified Sample Library Scanner")
    print("=" * 60)
    data = scan_all()
    n = data["total_samples"]
    p = len(data["packs"])
    by_type: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for s in data["samples"]:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1
        by_source[s["source"]] = by_source.get(s["source"], 0) + 1
    print(f"\n📊 TOTAL: {n} Samples in {p} Packs")
    print(f"   Types: {by_type}")
    print(f"   Sources: {by_source}")
    print(f"\n💾 Index geschrieben: {INDEX_OUT}")
    print(f"   Größe: {INDEX_OUT.stat().st_size / 1024:.1f} KB")
