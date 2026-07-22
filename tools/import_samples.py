#!/usr/bin/env python3
"""Importiert Ralfs Samples aus iCloud in die Klangwerkstatt.

- Prueft zuerst, ob Dateien wirklich lokal sind (iCloud 'dataless'!).
- Konvertiert alles nach 44.1kHz/16bit WAV via afconvert (macOS-Bordmittel).
- Schreibt assets/samples/samples.json mit Emoji + Kategorie + Farbe.
"""
import json
import subprocess
import sys
from pathlib import Path

ZIEL = Path(__file__).resolve().parent.parent / "assets" / "samples"
BASIS = Path("/Users/raki/Library/Mobile Documents/com~apple~CloudDocs/NRA Alles 2")
LOOP = BASIS / "NRA Musik Zeitlos ua/02_Archiv_Alte Tracks/Just Rockin Projekt/Loop-Spuren"
FIFA = BASIS / "NRA_Demobeatz & Schrottskizzen/FIFA-Beat YO"

# (Quelldatei, id, Anzeigename, Emoji, Kategorie)
AUSWAHL = [
    (LOOP / "Bass/BD_Wirrollen_Roland_01.WAV", "roland_kick", "Roland Kick", "🦵", "drums"),
    (LOOP / "^SD07 2.WAV", "sd07", "Schnarr", "🥁", "drums"),
    (LOOP / "CHH.WAV", "chh", "Tss", "✨", "drums"),
    (LOOP / "HICLS.WAV", "hicls", "Tik", "🥢", "drums"),
    (LOOP / "D_Tambhit.wav", "tamb", "Schelle", "🔔", "drums"),
    (LOOP / "raggabass06 2.WAV", "ragga", "Wumms", "🌋", "drums"),
    (LOOP / "Popakademieloops/loopA01.wav", "loop_a", "Loop A", "🌀", "loop"),
    (LOOP / "Popakademieloops/ROHBEAT.WAV", "rohbeat", "Roh-Beat", "🧱", "loop"),
    (LOOP / "Popakademieloops/BASSROH.WAV", "bassroh", "Bass-Roh", "🎸", "loop"),
    (LOOP / "reason_mica_loops/Piano_standard.wav", "piano", "Klavier", "🎹", "melodie"),
    (LOOP / "reason_mica_loops/Piano_abgeh_01.wav", "piano_abgeh", "Piano-Frosch", "🐸", "melodie"),
    (LOOP / "reason_mica_loops/Quak_01.wav", "quak1", "Quak 1", "🦆", "melodie"),
    (LOOP / "reason_mica_loops/Quak_03.wav", "quak3", "Quak 3", "🦆", "melodie"),
    (LOOP / "reason_mica_loops/sirene_malstroem.wav", "sirene", "Sirene", "🚨", "effekt"),
    (FIFA / "FIFA-Beat1_Drums.wav", "fifa_drums", "FIFA Drums", "⚽", "loop"),
    (FIFA / "FIFA-Beat1_Bass1.wav", "fifa_bass", "FIFA Bass", "🕹️", "loop"),
    (FIFA / "FIFA-Beat1_Melodie.wav", "fifa_mel", "FIFA Melodie", "🎮", "melodie"),
    (FIFA / "FIFA-Beat1_Beatbox.wav", "fifa_box", "Beatbox", "👄", "loop"),
]

FARBEN = ["#ff5d5d", "#4d9fff", "#3ecf8e", "#ffc93c", "#a06cd5", "#ff9f43", "#ef5da8", "#00c2a8"]


def ist_dataless(p: Path) -> bool:
    try:
        out = subprocess.run(["stat", "-f", "%Sf", str(p)], capture_output=True, text=True).stdout
        return "dataless" in out
    except Exception:
        return True


def main() -> int:
    ZIEL.mkdir(parents=True, exist_ok=True)
    manifest, fehlend = [], []
    for i, (src, sid, name, emoji, kat) in enumerate(AUSWAHL):
        if not src.exists() or ist_dataless(src):
            fehlend.append(str(src))
            continue
        ziel = ZIEL / f"{sid}.wav"
        r = subprocess.run([
            "afconvert", "-f", "WAVE", "-d", "LEI16@44100", str(src), str(ziel)
        ], capture_output=True, text=True)
        if r.returncode != 0:
            print("KONVERTIER-FEHLER", src.name, r.stderr[:200])
            continue
        manifest.append({
            "id": sid, "name": name, "emoji": emoji, "kategorie": kat,
            "url": f"assets/samples/{sid}.wav", "color": FARBEN[i % len(FARBEN)],
        })
        print("OK ", sid, ziel.stat().st_size // 1024, "KB")

    (ZIEL / "samples.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(manifest)} Samples importiert, {len(fehlend)} nicht greifbar (iCloud).")
    for f in fehlend:
        print("  fehlt:", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
