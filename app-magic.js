/* Klangwerkstatt – die kindgerechte Musik-App mit Magischem Song-Macher */
"use strict";

const NOTEN = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","H"];
const FARBEN = ["#ff5d5d","#4d9fff","#3ecf8e","#ffc93c","#a06cd5","#ff9f43","#ef5da8","#00c2a8"];
const STYLES = [
  {id:"happy",emoji:"😄",name:"Fröhlich",tags:"fröhlich,pop,tanzbar",bpm:120,key:"C",scale:"dur"},
  {id:"rock",emoji:"🎸",name:"Rockig",tags:"rock,gitarre,energie",bpm:140,key:"E",scale:"dur"},
  {id:"calm",emoji:"🌙",name:"Ruhig",tags:"ruhig,sanft,klavier",bpm:75,key:"F",scale:"dur"},
  {id:"mystic",emoji:"🔮",name:"Magisch",tags:"magisch,geheimnisvoll,sphärisch",bpm:90,key:"D",scale:"moll"},
  {id:"party",emoji:"🎉",name:"Party",tags:"party,elektronisch,tanz",bpm:128,key:"C",scale:"dur"},
  {id:"hero",emoji:"🦸",name:"Held",tags:"episch,orchestral,heldenhaft",bpm:100,key:"G",scale:"dur"},
  {id:"funny",emoji:"🤪",name:"Verrückt",tags:"lustig,schräg,verspielt",bpm:110,key:"A",scale:"dur"},
  {id:"dream",emoji:"💭",name:"Traum",tags:"verträumt,schwebend,ambient",bpm:60,key:"Bb",scale:"dur"},
];

let S = {bpm:100,key:"C",scale:"dur",manifest:[],tracks:[],slots:{A:null,B:null,C:null},song:[],aufnahmePads:[],magicSongs:[]};
let ctx,master,fxEcho,fxHall,fxRobot,robotGain,spielen=false,songModus=false,schritt=0,naechsteZeit=0,timer=null,songSchritt=0,songGesamt=0;
let mediaRec,aufnahmeBrocken=[],aufnahmeBuffer=null,gezaubertBuffer=null,pickedStyles=[];

/* ========== AUDIO ========== */
function audioStart(){if(ctx){if(ctx.state==="suspended")ctx.resume();return;}ctx=new(window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=0.9;fxRobot=ctx.createWaveShaper();robotKurve(0);robotGain=ctx.createGain();robotGain.gain.value=0;let trocken=ctx.createGain();trocken.gain.value=1;let bus=ctx.createGain();bus.connect(trocken);trocken.connect(master);bus.connect(fxRobot);fxRobot.connect(robotGain);robotGain.connect(master);fxEcho=ctx.createGain();let delay=ctx.createDelay(2);delay.delayTime.value=60/S.bpm*0.75;let fb=ctx.createGain();fb.gain.value=0.35;let fbFilter=ctx.createBiquadFilter();fbFilter.type="lowpass";fbFilter.frequency.value=2200;bus.connect(fxEcho);fxEcho.connect(delay);delay.connect(fb);fb.connect(fbFilter);fbFilter.connect(delay);delay.connect(master);fxHall=ctx.createGain();let conv=ctx.createConvolver();conv.buffer=hallImpuls(2.2,3);bus.connect(fxHall);fxHall.connect(conv);conv.connect(master);master.connect(ctx.destination);window._bus=bus;}
let bus=()=>window._bus;
function hallImpuls(d,a){let rate=ctx.sampleRate,len=rate*d,imp=ctx.createBuffer(2,len,rate);for(let c=0;c<2;c++){let ch=imp.getChannelData(c);for(let i=0;i<len;i++)ch[i]=(Math.random()*2-1)*Math.pow(1-i/len,a);}return imp;}
function robotKurve(m){let n=1024,k=new Float32Array(n),drive=1+m*30;for(let i=0;i<n;i++){let x=(i/n)*2-1;k[i]=Math.tanh(x*drive);}fxRobot.curve=k;}

/* ========== SYNTH ========== */
const SYNTH_KIT=[{id:"kick",name:"Bumm",emoji:"🥁",kategorie:"drums",synth:"kick"},{id:"snare",name:"Klatsch",emoji:"👏",kategorie:"drums",synth:"snare"},{id:"hat",name:"Tss",emoji:"✨",kategorie:"drums",synth:"hat"},{id:"pluck",name:"Pling",emoji:"🎹",kategorie:"melodie",synth:"pluck"}];
function synthSpielen(art,wann){if(art==="kick"){let o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(150,wann);o.frequency.exponentialRampToValueAtTime(45,wann+.12);g.gain.setValueAtTime(1,wann);g.gain.exponentialRampToValueAtTime(.001,wann+.3);o.connect(g);g.connect(bus());o.start(wann);o.stop(wann+.32)}else if(art==="snare"){let n=rauschen(.2),f=ctx.createBiquadFilter(),g=ctx.createGain();f.type="highpass";f.frequency.value=1500;g.gain.setValueAtTime(.7,wann);g.gain.exponentialRampToValueAtTime(.001,wann+.18);n.connect(f);f.connect(g);g.connect(bus());n.start(wann)}else if(art==="hat"){let n=rauschen(.06),f=ctx.createBiquadFilter(),g=ctx.createGain();f.type="highpass";f.frequency.value=6000;g.gain.setValueAtTime(.4,wann);g.gain.exponentialRampToValueAtTime(.001,wann+.05);n.connect(f);f.connect(g);g.connect(bus());n.start(wann)}else if(art==="pluck"){let o=ctx.createOscillator(),g=ctx.createGain();let toene=S.scale==="dur"?[0,4,7,12]:[0,3,7,12];let t=toene[Math.floor(Math.random()*toene.length)];o.type="triangle";o.frequency.value=261.6*Math.pow(2,(NOTEN.indexOf(S.key)+t)/12);g.gain.setValueAtTime(.5,wann);g.gain.exponentialRampToValueAtTime(.001,wann+.4);o.connect(g);g.connect(bus());o.start(wann);o.stop(wann+.42)}}
function rauschen(d){let b=ctx.createBuffer(1,ctx.sampleRate*d,ctx.sampleRate),ch=b.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=Math.random()*2-1;let q=ctx.createBufferSource();q.buffer=b;return q;}

/* ========== SAMPLES ========== */
async function ladeManifest(){for(let url of["api/samples","assets/samples/samples.json"]){try{let r=await fetch(url);if(!r.ok)continue;let j=await r.json();S.manifest=j.samples||(Array.isArray(j)?j:[]);if(S.manifest.length)break}catch(e){}}let ids=new Set(S.manifest.map(s=>s.id));SYNTH_KIT.forEach(k=>{if(!ids.has(k.id))S.manifest.push({...k})});S.manifest.forEach((s,i)=>{s.color=s.color||FARBEN[i%FARBEN.length]});}
async function ladeBuffer(s){if(s.buffer||s.synth)return;try{let r=await fetch(s.url);let ab=await r.arrayBuffer();s.buffer=await ctx.decodeAudioData(ab)}catch(e){}}
function findeSample(id){return S.manifest.find(s=>s.id===id);}
function spieleSample(s,wann){if(s.synth){synthSpielen(s.synth,wann);return}if(!s.buffer)return;let q=ctx.createBufferSource();q.buffer=s.buffer;q.connect(bus());q.start(wann);}

/* ========== SEQUENCER ========== */
let schrittDauer=()=>60/S.bpm/4;
function planer(){while(naechsteZeit<ctx.currentTime+.12){if(songModus)songSchrittSpielen();else{let s=schritt%16;S.tracks.forEach(t=>{if(t.pattern[s])spieleTrack(t,naechsteZeit)});malePlayhead(s);schritt++;}naechsteZeit+=schrittDauer()}}
function spieleTrack(t,wann){let smp=t.sample||findeSample(t.id);if(smp)spieleSample(smp,wann);else if(t.buffer){let q=ctx.createBufferSource();q.buffer=t.buffer;q.connect(bus());q.start(wann)}}
function start(was){audioStart();songModus=(was==="song");if(songModus){songSchritt=0;songGesamt=S.song.reduce((n,c)=>n+((S.slots[c]?.takte||1)*16),0);if(!songGesamt)return}spielen=true;schritt=0;naechsteZeit=ctx.currentTime+.08;timer=setInterval(planer,30);document.getElementById("btn-play").textContent="⏸️"}
function stopp(){spielen=false;clearInterval(timer);malePlayhead(-1);document.getElementById("btn-play").textContent="▶️"}
function songSchrittSpielen(){if(songSchritt>=songGesamt){stopp();return}let pos=songSchritt;for(let chip of S.song){let slot=S.slots[chip];if(!slot)continue;let len=(slot.takte||1)*16;if(pos<len){let s=pos%16;S.tracks.forEach(t=>{if((slot.patterns[t.id]||[])[s])spieleTrack(t,naechsteZeit)});malePlayhead(s);break}pos-=len}songSchritt++}

/* ========== UI: BEAT ========== */
function spurHinzufuegen(sampleId,pattern){let smp=findeSample(sampleId);if(!smp)return;if(S.tracks.some(t=>t.id===sampleId))return;ladeBuffer(smp);S.tracks.push({id:smp.id,name:smp.name,emoji:smp.emoji,color:smp.color,sample:smp,pattern:pattern||new Array(16).fill(0)});maleSpuren();speichern()}
function maleSpuren(){let box=document.getElementById("spuren");box.innerHTML="";S.tracks.forEach((t,ti)=>{let zeile=document.createElement("div");zeile.className="spur";let kopf=document.createElement("button");kopf.className="kopf";kopf.style.background=t.color;kopf.textContent=t.emoji;kopf.title=t.name;kopf.onclick=()=>{audioStart();spieleTrack(t,ctx.currentTime)};kopf.oncontextmenu=e=>{e.preventDefault();S.tracks.splice(ti,1);maleSpuren();speichern()};let zellen=document.createElement("div");zellen.className="zellen";t.pattern.forEach((v,s)=>{let z=document.createElement("button");z.className="zelle"+(s%4===0&&s>0?" gruppe":"")+(v?" an":"");z.style.background=v?t.color:"";z.dataset.spur=ti;z.dataset.schritt=s;z.onclick=()=>{t.pattern[s]=v?0:1;maleSpuren();speichern()};zellen.appendChild(z)});zeile.appendChild(kopf);zeile.appendChild(zellen);box.appendChild(zeile)})}
function malePlayhead(s){document.querySelectorAll(".zelle.playhead").forEach(z=>z.classList.remove("playhead"));if(s<0)return;document.querySelectorAll(`.zelle[data-schritt="${s}"]`).forEach(z=>z.classList.add("playhead"))}

/* ========== UI: PADS ========== */
function malePads(){let box=document.getElementById("pads");box.innerHTML="";S.manifest.forEach(smp=>{let p=document.createElement("button");p.className="pad";p.style.background=smp.color;p.innerHTML=`${smp.emoji}<small>${smp.name}</small>`;p.onclick=async()=>{audioStart();await ladeBuffer(smp);spieleSample(smp,ctx.currentTime)};box.appendChild(p)});S.aufnahmePads.forEach((a,i)=>{let p=document.createElement("button");p.className="pad";p.style.background="#ef5da8";p.innerHTML=`🎙️<small>Mein Sound ${i+1}</small>`;p.onclick=()=>{audioStart();let q=ctx.createBufferSource();q.buffer=a.buffer;q.connect(bus());q.start()};box.appendChild(p)});let rec=document.createElement("button");rec.className="pad";rec.id="pad-rec";rec.style.background="#3a2e4f";rec.innerHTML=`🎤⏺<small>Aufnehmen</small>`;rec.onclick=()=>padAufnehmen(rec);box.appendChild(rec)}
async function mikroStarten(onData){let strom=await navigator.mediaDevices.getUserMedia({audio:true});aufnahmeBrocken=[];let mime=["audio/webm","audio/mp4","audio/ogg"].find(m=>MediaRecorder.isTypeSupported(m))||"";mediaRec=new MediaRecorder(strom,mime?{mimeType:mime}:undefined);mediaRec.ondataavailable=e=>aufnahmeBrocken.push(e.data);mediaRec.onstop=async()=>{strom.getTracks().forEach(t=>t.stop());let blob=new Blob(aufnahmeBrocken,{type:mediaRec.mimeType});let ab=await blob.arrayBuffer();try{aufnahmeBuffer=await ctx.decodeAudioData(ab)}catch(e){aufnahmeBuffer=null};onData(aufnahmeBuffer)};mediaRec.start()}
async function padAufnehmen(knopf){audioStart();if(mediaRec&&mediaRec.state==="recording"){mediaRec.stop();return}knopf.classList.add("aufnahme");knopf.innerHTML="⏹<small>Stop</small>";await mikroStarten(async buf=>{knopf.classList.remove("aufnahme");knopf.innerHTML="🎤⏺<small>Aufnehmen</small>";if(!buf)return;if(document.getElementById("auto-zauber").checked){knopf.innerHTML="✨<small>Zauber…</small>";let gez=await zauberFit(buf);buf=gez||buf}knopf.innerHTML="🎤⏺<small>Aufnehmen</small>";S.aufnahmePads.push({buffer:buf,dataUrl:bufferZuDataUrl(buf)});malePads();speichern()});setTimeout(()=>{if(mediaRec&&mediaRec.state==="recording")mediaRec.stop()},10000)}

/* ========== KI-ZAUBER (Server) ========== */
async function zauberFit(buffer){try{let fd=new FormData();fd.append("file",new Blob([bufferZuWav(buffer)],{type:"audio/wav"}),"sound.wav");fd.append("bpm",S.bpm);fd.append("key",S.key);fd.append("scale",S.scale);let r=await fetch("api/audio/fit",{method:"POST",body:fd});let j=await r.json();if(j.ok)return await wavVonHex(j.wav_hex)}catch(e){}return null}
async function zauberTune(buffer,staerke){let fd=new FormData();fd.append("file",new Blob([bufferZuWav(buffer)],{type:"audio/wav"}),"stimme.wav");fd.append("key",S.key);fd.append("scale",S.scale);fd.append("strength",staerke);let r=await fetch("api/audio/tune",{method:"POST",body:fd});let j=await r.json();if(!j.ok)throw new Error(j.fehler||"Zauber fehlgeschlagen");return j}

/* ========== WAV ========== */
function bufferZuWav(buffer){let n=buffer.length,sr=buffer.sampleRate,d=new Float32Array(n);for(let c=0;c<buffer.numberOfChannels;c++){let cd=buffer.getChannelData(c);for(let i=0;i<n;i++)d[i]+=cd[i]/buffer.numberOfChannels}let out=new ArrayBuffer(44+n*2),v=new DataView(out);let wstr=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};wstr(0,"RIFF");v.setUint32(4,36+n*2,true);wstr(8,"WAVEfmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);wstr(36,"data");v.setUint32(40,n*2,true);for(let i=0;i<n;i++){let x=Math.max(-1,Math.min(1,d[i]));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}return out}
async function wavVonHex(hex){let bytes=new Uint8Array(hex.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.substr(i*2,2),16);return await ctx.decodeAudioData(bytes.buffer)}
function bufferZuDataUrl(buffer){let wav=bufferZuWav(buffer),bin="",b=new Uint8Array(wav);for(let i=0;i<b.length;i+=8192)bin+=String.fromCharCode(...b.subarray(i,i+8192));return"data:audio/wav;base64,"+btoa(bin)}
async function dataUrlZuBuffer(url){let ab=await(await fetch(url)).arrayBuffer();return await ctx.decodeAudioData(ab)}

/* ========== SINGEN ========== */
function singenEinrichten(){let knopf=document.getElementById("mikro-knopf"),status=document.getElementById("sing-status");knopf.onclick=async()=>{audioStart();if(mediaRec&&mediaRec.state==="recording"){mediaRec.stop();return}if(document.getElementById("metronom").checked){for(let i=4;i>0;i--){status.textContent=i;synthSpielen("hat",ctx.currentTime);await new Promise(r=>setTimeout(r,60000/S.bpm))}}status.textContent="🔴";await mikroStarten(buf=>{status.textContent=buf?"✅":"😕";if(buf){document.getElementById("sing-ergebnis").classList.remove("versteckt");gezaubertBuffer=null;document.getElementById("btn-speichern-pad").classList.add("versteckt")}});setTimeout(()=>{if(mediaRec&&mediaRec.state==="recording")mediaRec.stop()},15000)};document.getElementById("btn-hoeren").onclick=()=>{if(!aufnahmeBuffer)return;let q=ctx.createBufferSource();q.buffer=gezaubertBuffer||aufnahmeBuffer;q.connect(bus());q.start()};document.getElementById("btn-zaubern").onclick=async()=>{if(!aufnahmeBuffer)return;let info=document.getElementById("tune-info");info.classList.remove("versteckt");info.textContent="✨ Klangi richtet die Töne…";try{let j=await zauberTune(aufnahmeBuffer,document.getElementById("tune-staerke").value/100);gezaubertBuffer=await wavVonHex(j.wav_hex);info.textContent=`🤖 ${j.info.note||"Fertig!"} Hör es dir an!`;document.getElementById("btn-speichern-pad").classList.remove("versteckt")}catch(e){info.textContent="😴 Der Zauber schläft gerade. Dein Original klingt auch toll!"}};document.getElementById("btn-speichern-pad").onclick=()=>{if(!gezaubertBuffer)return;S.aufnahmePads.push({buffer:gezaubertBuffer,dataUrl:bufferZuDataUrl(gezaubertBuffer)});malePads();speichern();document.getElementById("tune-info").textContent="💾 Gespeichert! Schau bei den 🎹 Pads."}}

/* ========== SONG + KI ========== */
function maleBausteine(){let box=document.getElementById("bausteine");box.innerHTML="";["A","B","C"].forEach((k,i)=>{let b=document.createElement("button");b.className="baustein"+(S.slots[k]?"":" leer");b.style.background=["#ff5d5d","#4d9fff","#3ecf8e"][i];b.innerHTML=`${["🟥","🟦","🟩"][i]}<small>Baustein ${k}${S.slots[k]?"":" (leer)"}</small>`;b.onclick=()=>{if(S.slots[k]){S.song.push(k);maleSongspur();speichern()}};box.appendChild(b)})}
function maleSongspur(){let box=document.getElementById("songspur");box.innerHTML="";let farben={A:"#ff5d5d",B:"#4d9fff",C:"#3ecf8e"};S.song.forEach((k,i)=>{let c=document.createElement("button");c.className="chip";c.style.background=farben[k];c.textContent=k;c.onclick=()=>{S.song.splice(i,1);maleSongspur();speichern()};box.appendChild(c)})}
async function kiSong(){let blase=document.getElementById("ki-antwort");blase.classList.remove("versteckt");blase.textContent="🤖 Klangi überlegt…";try{let r=await fetch("api/ki/song",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bpm:S.bpm,key:S.key,scale:S.scale,wunsch:document.getElementById("ki-wunsch").value})});let j=await r.json();if(!j.muster)throw new Error("kein Muster");for(let[id,pattern]of Object.entries(j.muster)){if(!S.tracks.some(t=>t.id===id))spurHinzufuegen(id);let t=S.tracks.find(t=>t.id===id);if(t&&Array.isArray(pattern)&&pattern.length===16)t.pattern=pattern.map(Number)}["A","B","C"].forEach((k,i)=>{let bs=(j.bausteine||[])[i];if(!bs){S.slots[k]=null;return}let patterns={};S.tracks.forEach(t=>{patterns[t.id]=(bs.spuren||[]).includes(t.id)?t.pattern.slice():new Array(16).fill(0)});S.slots[k]={patterns,takte:Math.max(1,Math.min(8,bs.takte||2))}});S.song=["A","B","C"].filter(k=>S.slots[k]);maleSpuren();maleBausteine();maleSongspur();speichern();blase.innerHTML=`🤖 <b>${j.gruss||"Dein Song ist fertig!"}</b><br>💡 ${j.tipp||""}`+(j.quelle&&j.quelle!=="kimi"?`<br><span class="hinweis">(lokal gebastelt)</span>`:"")}catch(e){blase.textContent="😴 Klangi ist offline. Bau selbst einen Beat!"}}

/* ====== MAGISCHER SONG-MACHER (Suno-Modus) ====== */
function maleStyleChips(){
  let box=document.getElementById("style-chips");box.innerHTML="";
  STYLES.forEach(st=>{
    let c=document.createElement("button");
    c.className="chip"+(pickedStyles.includes(st.id)?" picked":"");
    c.innerHTML=`${st.emoji} ${st.name}`;
    c.onclick=()=>{
      let i=pickedStyles.indexOf(st.id);
      if(i>=0)pickedStyles.splice(i,1);else pickedStyles.push(st.id);
      maleStyleChips();
    };
    box.appendChild(c);
  });
}
async function magischerSong(){
  let prompt=document.getElementById("magic-prompt").value.trim();
  if(!prompt){prompt="Ein lustiges Lied";document.getElementById("magic-prompt").value=prompt}
  let box=document.getElementById("magic-ergebnis");
  box.innerHTML=`<div class="song-card"><div class="card-title">✨ Klangi schreibt…</div><p>Einen Moment, der Roboter dichtet! 🤖💭</p></div>`;

  // Style wählen
  let style=pickedStyles.length?STYLES.find(s=>pickedStyles.includes(s.id))||STYLES[0]:STYLES[Math.floor(Math.random()*STYLES.length)];
  if(!pickedStyles.length){pickedStyles=[style.id];maleStyleChips()}

  // Tempo + Tonart vom Style übernehmen
  S.bpm=style.bpm;S.key=style.key;S.scale=style.scale;
  document.getElementById("bpm").value=S.bpm;
  document.getElementById("bpm-anzeige").textContent=S.bpm;
  document.getElementById("tonart").value=S.key;
  document.getElementById("tonart-art").value=S.scale;

  // Kimi Lyrics generieren
  let lyrics="",tags=style.tags;
  try{
    let r=await fetch("api/ki/lyrics",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,wunsch:prompt,style:style.name,bpm:S.bpm,key:S.key,scale:S.scale})});
    if(r.ok){let j=await r.json();lyrics=j.lyrics||"";tags=j.tags||style.tags}
  }catch(e){}

  // Fallback-Lyrics wenn offline
  if(!lyrics){
    lyrics=`[Strophe]\n${prompt}, das ist unser Lied\nWir singen laut, dass jeder es sieht\nMit einem Lächeln und ganz viel Schwung\nSo macht Musik doch jedem Jung!\n\n[Refrain]\nOh-oh-oh, wir singen heut\nOh-oh-oh, das ist uns're Zeit\nKomm mach mit und tanz im Takt\nBis die ganze Erde lacht!`;
  }

  // Song-Karte bauen
  let card=document.createElement("div");card.className="song-card";
  card.innerHTML=`
    <div class="card-title">🎵 ${prompt}</div>
    <div class="card-style">${style.emoji} ${style.name} · ${S.bpm} BPM · ${tags}</div>
    <div class="lyrics-section">${lyrics.replace(/\n/g,"<br>")}</div>
    <div>${tags.split(",").map(t=>`<span class="tag">${t}</span>`).join(" ")}</div>
    <div class="btn-row">
      <button class="btn-song play" onclick="magicAlsBeat('${style.id}')">🥁 Als Beat spielen</button>
      <button class="btn-song record" onclick="magicAufnehmen()">🎤 Text einsingen</button>
      <button class="btn-song save" onclick="magicSpeichern('${prompt.replace(/'/g,"\\'")}','${style.id}','${tags.replace(/'/g,"\\'")}')">💾 Song merken</button>
    </div>
  `;
  box.innerHTML="";box.appendChild(card);

  // Auto-Beat: Grundspuren aus Style laden
  magicAlsBeat(style.id);

  // Song merken
  magicSpeichern(prompt,style.id,tags);
}

function magicAlsBeat(styleId){
  let style=STYLES.find(s=>s.id===styleId)||STYLES[0];
  S.bpm=style.bpm;S.key=style.key;S.scale=style.scale;
  document.getElementById("bpm").value=S.bpm;
  document.getElementById("bpm-anzeige").textContent=S.bpm;
  document.getElementById("tonart").value=S.key;
  document.getElementById("tonart-art").value=S.scale;
  // Standard-Beat Patterns
  let beats={kick:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],snare:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],hat:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]};
  if(style.id==="rock"){beats.kick=[1,0,1,0,1,0,1,1,1,0,1,0,1,1,0,0];beats.snare=[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]}
  S.tracks=[];["kick","snare","hat"].forEach(id=>spurHinzufuegen(id,beats[id]));
  maleSpuren();speichern();
}

function magicAufnehmen(){
  // Zum Singen-Tab wechseln mit den Lyrics im Kopf
  document.querySelectorAll("#tabs button").forEach(b=>{b.classList.remove("aktiv");if(b.dataset.screen==="sing")b.classList.add("aktiv")});
  document.querySelectorAll(".screen").forEach(s=>{s.classList.remove("aktiv");if(s.id==="screen-sing")s.classList.add("aktiv")});
  document.getElementById("mikro-knopf").click();
}

function magicSpeichern(title,styleId,tags){
  let style=STYLES.find(s=>s.id===styleId)||STYLES[0];
  let song={title,style:style.name,emoji:style.emoji,tags,bpm:S.bpm,key:S.key,scale:S.scale,tracks:S.tracks.map(t=>({id:t.id,pattern:t.pattern.slice()})),datum:new Date().toISOString().slice(0,10)};
  if(!S.magicSongs)S.magicSongs=[];
  S.magicSongs.unshift(song);
  if(S.magicSongs.length>20)S.magicSongs.length=20;
  maleGalerie();speichern();
}

function maleGalerie(){
  let box=document.getElementById("magic-galerie"),galBox=document.getElementById("magic-galerie-box");
  if(!S.magicSongs||!S.magicSongs.length){galBox.classList.add("versteckt");return}
  galBox.classList.remove("versteckt");
  box.innerHTML=S.magicSongs.map((s,i)=>`
    <div class="mini-card" onclick="magicLaden(${i})">
      <div class="mini-emoji">${s.emoji}</div>
      <div class="mini-title">${s.title}</div>
      <small>${s.style} · ${s.bpm} BPM · ${s.datum}</small>
    </div>
  `).join("");
}

function magicLaden(i){
  let s=S.magicSongs[i];if(!s)return;
  S.bpm=s.bpm;S.key=s.key;S.scale=s.scale;
  document.getElementById("bpm").value=S.bpm;
  document.getElementById("bpm-anzeige").textContent=S.bpm;
  document.getElementById("tonart").value=S.key;
  document.getElementById("tonart-art").value=S.scale;
  S.tracks=[];(s.tracks||[]).forEach(t=>spurHinzufuegen(t.id,t.pattern));
  maleSpuren();speichern();
  // Zum Magie-Tab
  document.querySelectorAll("#tabs button").forEach(b=>{b.classList.remove("aktiv");if(b.dataset.screen==="magic")b.classList.add("aktiv")});
  document.querySelectorAll(".screen").forEach(s=>{s.classList.remove("aktiv");if(s.id==="screen-magic")s.classList.add("aktiv")});
  // Prompt setzen
  document.getElementById("magic-prompt").value=s.title;
  // Style-Chip setzen
  pickedStyles=[];
  let st=STYLES.find(st=>st.name===s.style);
  if(st)pickedStyles=[st.id];
  maleStyleChips();
}

/* ========== SPEICHERN ========== */
function speichern(){try{localStorage.setItem("klangwerkstatt",JSON.stringify({bpm:S.bpm,key:S.key,scale:S.scale,tracks:S.tracks.map(t=>({id:t.id,pattern:t.pattern})),slots:S.slots,song:S.song,pads:S.aufnahmePads.map(p=>p.dataUrl),magicSongs:S.magicSongs,fx:[fx("fx-echo"),fx("fx-hall"),fx("fx-robot")]}))}catch(e){}}
async function laden(){let j=null;try{j=JSON.parse(localStorage.getItem("klangwerkstatt"))}catch(e){}if(!j){spurHinzufuegen("kick",[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]);spurHinzufuegen("snare",[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]);spurHinzufuegen("hat",[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]);return}
S.bpm=j.bpm||100;S.key=j.key||"C";S.scale=j.scale||"dur";(j.tracks||[]).forEach(t=>spurHinzufuegen(t.id,t.pattern));S.slots=j.slots||{A:null,B:null,C:null};S.song=j.song||[];S.magicSongs=j.magicSongs||[];if(j.fx){["fx-echo","fx-hall","fx-robot"].forEach((id,i)=>document.getElementById(id).value=j.fx[i]??0)}for(let url of(j.pads||[])){try{S.aufnahmePads.push({buffer:await dataUrlZuBuffer(url),dataUrl:url})}catch(e){}}}
let fx=id=>+document.getElementById(id).value;

/* ========== START ========== */
window.addEventListener("DOMContentLoaded",async()=>{
  // Tonart-Auswahl
  let sel=document.getElementById("tonart");NOTEN.forEach(n=>{let o=document.createElement("option");o.value=n;o.textContent=n;sel.appendChild(o)});
  // Tab-Navigation
  document.querySelectorAll("#tabs button").forEach(b=>{b.onclick=()=>{document.querySelectorAll("#tabs button").forEach(x=>x.classList.remove("aktiv"));document.querySelectorAll(".screen").forEach(x=>x.classList.remove("aktiv"));b.classList.add("aktiv");document.getElementById("screen-"+b.dataset.screen).classList.add("aktiv")}});

  await ladeManifest();await laden();
  document.getElementById("bpm").value=S.bpm;document.getElementById("bpm-anzeige").textContent=S.bpm;sel.value=S.key;document.getElementById("tonart-art").value=S.scale;
  let wahl=document.getElementById("sound-wahl");S.manifest.forEach(s=>{let o=document.createElement("option");o.value=s.id;o.textContent=`${s.emoji} ${s.name}`;wahl.appendChild(o)});
  maleStyleChips();maleSpuren();malePads();maleBausteine();maleSongspur();maleGalerie();singenEinrichten();

  // Events
  document.getElementById("btn-play").onclick=()=>spielen?stopp():start("beat");
  document.getElementById("btn-stop").onclick=stopp;
  document.getElementById("bpm").oninput=e=>{S.bpm=+e.target.value;document.getElementById("bpm-anzeige").textContent=S.bpm;speichern()};
  sel.onchange=e=>{S.key=e.target.value;speichern()};
  document.getElementById("tonart-art").onchange=e=>{S.scale=e.target.value;speichern()};
  document.getElementById("btn-clear").onclick=()=>{S.tracks.forEach(t=>t.pattern.fill(0));maleSpuren();speichern()};
  document.getElementById("btn-add-spur").onclick=()=>spurHinzufuegen(wahl.value);
  document.getElementById("btn-slot-save").onclick=()=>{let k=document.getElementById("slot-wahl").value,patterns={};S.tracks.forEach(t=>patterns[t.id]=t.pattern.slice());S.slots[k]={patterns,takte:2};maleBausteine();speichern()};
  document.getElementById("btn-song-play").onclick=()=>spielen?stopp():start("song");
  document.getElementById("btn-song-clear").onclick=()=>{S.song=[];maleSongspur();speichern()};
  document.getElementById("btn-ki").onclick=kiSong;
  ["fx-echo","fx-hall","fx-robot"].forEach(id=>{document.getElementById(id).oninput=()=>{if(!ctx)return;fxEcho.gain.value=fx("fx-echo")/100*.8;fxHall.gain.value=fx("fx-hall")/100*.9;robotGain.gain.value=fx("fx-robot")/100;robotKurve(fx("fx-robot")/100);speichern()}});
  document.body.addEventListener("pointerdown",audioStart,{once:true});
});
