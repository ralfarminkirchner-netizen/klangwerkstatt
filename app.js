/* Klangwerkstatt – die kindgerechte Musik-App
   Alles laeuft im Browser (Web Audio). Der Server hilft beim
   KI-Zauber (Samples in den Takt schneiden, Stimme richten, Song-Ideen). */
"use strict";

/* ============ ZUSTAND ============ */
const NOTEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];
const FARBEN = ["#ff5d5d", "#4d9fff", "#3ecf8e", "#ffc93c", "#a06cd5", "#ff9f43", "#ef5da8", "#00c2a8"];

const S = {
  bpm: 100, key: "C", scale: "dur",
  manifest: [],              // Sounds vom Server
  tracks: [],                // {id,name,emoji,color,buffer,synth,pattern[16]}
  slots: { A: null, B: null, C: null },  // {patterns:{trackId:[16]}, takte}
  song: [],                  // ["A","B","C"]
  aufnahmePads: [],          // eigene Sounds (dataURL)
};

let ctx = null, master, fxEcho, fxHall, fxRobot, robotGain;
let spielen = false, songModus = false;
let schritt = 0, naechsteZeit = 0, timer = null;
let songSchritt = 0, songGesamt = 0;
let mediaRec = null, aufnahmeBrocken = [], aufnahmeBuffer = null, gezaubertBuffer = null;

/* ============ AUDIO-GRUNDGERUEST ============ */
function audioStart() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = 0.9;

  // Roboter-Verzerrer (trocken/nass gemischt)
  fxRobot = ctx.createWaveShaper(); robotKurve(0);
  robotGain = ctx.createGain(); robotGain.gain.value = 0;
  const trocken = ctx.createGain(); trocken.gain.value = 1;

  const bus = ctx.createGain();
  bus.connect(trocken); trocken.connect(master);
  bus.connect(fxRobot); fxRobot.connect(robotGain); robotGain.connect(master);

  // Echo (punktierte Achtel zum Tempo)
  fxEcho = ctx.createGain();
  const delay = ctx.createDelay(2); delay.delayTime.value = 60 / S.bpm * 0.75;
  const fb = ctx.createGain(); fb.gain.value = 0.35;
  const fbFilter = ctx.createBiquadFilter(); fbFilter.type = "lowpass"; fbFilter.frequency.value = 2200;
  bus.connect(fxEcho); fxEcho.connect(delay); delay.connect(fb); fb.connect(fbFilter); fbFilter.connect(delay);
  delay.connect(master);

  // Halle (selbst gebauter Impuls)
  fxHall = ctx.createGain();
  const conv = ctx.createConvolver(); conv.buffer = hallImpuls(2.2, 3);
  bus.connect(fxHall); fxHall.connect(conv); conv.connect(master);

  master.connect(ctx.destination);
  window._bus = bus;
}
const bus = () => window._bus;

function hallImpuls(dauer, abfall) {
  const rate = ctx.sampleRate, len = rate * dauer;
  const imp = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = imp.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, abfall);
  }
  return imp;
}
function robotKurve(menge) {
  const n = 1024, k = new Float32Array(n), drive = 1 + menge * 30;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    k[i] = Math.tanh(x * drive);
  }
  fxRobot.curve = k;
}

/* ============ SYNTH-SOUNDS (funktionieren ohne Server!) ============ */
const SYNTH_KIT = [
  { id: "kick",  name: "Bumm",    emoji: "🥁", kategorie: "drums", synth: "kick" },
  { id: "snare", name: "Klatsch", emoji: "👏", kategorie: "drums", synth: "snare" },
  { id: "hat",   name: "Tss",     emoji: "✨", kategorie: "drums", synth: "hat" },
  { id: "pluck", name: "Pling",   emoji: "🎹", kategorie: "melodie", synth: "pluck" },
];
function synthSpielen(art, wann) {
  if (art === "kick") {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, wann);
    o.frequency.exponentialRampToValueAtTime(45, wann + 0.12);
    g.gain.setValueAtTime(1, wann); g.gain.exponentialRampToValueAtTime(0.001, wann + 0.3);
    o.connect(g); g.connect(bus()); o.start(wann); o.stop(wann + 0.32);
  } else if (art === "snare") {
    const n = rauschen(0.2), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "highpass"; f.frequency.value = 1500;
    g.gain.setValueAtTime(0.7, wann); g.gain.exponentialRampToValueAtTime(0.001, wann + 0.18);
    n.connect(f); f.connect(g); g.connect(bus()); n.start(wann);
  } else if (art === "hat") {
    const n = rauschen(0.06), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "highpass"; f.frequency.value = 6000;
    g.gain.setValueAtTime(0.4, wann); g.gain.exponentialRampToValueAtTime(0.001, wann + 0.05);
    n.connect(f); f.connect(g); g.connect(bus()); n.start(wann);
  } else if (art === "pluck") {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const ton = NOTEN.indexOf(S.key);
    const toene = S.scale === "dur" ? [0, 4, 7, 12] : [0, 3, 7, 12];
    const t = toene[Math.floor(Math.random() * toene.length)];
    o.type = "triangle";
    o.frequency.value = 261.6 * Math.pow(2, (ton + t) / 12);
    g.gain.setValueAtTime(0.5, wann); g.gain.exponentialRampToValueAtTime(0.001, wann + 0.4);
    o.connect(g); g.connect(bus()); o.start(wann); o.stop(wann + 0.42);
  }
}
function rauschen(dauer) {
  const b = ctx.createBuffer(1, ctx.sampleRate * dauer, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const q = ctx.createBufferSource(); q.buffer = b; return q;
}

/* ============ SAMPLES LADEN ============ */
async function ladeManifest() {
  for (const url of ["api/samples", "assets/samples/samples.json"]) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const j = await r.json();
      S.manifest = j.samples || (Array.isArray(j) ? j : []);
      if (S.manifest.length) break;
    } catch (e) { /* naechster Versuch */ }
  }
  // Synth-Kit immer dabei (funktioniert auch offline)
  const ids = new Set(S.manifest.map(s => s.id));
  SYNTH_KIT.forEach(k => { if (!ids.has(k.id)) S.manifest.push({ ...k }); });
  S.manifest.forEach((s, i) => { s.color = s.color || FARBEN[i % FARBEN.length]; });
}
async function ladeBuffer(sample) {
  if (sample.buffer || sample.synth) return;
  try {
    const r = await fetch(sample.url);
    const ab = await r.arrayBuffer();
    sample.buffer = await ctx.decodeAudioData(ab);
  } catch (e) { console.warn("Sample fehlt:", sample.id, e); }
}
function findeSample(id) { return S.manifest.find(s => s.id === id); }

function spieleSample(sample, wann) {
  if (sample.synth) { synthSpielen(sample.synth, wann); return; }
  if (!sample.buffer) return;
  const q = ctx.createBufferSource(); q.buffer = sample.buffer;
  q.connect(bus()); q.start(wann);
}

/* ============ SEQUENCER ============ */
const schrittDauer = () => 60 / S.bpm / 4;
function planer() {
  while (naechsteZeit < ctx.currentTime + 0.12) {
    if (songModus) songSchrittSpielen();
    else {
      const s = schritt % 16;
      S.tracks.forEach(t => { if (t.pattern[s]) spieleTrack(t, naechsteZeit); });
      malePlayhead(s);
      schritt++;
    }
    naechsteZeit += schrittDauer();
  }
}
function spieleTrack(t, wann) {
  const smp = t.sample || findeSample(t.id);
  if (smp) spieleSample(smp, wann);
  else if (t.buffer) { const q = ctx.createBufferSource(); q.buffer = t.buffer; q.connect(bus()); q.start(wann); }
}
function start(was) {
  audioStart();
  songModus = (was === "song");
  if (songModus) { songSchritt = 0; songGesamt = S.song.reduce((n, c) => n + ((S.slots[c]?.takte || 1) * 16), 0); if (!songGesamt) return; }
  spielen = true; schritt = 0; naechsteZeit = ctx.currentTime + 0.08;
  timer = setInterval(planer, 30);
  document.getElementById("btn-play").textContent = "⏸️";
}
function stopp() {
  spielen = false; clearInterval(timer); malePlayhead(-1);
  document.getElementById("btn-play").textContent = "▶️";
}
function songSchrittSpielen() {
  if (songSchritt >= songGesamt) { stopp(); return; }
  let pos = songSchritt;
  for (const chip of S.song) {
    const slot = S.slots[chip]; if (!slot) continue;
    const len = (slot.takte || 1) * 16;
    if (pos < len) {
      const s = pos % 16;
      S.tracks.forEach(t => { if ((slot.patterns[t.id] || [])[s]) spieleTrack(t, naechsteZeit); });
      malePlayhead(s);
      break;
    }
    pos -= len;
  }
  songSchritt++;
}

/* ============ UI: BEAT ============ */
function spurHinzufuegen(sampleId, pattern) {
  const smp = findeSample(sampleId); if (!smp) return;
  if (S.tracks.some(t => t.id === sampleId)) return;
  ladeBuffer(smp);
  S.tracks.push({ id: smp.id, name: smp.name, emoji: smp.emoji, color: smp.color,
                  sample: smp, pattern: pattern || new Array(16).fill(0) });
  maleSpuren(); speichern();
}
function maleSpuren() {
  const box = document.getElementById("spuren"); box.innerHTML = "";
  S.tracks.forEach((t, ti) => {
    const zeile = document.createElement("div"); zeile.className = "spur";
    const kopf = document.createElement("button"); kopf.className = "kopf";
    kopf.style.background = t.color; kopf.textContent = t.emoji;
    kopf.title = t.name;
    kopf.onclick = () => { audioStart(); spieleTrack(t, ctx.currentTime); };
    kopf.oncontextmenu = (e) => { e.preventDefault(); S.tracks.splice(ti, 1); maleSpuren(); speichern(); };
    const zellen = document.createElement("div"); zellen.className = "zellen";
    t.pattern.forEach((v, s) => {
      const z = document.createElement("button");
      z.className = "zelle" + (s % 4 === 0 && s > 0 ? " gruppe" : "") + (v ? " an" : "");
      z.style.background = v ? t.color : "";
      z.dataset.spur = ti; z.dataset.schritt = s;
      z.onclick = () => { t.pattern[s] = v ? 0 : 1; maleSpuren(); speichern(); };
      zellen.appendChild(z);
    });
    zeile.appendChild(kopf); zeile.appendChild(zellen); box.appendChild(zeile);
  });
}
function malePlayhead(s) {
  document.querySelectorAll(".zelle.playhead").forEach(z => z.classList.remove("playhead"));
  if (s < 0) return;
  document.querySelectorAll(`.zelle[data-schritt="${s}"]`).forEach(z => z.classList.add("playhead"));
}

/* ============ UI: PADS ============ */
function malePads() {
  const box = document.getElementById("pads"); box.innerHTML = "";
  S.manifest.forEach(smp => {
    const p = document.createElement("button");
    p.className = "pad"; p.style.background = smp.color;
    p.innerHTML = `${smp.emoji}<small>${smp.name}</small>`;
    p.onclick = async () => { audioStart(); await ladeBuffer(smp); spieleSample(smp, ctx.currentTime); };
    box.appendChild(p);
  });
  S.aufnahmePads.forEach((a, i) => {
    const p = document.createElement("button");
    p.className = "pad"; p.style.background = "#ef5da8";
    p.innerHTML = `🎙️<small>Mein Sound ${i + 1}</small>`;
    p.onclick = () => { audioStart(); const q = ctx.createBufferSource(); q.buffer = a.buffer; q.connect(bus()); q.start(); };
    box.appendChild(p);
  });
  const rec = document.createElement("button");
  rec.className = "pad"; rec.id = "pad-rec"; rec.style.background = "#3a2e4f";
  rec.innerHTML = `🎤⏺<small>Aufnehmen</small>`;
  rec.onclick = () => padAufnehmen(rec);
  box.appendChild(rec);
}

/* ============ AUFNAHME ============ */
async function mikroStarten(onData) {
  const strom = await navigator.mediaDevices.getUserMedia({ audio: true });
  aufnahmeBrocken = [];
  const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find(m => MediaRecorder.isTypeSupported(m)) || "";
  mediaRec = new MediaRecorder(strom, mime ? { mimeType: mime } : undefined);
  mediaRec.ondataavailable = e => aufnahmeBrocken.push(e.data);
  mediaRec.onstop = async () => {
    strom.getTracks().forEach(t => t.stop());
    const blob = new Blob(aufnahmeBrocken, { type: mediaRec.mimeType });
    const ab = await blob.arrayBuffer();
    try { aufnahmeBuffer = await ctx.decodeAudioData(ab); } catch (e) { aufnahmeBuffer = null; }
    onData(aufnahmeBuffer);
  };
  mediaRec.start();
}
async function padAufnehmen(knopf) {
  audioStart();
  if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
  knopf.classList.add("aufnahme"); knopf.innerHTML = "⏹<small>Stop</small>";
  await mikroStarten(async buf => {
    knopf.classList.remove("aufnahme"); knopf.innerHTML = "🎤⏺<small>Aufnehmen</small>";
    if (!buf) return;
    if (document.getElementById("auto-zauber").checked) {
      knopf.innerHTML = "✨<small>Zauber…</small>";
      const gezaubert = await zauberFit(buf);
      buf = gezaubert || buf;
    }
    S.aufnahmePads.push({ buffer: buf, dataUrl: bufferZuDataUrl(buf) });
    malePads(); speichern();
  });
  setTimeout(() => { if (mediaRec && mediaRec.state === "recording") mediaRec.stop(); }, 10000);
}

/* ============ KI-ZAUBER (Server) ============ */
async function zauberFit(buffer) {
  try {
    const fd = new FormData();
    fd.append("file", new Blob([bufferZuWav(buffer)], { type: "audio/wav" }), "sound.wav");
    fd.append("bpm", S.bpm); fd.append("key", S.key); fd.append("scale", S.scale);
    const r = await fetch("api/audio/fit", { method: "POST", body: fd });
    const j = await r.json();
    if (j.ok) return await wavVonHex(j.wav_hex);
  } catch (e) { console.warn("Zauber nicht erreichbar", e); }
  return null;
}
async function zauberTune(buffer, staerke) {
  const fd = new FormData();
  fd.append("file", new Blob([bufferZuWav(buffer)], { type: "audio/wav" }), "stimme.wav");
  fd.append("key", S.key); fd.append("scale", S.scale); fd.append("strength", staerke);
  const r = await fetch("api/audio/tune", { method: "POST", body: fd });
  const j = await r.json();
  if (!j.ok) throw new Error(j.fehler || "Zauber fehlgeschlagen");
  return j;
}

/* ============ WAV-HILFEN ============ */
function bufferZuWav(buffer) {
  const n = buffer.length, sr = buffer.sampleRate;
  const d = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const cd = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] += cd[i] / buffer.numberOfChannels;
  }
  const out = new ArrayBuffer(44 + n * 2), v = new DataView(out);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); wstr(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
  v.setUint16(34, 16, true); wstr(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, d[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  return out;
}
async function wavVonHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return await ctx.decodeAudioData(bytes.buffer);
}
function bufferZuDataUrl(buffer) {
  const wav = bufferZuWav(buffer);
  let bin = ""; const b = new Uint8Array(wav);
  for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
  return "data:audio/wav;base64," + btoa(bin);
}
async function dataUrlZuBuffer(url) {
  const ab = await (await fetch(url)).arrayBuffer();
  return await ctx.decodeAudioData(ab);
}

/* ============ SINGEN ============ */
function singenEinrichten() {
  const knopf = document.getElementById("mikro-knopf");
  const status = document.getElementById("sing-status");
  knopf.onclick = async () => {
    audioStart();
    if (mediaRec && mediaRec.state === "recording") { mediaRec.stop(); return; }
    if (document.getElementById("metronom").checked) {
      for (let i = 4; i > 0; i--) {
        status.textContent = i; synthSpielen("hat", ctx.currentTime);
        await new Promise(r => setTimeout(r, 60000 / S.bpm));
      }
    }
    status.textContent = "🔴";
    await mikroStarten(buf => {
      status.textContent = buf ? "✅" : "😕";
      if (buf) {
        document.getElementById("sing-ergebnis").classList.remove("versteckt");
        gezaubertBuffer = null;
        document.getElementById("btn-speichern-pad").classList.add("versteckt");
      }
    });
    setTimeout(() => { if (mediaRec && mediaRec.state === "recording") mediaRec.stop(); }, 15000);
  };
  document.getElementById("btn-hoeren").onclick = () => {
    if (!aufnahmeBuffer) return;
    const q = ctx.createBufferSource(); q.buffer = gezaubertBuffer || aufnahmeBuffer;
    q.connect(bus()); q.start();
  };
  document.getElementById("btn-zaubern").onclick = async () => {
    if (!aufnahmeBuffer) return;
    const info = document.getElementById("tune-info");
    info.classList.remove("versteckt"); info.textContent = "✨ Klangi richtet die Töne…";
    try {
      const j = await zauberTune(aufnahmeBuffer, document.getElementById("tune-staerke").value / 100);
      gezaubertBuffer = await wavVonHex(j.wav_hex);
      info.textContent = `🤖 ${j.info.note || "Fertig!"} Hör es dir an!`;
      document.getElementById("btn-speichern-pad").classList.remove("versteckt");
    } catch (e) {
      info.textContent = "😴 Der Zauber schläft gerade (Server nicht da). Dein Original klingt auch toll!";
    }
  };
  document.getElementById("btn-speichern-pad").onclick = () => {
    if (!gezaubertBuffer) return;
    S.aufnahmePads.push({ buffer: gezaubertBuffer, dataUrl: bufferZuDataUrl(gezaubertBuffer) });
    malePads(); speichern();
    document.getElementById("tune-info").textContent = "💾 Gespeichert! Schau bei den 🎹 Pads nach.";
  };
}

/* ============ SONG-BAU + KI ============ */
function maleBausteine() {
  const box = document.getElementById("bausteine"); box.innerHTML = "";
  ["A", "B", "C"].forEach((k, i) => {
    const b = document.createElement("button");
    b.className = "baustein" + (S.slots[k] ? "" : " leer");
    b.style.background = [ "#ff5d5d", "#4d9fff", "#3ecf8e" ][i];
    b.innerHTML = `${["🟥","🟦","🟩"][i]}<small>Baustein ${k}${S.slots[k] ? "" : " (leer)"}</small>`;
    b.onclick = () => { if (S.slots[k]) { S.song.push(k); maleSongspur(); speichern(); } };
    box.appendChild(b);
  });
}
function maleSongspur() {
  const box = document.getElementById("songspur"); box.innerHTML = "";
  const farben = { A: "#ff5d5d", B: "#4d9fff", C: "#3ecf8e" };
  S.song.forEach((k, i) => {
    const c = document.createElement("button");
    c.className = "chip"; c.style.background = farben[k]; c.textContent = k;
    c.onclick = () => { S.song.splice(i, 1); maleSongspur(); speichern(); };
    box.appendChild(c);
  });
}
async function kiSong() {
  const blase = document.getElementById("ki-antwort");
  blase.classList.remove("versteckt");
  blase.textContent = "🤖 Klangi überlegt…";
  try {
    const r = await fetch("api/ki/song", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bpm: S.bpm, key: S.key, scale: S.scale,
                             wunsch: document.getElementById("ki-wunsch").value }),
    });
    const j = await r.json();
    if (!j.muster) throw new Error("kein Muster");
    // Muster in Spuren verwandeln
    for (const [id, pattern] of Object.entries(j.muster)) {
      if (!S.tracks.some(t => t.id === id)) spurHinzufuegen(id);
      const t = S.tracks.find(t => t.id === id);
      if (t && Array.isArray(pattern) && pattern.length === 16) t.pattern = pattern.map(Number);
    }
    // Bausteine
    ["A", "B", "C"].forEach((k, i) => {
      const bs = (j.bausteine || [])[i];
      if (!bs) { S.slots[k] = null; return; }
      const patterns = {};
      S.tracks.forEach(t => {
        patterns[t.id] = (bs.spuren || []).includes(t.id) ? t.pattern.slice() : new Array(16).fill(0);
      });
      S.slots[k] = { patterns, takte: Math.max(1, Math.min(8, bs.takte || 2)) };
    });
    S.song = ["A", "B", "C"].filter(k => S.slots[k]);
    maleSpuren(); maleBausteine(); maleSongspur(); speichern();
    blase.innerHTML = `🤖 <b>${j.gruss || "Dein Song ist fertig!"}</b><br>💡 ${j.tipp || ""}` +
      (j.quelle && j.quelle !== "kimi" ? `<br><span class="hinweis">(ohne Internet gebastelt – trotzdem cool!)</span>` : "");
  } catch (e) {
    blase.textContent = "😴 Klangi ist gerade offline. Bau doch selbst einen Beat – oder versuch's später nochmal!";
  }
}

/* ============ SPEICHERN ============ */
function speichern() {
  try {
    localStorage.setItem("klangwerkstatt", JSON.stringify({
      bpm: S.bpm, key: S.key, scale: S.scale,
      tracks: S.tracks.map(t => ({ id: t.id, pattern: t.pattern })),
      slots: S.slots, song: S.song,
      pads: S.aufnahmePads.map(p => p.dataUrl),
      fx: [fx("fx-echo"), fx("fx-hall"), fx("fx-robot")],
    }));
  } catch (e) { /* voll ist voll */ }
}
async function laden() {
  let j = null;
  try { j = JSON.parse(localStorage.getItem("klangwerkstatt")); } catch (e) {}
  if (!j) { spurHinzufuegen("kick", [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]);
            spurHinzufuegen("snare", [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]);
            spurHinzufuegen("hat",   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]); return; }
  S.bpm = j.bpm || 100; S.key = j.key || "C"; S.scale = j.scale || "dur";
  (j.tracks || []).forEach(t => spurHinzufuegen(t.id, t.pattern));
  S.slots = j.slots || { A: null, B: null, C: null };
  S.song = j.song || [];
  if (j.fx) { ["fx-echo","fx-hall","fx-robot"].forEach((id, i) => document.getElementById(id).value = j.fx[i] ?? 0); }
  for (const url of (j.pads || [])) {
    try { S.aufnahmePads.push({ buffer: await dataUrlZuBuffer(url), dataUrl: url }); } catch (e) {}
  }
}
const fx = id => +document.getElementById(id).value;

/* ============ START ============ */
window.addEventListener("DOMContentLoaded", async () => {
  // Tonart-Auswahl fuellen
  const sel = document.getElementById("tonart");
  NOTEN.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });

  await ladeManifest();
  await laden();

  // Auswahlen setzen
  document.getElementById("bpm").value = S.bpm;
  document.getElementById("bpm-anzeige").textContent = S.bpm;
  sel.value = S.key; document.getElementById("tonart-art").value = S.scale;

  // Sound-Auswahl fuellen
  const wahl = document.getElementById("sound-wahl");
  S.manifest.forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.emoji} ${s.name}`; wahl.appendChild(o); });

  maleSpuren(); malePads(); maleBausteine(); maleSongspur();
  singenEinrichten();

  // Events
  document.getElementById("btn-play").onclick = () => spielen ? stopp() : start("beat");
  document.getElementById("btn-stop").onclick = stopp;
  document.getElementById("bpm").oninput = e => { S.bpm = +e.target.value; document.getElementById("bpm-anzeige").textContent = S.bpm; speichern(); };
  sel.onchange = e => { S.key = e.target.value; speichern(); };
  document.getElementById("tonart-art").onchange = e => { S.scale = e.target.value; speichern(); };
  document.getElementById("btn-clear").onclick = () => { S.tracks.forEach(t => t.pattern.fill(0)); maleSpuren(); speichern(); };
  document.getElementById("btn-add-spur").onclick = () => spurHinzufuegen(wahl.value);
  document.getElementById("btn-slot-save").onclick = () => {
    const k = document.getElementById("slot-wahl").value;
    const patterns = {}; S.tracks.forEach(t => patterns[t.id] = t.pattern.slice());
    S.slots[k] = { patterns, takte: 2 }; maleBausteine(); speichern();
  };
  document.getElementById("btn-song-play").onclick = () => spielen ? stopp() : start("song");
  document.getElementById("btn-song-clear").onclick = () => { S.song = []; maleSongspur(); speichern(); };
  document.getElementById("btn-ki").onclick = kiSong;
  ["fx-echo", "fx-hall", "fx-robot"].forEach(id => {
    document.getElementById(id).oninput = () => {
      if (!ctx) return;
      fxEcho.gain.value = fx("fx-echo") / 100 * 0.8;
      fxHall.gain.value = fx("fx-hall") / 100 * 0.9;
      robotGain.gain.value = fx("fx-robot") / 100;
      robotKurve(fx("fx-robot") / 100);
      speichern();
    };
  });

  // Tabs
  document.querySelectorAll("#tabs button").forEach(b => {
    b.onclick = () => {
      document.querySelectorAll("#tabs button").forEach(x => x.classList.remove("aktiv"));
      document.querySelectorAll(".screen").forEach(x => x.classList.remove("aktiv"));
      b.classList.add("aktiv");
      document.getElementById("screen-" + b.dataset.screen).classList.add("aktiv");
    };
  });

  // Audio bei erster Beruehrung starten
  document.body.addEventListener("pointerdown", audioStart, { once: true });
});
