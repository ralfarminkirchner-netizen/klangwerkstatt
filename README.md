# 🎵 Klangwerkstatt

**Die kindgerechte Musik-App mit KI-Zauber** – Beats bauen wie bei FruityLoops,
aber mit Bildern, großen Knöpfen und einem Roboter, der hilft.

![App](https://img.shields.io/badge/für-Kinder_ab_6-ff5d5d) ![KI](https://img.shields.io/badge/KI-Kimi%20(Moonshot)-a06cd5)

## Was kann die App?

| Screen | Was Kinder dort machen |
|---|---|
| 🥁 **Beat** | 16-Schritte-Sequencer mit bunten Emoji-Spuren. Tempo mit 🐢/🐰-Regler. |
| 🎹 **Pads** | Sound-Pads zum Antippen. Eigene Sounds aufnehmen – der **✨Auto-Zauber** schneidet sie in den Takt. |
| 🎤 **Singen** | Stimme aufnehmen, **✨Stimmen-Zauber** richtet schiefe Töne (Autotune-Effekt, Stärke von 🐭 bis 🤖). |
| 🧩 **Song** | Bausteine A/B/C zum Song reihen – oder **Klangi** (KI) baut auf Wunsch einen ganzen Song. |
| 🎛️ **überall** | Echo 🌀, Halle 🏰 und Roboter-Stimme 🤖 als große Regler. |

## Die KI dahinter

1. **Klangi (Kimi/Moonshot-LLM)** schlägt Schlagzeug-Muster, Baustein-Struktur
   und kindgerechte Tipps vor (`/api/ki/song`). Fällt die API aus, baut ein
   lokaler Generator musikalische Muster – die App geht immer.
2. **Audio-Zauber (librosa, lokal im Server)**: erkennt Tempo & Tonart von
   Samples, dehnt sie in den Takt (Time-Stretch), stimmt sie auf die
   Song-Tonart (Pitch-Shift) und schneidet sie auf ganze Takte (`/api/audio/fit`).
3. **Stimmen-Zauber**: Pitch-Tracking (pYIN) + Korrektur auf die nächsten Töne
   der gewählten Tonart (`/api/audio/tune`).

## Lokal starten

```bash
cd server
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export KIMI_API_KEY=sk-...        # optional, ohne Key läuft der lokale Generator
uvicorn main:app --port 8000
```

Dann http://localhost:8000 öffnen. **Ohne Server** funktioniert ein Doppelklick
auf `index.html` auch – mit Synthesizer-Sounds, aber ohne KI-Zauber.

## Eigene Samples einbauen

```bash
python3 tools/import_samples.py    # Ralfs iCloud-Samples (Loop-Spuren, FIFA-Beat)
python3 tools/make_fallback_kit.py # Synth-Grundkit (Stdlib, immer verfügbar)
```

Neue Sounds einfach als WAV nach `assets/samples/` legen und in
`assets/samples/samples.json` mit Emoji eintragen.

## Railway

`railway up` im Repo-Root – `railway.toml` startet den Server automatisch.
Umgebungsvariablen: `KIMI_API_KEY` (Pflicht für LLM-Songs), optional
`KIMI_BASE_URL` (Default `https://api.moonshot.ai/v1`) und `KIMI_MODEL`
(Default `kimi-k2.6`).

## Datenschutz

Aufnahmen bleiben im Browser (localStorage). Nur wenn ein Zauber-Knopf gedrückt
wird, geht der Audio-Schnipsel an den eigenen Server – nirgendwo sonst hin.
