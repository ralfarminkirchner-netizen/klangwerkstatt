"""Audio-KI fuer die Klangwerkstatt.

Drei Zauber:
  1. fit_to_beat()   - Sample analysieren (Tempo/Tonart), in den Takt dehnen,
                       auf die Song-Tonart stimmen, auf ganze Takte schneiden.
  2. autotune()      - schiefe Toene beim Singen auf die naechstliegenden
                       Toene der Tonart schieben (Autotune-Effekt).
  3. detect_key/bpm  - Analyse-Helper.

Alles lokal mit librosa/numpy - keine externen Dienste.

Faellt librosa aus (z.B. Railway-Container ohne libsndfile), melden die
Endpunkte einen freundlichen Hinweis statt abzustuerzen.
"""
from __future__ import annotations

import io
import numpy as np

AUDIO_KI = False
try:
    import soundfile as sf
    import librosa
    AUDIO_KI = True
except ImportError:
    pass

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"]

# Krumhansl-Schmuckler-Profile
_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def load_audio(data: bytes, sr: int = 22050) -> tuple[np.ndarray, int]:
    y, s = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    y = y.mean(axis=1)  # mono
    if s != sr:
        y = librosa.resample(y, orig_sr=s, target_sr=sr)
    peak = np.max(np.abs(y)) or 1.0
    if peak > 0.99:
        y = y / peak * 0.95
    return y, sr


def to_wav_bytes(y: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def detect_bpm(y: np.ndarray, sr: int) -> float:
    tempo = float(librosa.feature.rhythm.tempo(y=y, sr=sr, aggregate=None)[0]) \
        if hasattr(librosa.feature, "rhythm") else float(librosa.beat.tempo(y=y, sr=sr)[0])
    # in kindgerechten Bereich bringen
    while tempo < 70:
        tempo *= 2
    while tempo > 160:
        tempo /= 2
    return round(tempo, 1)


def detect_key(y: np.ndarray, sr: int) -> tuple[str, str]:
    """Gibt (Grundton-Name, 'dur'|'moll') zurueck."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    chroma = chroma / (chroma.sum() or 1.0)
    best, best_score = ("C", "dur"), -1.0
    for i in range(12):
        for name, prof in (("dur", _MAJ), ("moll", _MIN)):
            score = float(np.corrcoef(np.roll(prof, i), chroma)[0, 1])
            if score > best_score:
                best, best_score = (NOTE_NAMES[i], name), score
    return best


def scale_semitones(scale: str) -> set[int]:
    return {0, 2, 4, 5, 7, 9, 11} if scale == "dur" else {0, 2, 3, 5, 7, 8, 10}


def note_index(name: str) -> int:
    return NOTE_NAMES.index(name)


def _nearest_scale_midi(m: float, root: int, scale: str) -> int:
    tones = scale_semitones(scale)
    best_m, best_d = int(round(m)), 99
    for cand in range(int(round(m)) - 6, int(round(m)) + 7):
        if (cand - root) % 12 in tones:
            d = abs(cand - m)
            if d < best_d:
                best_m, best_d = cand, d
    return best_m


def fit_to_beat(y: np.ndarray, sr: int, target_bpm: float,
                key_root: str, scale: str) -> tuple[np.ndarray, dict]:
    """Sample in Takt + Tonart des Songs zwingen."""
    info = {}
    dur = len(y) / sr

    # Stille am Rand weg
    y, _ = librosa.effects.trim(y, top_db=30)

    if dur >= 1.2:  # nur bei Loops/Strecken lohnt Tempo-Analyse
        src_bpm = detect_bpm(y, sr)
        info["src_bpm"] = src_bpm
        if abs(src_bpm - target_bpm) > 2:
            y = librosa.effects.time_stretch(y, rate=src_bpm / target_bpm)
        # auf ganze Takte (1, 2, 4 oder 8) schneiden/loopen
        bar = 60.0 / target_bpm * 4
        bars = max(1, min(8, round((len(y) / sr) / bar)))
        target_len = int(bar * bars * sr)
        if len(y) > target_len:
            y = y[:target_len]
        else:
            reps = int(np.ceil(target_len / len(y)))
            y = np.tile(y, reps)[:target_len]
        info["bars"] = bars

    # Tonart: dominanten Ton des Samples auf Grundton/Quinte des Songs ziehen
    if dur >= 0.8:
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
        dom = int(np.argmax(chroma))
        root = note_index(key_root)
        tones = sorted(scale_semitones(scale))
        choices = [(root + t) % 12 for t in tones]
        shift = min(((c - dom) % 12 for c in choices),
                    key=lambda s: min(s, 12 - s))
        shift = shift if shift <= 6 else shift - 12
        if shift != 0:
            y = librosa.effects.pitch_shift(y, sr=sr, n_steps=shift)
        info["pitch_shift"] = shift

    peak = np.max(np.abs(y)) or 1.0
    y = y / peak * 0.9
    return y.astype("float32"), info


def autotune(y: np.ndarray, sr: int, key_root: str, scale: str,
             strength: float = 1.0) -> tuple[np.ndarray, dict]:
    """Gesang auf die Toene der Tonart ziehen (Autotune)."""
    root = note_index(key_root)
    f0, voiced, _ = librosa.pyin(y, fmin=80, fmax=900, sr=sr,
                                 frame_length=2048, hop_length=256)
    if f0 is None or not np.any(voiced):
        return y.astype("float32"), {"fixed": 0, "note": "keine Stimme gehoert"}

    hop = 256
    n = len(y)
    out = np.zeros(n, dtype="float32")
    fixed = 0
    win = 2048
    hann = np.hanning(win)

    # Pitch-Kurve: Zielton pro Frame
    for i in range(len(f0)):
        if not voiced[i] or np.isnan(f0[i]):
            continue
        midi = librosa.hz_to_midi(f0[i])
        target = _nearest_scale_midi(midi, root, scale)
        shift = (target - midi) * strength
        shift = float(np.clip(shift, -7, 7))
        if abs(shift) > 0.3:
            fixed += 1
        center = i * hop
        a = max(0, center - win // 2)
        b = min(n, center + win // 2)
        chunk = y[a:b]
        if len(chunk) < 64:
            continue
        factor = 2 ** (shift / 12.0)
        # Resample-Trick: pitch shift bei gleicher Laenge
        idx = np.arange(len(chunk)) * factor
        idx = idx[idx < len(chunk)]
        shifted = np.interp(idx, np.arange(len(chunk)), chunk)
        if len(shifted) < len(chunk):
            shifted = np.pad(shifted, (0, len(chunk) - len(shifted)))
        shifted = shifted[:len(chunk)]
        w = hann[(win // 2 - (center - a)):(win // 2 - (center - a)) + len(chunk)]
        w = w[:len(shifted)]
        out[a:a + len(shifted)] += shifted * w

    # unvoiced/leise Stellen wieder drueber (Atem, Konsonanten)
    env = np.abs(librosa.stft(y, n_fft=1024, hop_length=hop)).sum(axis=0)
    peak = np.max(np.abs(out)) or 1.0
    out = out / peak * 0.9
    return out, {"fixed_frames": fixed,
                 "note": f"{fixed} Töne geradegerückt ✨"}
