/* ═══════════════════════════════════════════
   KLANGWERKSTATT v2 — Tone.js Audio Engine
   ═══════════════════════════════════════════
   Ersetzt die alte Web-Audio-Frickel-Engine durch Tone.js:
   - Tone.Sampler für Multi-Velocity-Sample-Playback
   - Tone.MembraneSynth + NoiseSynth + MetalSynth für Drums
   - Tone.PolySynth für melodische Voices
   - Tone.Pattern für den Step-Sequencer
   - Tone.PingPongDelay, Reverb, Distortion als Effekte
   - Library-API-Integration (localhost:8778)
*/
"use strict";

// ════════════════ STATE ════════════════
const K = {
  bpm: 100,
  pads: [],          // { id, name, emoji, type, color, player, url? }
  patterns: {},      // { padId: [0|1 x 16] }
  playing: false,
  currentStep: 0,
  library: [],       // vom Server geladen
  libPage: 0,
  libFilter: { type: "", search: "" },
};

// ════════════════ AUDIO ENGINE ════════════════
let master, delay, reverb, drive, sampler, drumSynths;
let seqLoop = null;

function initAudio() {
  if (master) return Tone.start();

  // Master chain
  master = new Tone.Channel(0.8).toDestination();
  drive = new Tone.Distortion(0).connect(master);
  reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 }).connect(drive);
  delay = new Tone.PingPongDelay({ delayTime: "8n", feedback: 0.2, wet: 0 }).connect(reverb);
  
  // FX routing: everything → delay → reverb → drive → master
  // Sampler goes to delay
  sampler = new Tone.Sampler({
    urls: {}, // loaded dynamically
    baseUrl: "",
    onload: () => console.log("Sampler ready"),
  }).connect(delay);

  // Drum synths as fallback
  drumSynths = {
    kick: new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(delay),
    snare: new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).connect(delay),
    hat: new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.05, sustain: 0 } }).connect(delay),
  };

  // Transport
  Tone.Transport.bpm.value = K.bpm;
}

// ════════════════ PAD SYSTEM ════════════════
const PAD_COLORS = ["#ff5d5d","#4d9fff","#3ecf8e","#ffc93c","#a06cd5","#ff9f43","#ef5da8","#00c2a8"];
const TYPE_COLORS = { kick: "#ff5d5d", snare: "#4d9fff", hat: "#3ecf8e", perc: "#ffc93c", melodic: "#a06cd5", loop: "#ff9f43", fx: "#00c2a8" };

function addPad(sample) {
  if (K.pads.find(p => p.id === sample.id)) return;
  const pad = {
    id: sample.id,
    name: sample.name || sample.id,
    emoji: sample.emoji || "🎵",
    type: sample.type || "perc",
    color: TYPE_COLORS[sample.type] || PAD_COLORS[K.pads.length % PAD_COLORS.length],
    url: sample.path || sample.url || "",
    player: null,
  };

  // Load into sampler if we have a URL
  if (pad.url && pad.url.startsWith("http")) {
    sampler.add(pad.id, pad.url);
  }

  K.pads.push(pad);
  K.patterns[pad.id] = new Array(16).fill(0);
  renderPads();
  renderSequencer();
}

function removePad(padId) {
  const idx = K.pads.findIndex(p => p.id === padId);
  if (idx < 0) return;
  K.pads.splice(idx, 1);
  delete K.patterns[padId];
  renderPads();
  renderSequencer();
}

function triggerPad(padId) {
  initAudio();
  const pad = K.pads.find(p => p.id === padId);
  if (!pad) return;

  const now = Tone.now();
  try {
    if (pad.type === "kick") {
      drumSynths.kick.triggerAttackRelease("C2", "8n", now);
    } else if (pad.type === "snare") {
      drumSynths.snare.triggerAttackRelease("8n", now);
    } else if (pad.type === "hat") {
      drumSynths.hat.triggerAttackRelease("16n", now);
    } else {
      sampler.triggerAttackRelease(pad.id, "8n", now);
    }
  } catch (e) {
    // Fallback: kick synth
    drumSynths.kick.triggerAttackRelease("C2", "8n", now);
  }

  // Visual feedback
  const el = document.querySelector(`.pad[data-pad-id="${padId}"]`);
  if (el) { el.classList.add("playing"); setTimeout(() => el.classList.remove("playing"), 120); }
}

// ════════════════ SEQUENCER ════════════════
function toggleStep(padId, step) {
  K.patterns[padId][step] = K.patterns[padId][step] ? 0 : 1;
  renderSequencer();
}

function sequenceStep(time, step) {
  K.currentStep = step;
  for (const [padId, pattern] of Object.entries(K.patterns)) {
    if (pattern[step]) {
      const pad = K.pads.find(p => p.id === padId);
      if (!pad) continue;
      try {
        if (pad.type === "kick") {
          drumSynths.kick.triggerAttackRelease("C2", "8n", time);
        } else if (pad.type === "snare") {
          drumSynths.snare.triggerAttackRelease("8n", time);
        } else if (pad.type === "hat") {
          drumSynths.hat.triggerAttackRelease("16n", time);
        } else if (pad.type === "loop") {
          sampler.triggerAttack(pad.id, time);
        } else {
          sampler.triggerAttackRelease(pad.id, "8n", time);
        }
      } catch (e) { /* silent fail */ }
    }
  }
  // Update visual
  requestAnimationFrame(() => {
    document.querySelectorAll(".seq-step.current").forEach(el => el.classList.remove("current"));
    document.querySelectorAll(`.seq-step[data-step="${step}"]`).forEach(el => el.classList.add("current"));
  });
}

function startStop() {
  initAudio();
  if (K.playing) {
    Tone.Transport.stop();
    if (seqLoop) seqLoop.dispose();
    K.playing = false;
    K.currentStep = -1;
    document.getElementById("btn-play").textContent = "▶ Play";
    document.getElementById("btn-play").classList.remove("stop");
    renderSequencer();
  } else {
    seqLoop = new Tone.Sequence((time, step) => {
      sequenceStep(time, step);
    }, [...Array(16).keys()], "16n").start(0);
    Tone.Transport.start();
    K.playing = true;
    document.getElementById("btn-play").textContent = "⏸ Stop";
    document.getElementById("btn-play").classList.add("stop");
  }
}

// ════════════════ LIBRARY (Bridge API) ════════════════
const LIB_API = "http://127.0.0.1:8778/api";

async function loadLibrary(type = "", search = "", limit = 100) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(K.libPage * limit) });
  if (type) params.set("type", type);
  if (search) params.set("search", search);
  try {
    const r = await fetch(`${LIB_API}/samples?${params}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.samples || [];
  } catch (e) {
    return []; // offline → empty, pads still work
  }
}

async function searchLibrary() {
  const type = K.libFilter.type;
  const search = document.getElementById("lib-search").value.trim();
  K.libFilter.search = search;
  K.libPage = 0;
  K.library = await loadLibrary(type, search);
  renderLibrary();
}

async function initLibrary() {
  // Load initial set (kicks + snares + hats)
  const types = ["kick", "snare", "hat", "loop", "melodic"];
  K.library = [];
  for (const t of types) {
    const samples = await loadLibrary(t, "", 12);
    K.library.push(...samples);
  }
  // Remove duplicates by id
  const seen = new Set();
  K.library = K.library.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
  K.library = K.library.slice(0, 60);
  renderLibrary();
}

// ════════════════ RENDERING ════════════════
function renderPads() {
  const grid = document.getElementById("pad-grid");
  grid.innerHTML = K.pads.map((p, i) => `
    <div class="pad" data-pad-id="${p.id}" style="border-color: ${p.color}33; background: ${p.color}11;"
         onclick="triggerPad('${p.id}')" oncontextmenu="event.preventDefault(); removePad('${p.id}')">
      <span class="emoji">${p.emoji}</span>
      <span class="name">${p.name.slice(0, 12)}</span>
    </div>
  `).join("");
}

function renderSequencer() {
  const rows = document.getElementById("seq-rows");
  rows.innerHTML = K.pads.map(p => {
    const steps = K.patterns[p.id] || new Array(16).fill(0);
    return `
      <div class="seq-row">
        <div class="seq-label" style="color:${p.color}">${p.emoji} ${p.name.slice(0, 6)}</div>
        <div class="seq-steps">
          ${steps.map((v, s) => `
            <div class="seq-step ${v ? 'on' : ''} ${K.currentStep === s ? 'current' : ''}"
                 data-pad="${p.id}" data-step="${s}"
                 onclick="toggleStep('${p.id}', ${s})"></div>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function renderLibrary() {
  const list = document.getElementById("lib-list");
  if (!K.library.length) {
    list.innerHTML = '<div style="color:var(--dim);padding:16px;text-align:center">Keine Samples gefunden.<br>Library-Server auf :8778?</div>';
    return;
  }
  list.innerHTML = K.library.map(s => `
    <div class="lib-item" ondblclick="addPad(${JSON.stringify(s).replace(/"/g, '&quot;')})"
         onclick="previewSample('${s.id}')" title="${s.name}\nPack: ${s.pack}\nBPM: ${s.bpm || '-'}\nType: ${s.type}">
      <span class="li-emoji">${s.type === 'kick' ? '🥁' : s.type === 'snare' ? '👏' : s.type === 'hat' ? '✨' : s.type === 'loop' ? '🔄' : s.type === 'melodic' ? '🎹' : '🪘'}</span>
      <span class="li-name">${s.name.slice(0, 30)}</span>
      <span class="li-type">${s.type}</span>
      <span class="li-pack">${(s.pack||'').slice(0, 15)}</span>
    </div>
  `).join("");
}

function previewSample(sampleId) {
  initAudio();
  const sample = K.library.find(s => s.id === sampleId);
  if (!sample) return;
  // Try to play via sampler if loaded, or via URL
  try {
    sampler.triggerAttackRelease(sampleId, "4n", Tone.now());
  } catch (e) {
    // Load and play
    if (sample.path && sample.path.startsWith("http")) {
      const player = new Tone.Player(sample.path, () => {
        player.connect(delay).start();
      }).sync();
    }
  }
}

// ════════════════ FX CONTROLS ════════════════
function setupFX() {
  document.getElementById("fx-delay").oninput = (e) => {
    if (!delay) return;
    delay.wet.value = e.target.value / 100 * 0.5;
  };
  document.getElementById("fx-reverb").oninput = (e) => {
    if (!reverb) return;
    reverb.wet.value = e.target.value / 100 * 0.6;
  };
  document.getElementById("fx-drive").oninput = (e) => {
    if (!drive) return;
    drive.distortion = e.target.value / 100;
    drive.wet.value = e.target.value > 0 ? 1 : 0;
  };
  document.getElementById("fx-vol").oninput = (e) => {
    if (!master) return;
    master.volume.value = Tone.gainToDb(e.target.value / 100);
  };
}

// ════════════════ INIT ════════════════
window.addEventListener("DOMContentLoaded", async () => {
  // BPM
  document.getElementById("bpm-slider").oninput = (e) => {
    K.bpm = +e.target.value;
    document.getElementById("bpm-display").textContent = K.bpm;
    if (Tone.Transport) Tone.Transport.bpm.value = K.bpm;
  };

  // Transport
  document.getElementById("btn-play").onclick = startStop;
  document.getElementById("btn-stop").onclick = () => {
    if (K.playing) startStop();
    K.currentStep = -1;
    renderSequencer();
  };

  // Library filters
  document.querySelectorAll("#lib-filters .chip").forEach(chip => {
    chip.onclick = () => {
      document.querySelectorAll("#lib-filters .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      K.libFilter.type = chip.dataset.type;
      searchLibrary();
    };
  });

  // Search
  document.getElementById("lib-search").oninput = debounce(searchLibrary, 300);

  // FX
  setupFX();

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); startStop(); }
    if (e.code === "KeyR" && !e.metaKey) { initAudio(); triggerPad(K.pads[Math.floor(Math.random() * K.pads.length)]?.id); }
  });

  // Init
  initAudio();
  await initLibrary();

  // Default pads (kick, snare, hat, pluck)
  const defaults = K.library.filter(s => ["kick", "snare", "hat"].includes(s.type)).slice(0, 3);
  defaults.forEach(s => addPad(s));

  console.log(`🎵 Klangwerkstatt v2 ready — ${K.library.length} samples in library, ${K.pads.length} pads loaded`);
});

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
