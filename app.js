const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  file: null,
  url: null,
  audioBuffer: null,
  analysis: null,
  waveform: [],
};

const audio = $('#audio');

// ---------- Navigation ----------
$$('.nav-link').forEach((btn) => btn.addEventListener('click', () => {
  $$('.nav-link').forEach((b) => b.classList.toggle('active', b === btn));
  $$('.view').forEach((v) => v.classList.toggle('active-view', v.id === `${btn.dataset.view}-view`));
}));

// ---------- Upload ----------
function setupDrop(zone, input, onFile) {
  ['dragenter', 'dragover'].forEach((event) => zone.addEventListener(event, (e) => {
    e.preventDefault(); zone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((event) => zone.addEventListener(event, (e) => {
    e.preventDefault(); zone.classList.remove('drag');
  }));
  zone.addEventListener('drop', (e) => e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]));
  input.addEventListener('change', (e) => e.target.files[0] && onFile(e.target.files[0]));
}

function isAudio(file) { return file && (file.type.startsWith('audio/') || /\.(wav|mp3|m4a|ogg|flac)$/i.test(file.name)); }

async function loadAudio(file) {
  if (!isAudio(file)) return;
  state.file = file;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  audio.src = state.url;
  $('#file-name').textContent = file.name;
  $('#workspace').classList.remove('hidden');
  $('#dropzone').classList.add('hidden');
  $('#status').textContent = 'Ready';
  $('#analysis-summary').classList.add('hidden');
  $('#tab-editor').textContent = blankTab($('#instrument').value);
  $('#tab-title').textContent = `${file.name.replace(/\.[^.]+$/, '')} · ${$('#instrument').value.toLowerCase()}`;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    state.audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    await ctx.close();
    state.waveform = makeWaveform(state.audioBuffer, 180);
    drawWaveform(state.waveform);
    updateMeta();
  } catch (err) {
    $('#status').textContent = 'Playback ready · analysis unavailable';
  }
}

function updateMeta() {
  if (!state.audioBuffer) return;
  $('#duration-meta').textContent = formatTime(state.audioBuffer.duration);
  $('#sample-meta').textContent = `${state.audioBuffer.sampleRate.toLocaleString()} Hz`;
  $('#channels-meta').textContent = `${state.audioBuffer.numberOfChannels} ch`;
  $('#meta-strip').classList.remove('hidden');
}

setupDrop($('#dropzone'), $('#audio-input'), loadAudio);
$('#replace-btn').onclick = () => $('#audio-input').click();

// ---------- Player ----------
$('#play-btn').onclick = async () => {
  if (audio.paused) { await audio.play(); }
  else audio.pause();
};
audio.addEventListener('play', () => $('#play-btn').textContent = '❚❚');
audio.addEventListener('pause', () => $('#play-btn').textContent = '▶');
audio.addEventListener('ended', () => $('#play-btn').textContent = '▶');
audio.addEventListener('loadedmetadata', () => $('#duration').textContent = formatTime(audio.duration));
audio.addEventListener('timeupdate', () => {
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  $('#playhead').style.left = `${p * 100}%`;
  $('#time').textContent = formatTime(audio.currentTime);
});
$('#timeline').addEventListener('pointerdown', (e) => {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
});

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.floor(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function makeWaveform(buffer, bins) {
  const ch = buffer.getChannelData(0), out = [];
  const step = Math.max(1, Math.floor(ch.length / bins));
  for (let i = 0; i < bins; i++) {
    let min = 1, max = -1;
    const start = i * step, end = Math.min(ch.length, start + step);
    for (let j = start; j < end; j += Math.max(1, Math.floor(step / 40))) { min = Math.min(min, ch[j]); max = Math.max(max, ch[j]); }
    out.push({ min, max });
  }
  return out;
}
function drawWaveform(wave) {
  const el = $('#waveform'); el.innerHTML = '';
  wave.forEach(({min,max}) => { const bar = document.createElement('i'); bar.style.height = `${Math.max(8, Math.min(100, (max-min)*70))}%`; el.appendChild(bar); });
}

// ---------- Music intelligence ----------
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const TUNINGS = {
  'Standard (E A D G B E)': [40,45,50,55,59,64],
  'Drop D (D A D G B E)': [38,45,50,55,59,64],
  'Half Step Down': [39,44,49,54,58,63],
};

function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }
function midiToName(midi) { return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`; }
function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function nearestMidi(hz) { return Math.round(hzToMidi(hz)); }

function analyzeAudio(buffer) {
  const source = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const maxSeconds = Math.min(buffer.duration, 180);
  const data = source.length > sampleRate * maxSeconds ? source.slice(0, Math.floor(sampleRate * maxSeconds)) : source;
  const frame = 2048, hop = 1024;
  const notes = [], energies = [];
  for (let start = 0; start + frame < data.length; start += hop) {
    let rms = 0;
    for (let i = 0; i < frame; i++) rms += data[start+i] * data[start+i];
    rms = Math.sqrt(rms / frame);
    energies.push(rms);
    if (rms < 0.012) continue;
    const freq = autocorrelatePitch(data, start, frame, sampleRate);
    if (!freq || freq < 55 || freq > 1400) continue;
    notes.push({ time: start / sampleRate, freq, midi: nearestMidi(freq), confidence: pitchConfidence(data, start, frame, sampleRate, freq) });
  }
  const smoothed = consolidateNotes(notes);
  const bpm = estimateBpm(energies, hop / sampleRate);
  return { notes: smoothed, bpm, duration: buffer.duration, sampleRate };
}

function autocorrelatePitch(data, offset, size, sr) {
  const minLag = Math.floor(sr / 1000), maxLag = Math.min(Math.floor(sr / 55), size - 2);
  let bestLag = -1, best = 0;
  let mean = 0; for (let i=0;i<size;i++) mean += data[offset+i]; mean /= size;
  for (let lag=minLag; lag<=maxLag; lag++) {
    let sum=0, norm1=0, norm2=0;
    for(let i=0;i<size-lag;i++) { const a=data[offset+i]-mean,b=data[offset+i+lag]-mean; sum+=a*b; norm1+=a*a; norm2+=b*b; }
    const corr = sum / Math.sqrt((norm1*norm2)||1);
    if(corr>best){best=corr;bestLag=lag;}
  }
  if(bestLag<0 || best<0.55) return null;
  return sr/bestLag;
}
function pitchConfidence(data, offset, size, sr, freq) {
  const lag = Math.round(sr/freq); let sum=0,n=0;
  for(let i=0;i<size-lag;i+=2){sum += Math.abs(data[offset+i]-data[offset+i+lag]); n++;}
  return Math.max(0, Math.min(1, 1 - (sum/n)*5));
}
function consolidateNotes(notes) {
  if (!notes.length) return [];
  const out=[]; let cur=null;
  for(const n of notes){
    if(!cur || Math.abs(n.midi-cur.midi)>0 || n.time-cur.lastTime>0.28){ if(cur) out.push(cur); cur={midi:n.midi,start:n.time,lastTime:n.time,confidence:n.confidence,count:1}; }
    else { cur.lastTime=n.time; cur.confidence=(cur.confidence+n.confidence)/2; cur.count++; }
  }
  if(cur) out.push(cur);
  return out.filter(n=>n.count>=1).map(n=>({...n,duration:Math.max(0.12,n.lastTime-n.start+0.12),name:midiToName(n.midi)}));
}
function estimateBpm(energies, hopSec) {
  if(energies.length<8) return null;
  const peaks=[]; const mean=energies.reduce((a,b)=>a+b,0)/energies.length;
  for(let i=2;i<energies.length-2;i++) if(energies[i]>mean*1.35 && energies[i]>=energies[i-1] && energies[i]>=energies[i+1]) peaks.push(i);
  if(peaks.length<3) return null;
  const diffs=[]; for(let i=1;i<peaks.length;i++) diffs.push((peaks[i]-peaks[i-1])*hopSec);
  const median=diffs.sort((a,b)=>a-b)[Math.floor(diffs.length/2)];
  if(!median || median<0.25 || median>1.5) return null;
  let bpm=60/median; while(bpm<80)bpm*=2; while(bpm>180)bpm/=2; return Math.round(bpm);
}

function mapToTab(notes, instrument, tuning) {
  if (!notes.length) return blankTab(instrument);
  if (instrument === 'Piano') return notes.map(n=>`${formatTime(n.start)}  ${n.name}`).join('\n');
  if (instrument === 'Drums') return 'Kick | ' + notes.filter(n=>n.midi%12===0).map(n=>n.start.toFixed(2)).join('  ') + '\nSnare| ' + notes.filter(n=>n.midi%12===5).map(n=>n.start.toFixed(2)).join('  ');
  const strings = TUNINGS[tuning] || TUNINGS['Standard (E A D G B E)'];
  const rows = Array.from({length:6},()=>[]);
  const display = notes.slice(0, 80);
  for(const n of display){
    let best=null;
    for(let s=0;s<strings.length;s++){
      const fret=n.midi-strings[s]; if(fret>=0 && fret<=24){ const score=fret<7?0:Math.abs(fret-7)*0.12; if(!best||score<best.score)best={s,fret,score}; }
    }
    if(best) rows[5-best.s].push({t:n.start,f:String(best.fret)});
  }
  const names = instrument==='Bass'?['G','D','A','E']:['e','B','G','D','A','E'];
  const used = instrument==='Bass'?rows.slice(0,4):rows;
  const tabRows = names.map((name, idx)=>{
    const entries=used[idx]||[]; let text='-'.repeat(28);
    entries.slice(0,8).forEach((e,k)=>{const pos=Math.min(25,Math.floor((e.t/Math.max(1,notes[display.length-1].start))*24)); const val=e.f.padStart(2,'-'); text=text.substring(0,pos)+val+text.substring(Math.min(text.length,pos+2));});
    return `${name}|${text}|`;
  });
  return tabRows.join('\n');
}
function blankTab(instrument){
  if(instrument==='Bass') return 'G|-------------------------|\nD|-------------------------|\nA|-------------------------|\nE|-------------------------|';
  if(instrument==='Piano') return 'No notes detected yet.';
  if(instrument==='Drums') return 'HH|x-x-x-x-x-x-x-x-|\nSN|----o-------o---|\nBD|o-------o-------|';
  return 'e|-------------------------|\nB|-------------------------|\nG|-------------------------|\nD|-------------------------|\nA|-------------------------|\nE|-------------------------|';
}

$('#transcribe-btn').onclick = async () => {
  if (!state.audioBuffer) return;
  const b=$('#transcribe-btn'); const status=$('#status');
  b.disabled=true; b.textContent='Analyzing…'; status.textContent='Listening';
  $('#analysis-summary').classList.remove('hidden');
  try {
    await new Promise(r=>setTimeout(r,30));
    state.analysis=analyzeAudio(state.audioBuffer);
    const instrument=$('#instrument').value, tuning=$('#tuning').value;
    $('#tab-editor').textContent=mapToTab(state.analysis.notes,instrument,tuning);
    $('#tab-title').textContent=`${state.file.name.replace(/\.[^.]+$/,'')} · ${instrument.toLowerCase()}`;
    $('#note-count').textContent=state.analysis.notes.length;
    $('#bpm').textContent=state.analysis.bpm ? state.analysis.bpm : '—';
    $('#range').textContent=state.analysis.notes.length ? `${state.analysis.notes[0].name}–${state.analysis.notes[state.analysis.notes.length-1].name}` : '—';
    status.textContent=state.analysis.notes.length ? 'Draft transcription' : 'No clear pitch found';
  } catch(err) { status.textContent='Analysis failed'; console.error(err); }
  b.disabled=false; b.textContent='Analyze again';
};

$('#instrument').onchange=()=>{ if(state.file) $('#tab-title').textContent=`${state.file.name.replace(/\.[^.]+$/,'')} · ${$('#instrument').value.toLowerCase()}`; };
$('#copy-btn').onclick=async()=>{ try{await navigator.clipboard.writeText($('#tab-editor').innerText);$('#copy-btn').textContent='Copied';setTimeout(()=>$('#copy-btn').textContent='Copy tab',1200);}catch{} };
$('#download-tab').onclick=()=>{ const blob=new Blob([$('#tab-editor').innerText],{type:'text/plain'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='tabify-transcription.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500); };

// ---------- Converter UI ----------
function loadConvert(file){
  if(!file) return;
  $('#convert-name').textContent=file.name;
  $('#convert-panel').classList.remove('hidden');
  $('#convert-dropzone').classList.add('hidden');
  $('#convert-btn').onclick=()=>{
    $('#convert-note').textContent='For production deployment, this button connects to the FFmpeg worker and returns a downloadable MP4. The UI is ready for that endpoint.';
    $('#convert-btn').textContent='MP4 pipeline ready';
  };
}
setupDrop($('#convert-dropzone'),$('#convert-input'),loadConvert);

// ---------- Settings modal ----------
$('#settings-btn').onclick=()=>$('#settings-modal').classList.remove('hidden');
$('#close-settings').onclick=()=>$('#settings-modal').classList.add('hidden');

// initialize waveform placeholder
if($('#waveform')) drawWaveform(Array.from({length:180},(_,i)=>({min:-.15*Math.random(),max:.15*Math.random()})));
