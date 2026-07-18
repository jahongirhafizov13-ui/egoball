// ============================================================================
// audio.js - Synthesized SFX audio engine
// Loaded as a classic (non-module) script - shares top-level scope with every
// other file below it in index.html, in the exact order they're listed there.
// ============================================================================
"use strict";

/* ============================= AUDIO ENGINE (synthesized SFX, no files needed) ============================= */
let actx = null;
function ensureAudio(){
  if(!actx){ try{ actx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ actx=null; } }
  if(actx && actx.state==='suspended'){ actx.resume(); }
}
['pointerdown','touchstart','keydown'].forEach(evt=> window.addEventListener(evt, ensureAudio, {once:false, passive:true}));
function sfxVol(){
  if(!settings) return 0.6;
  if(settings.sfxMuted) return 0;
  return Math.max(0, Math.min(1,(settings.sfxVolume==null?70:settings.sfxVolume)/100));
}
function playSfx(name){
  if(!actx) return;
  const vol = sfxVol();
  if(vol<=0) return;
  const t0 = actx.currentTime;
  const g = actx.createGain();
  g.connect(actx.destination);
  if(name==='kick'){
    // layered: a short filtered noise "thump" (the impact) + a quick pitched tone (the ball
    // compressing and leaving the foot) - a single tone alone read as flat/toy-like
    const noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate*0.06), actx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for(let i=0;i<nd.length;i++) nd[i] = (Math.random()*2-1)*(1-i/nd.length);
    const noiseSrc = actx.createBufferSource(); noiseSrc.buffer = noiseBuf;
    const noiseFilter = actx.createBiquadFilter(); noiseFilter.type='lowpass'; noiseFilter.frequency.value=900;
    const noiseGain = actx.createGain(); noiseGain.gain.setValueAtTime(vol*0.5, t0); noiseGain.gain.exponentialRampToValueAtTime(0.001, t0+0.06);
    noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(actx.destination);
    noiseSrc.start(t0); noiseSrc.stop(t0+0.06);
    const osc = actx.createOscillator(); osc.type='triangle';
    osc.frequency.setValueAtTime(240, t0); osc.frequency.exponentialRampToValueAtTime(65, t0+0.1);
    g.gain.setValueAtTime(vol*0.5, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.14);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.15);
  } else if(name==='powerkick'){
    const osc = actx.createOscillator(); osc.type='sawtooth';
    osc.frequency.setValueAtTime(160, t0); osc.frequency.exponentialRampToValueAtTime(40, t0+0.16);
    g.gain.setValueAtTime(vol*0.7, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.2);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.21);
  } else if(name==='wall'){
    // billiard-ball "clack": a short, bright, hard-decaying click - real object-on-object contact,
    // not a soft muffled thud like the old version
    const osc = actx.createOscillator(); osc.type='triangle';
    osc.frequency.setValueAtTime(1900, t0); osc.frequency.exponentialRampToValueAtTime(700, t0+0.045);
    g.gain.setValueAtTime(vol*0.42, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.05);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.06);
    const noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate*0.02), actx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for(let i=0;i<nd.length;i++) nd[i] = (Math.random()*2-1)*(1-i/nd.length);
    const noiseSrc = actx.createBufferSource(); noiseSrc.buffer = noiseBuf;
    const noiseFilter = actx.createBiquadFilter(); noiseFilter.type='highpass'; noiseFilter.frequency.value=2200;
    const noiseGain = actx.createGain(); noiseGain.gain.setValueAtTime(vol*0.3, t0); noiseGain.gain.exponentialRampToValueAtTime(0.001, t0+0.02);
    noiseSrc.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(actx.destination);
    noiseSrc.start(t0); noiseSrc.stop(t0+0.02);
  } else if(name==='goal'){
    const notes=[523.25,659.25,783.99,1046.5];
    notes.forEach((f,i)=>{
      const o = actx.createOscillator(); o.type='triangle'; o.frequency.value=f;
      const gg = actx.createGain(); gg.connect(actx.destination);
      const start = t0+i*0.11;
      gg.gain.setValueAtTime(0.0001, start);
      gg.gain.linearRampToValueAtTime(vol*0.5, start+0.02);
      gg.gain.exponentialRampToValueAtTime(0.001, start+0.32);
      o.connect(gg); o.start(start); o.stop(start+0.34);
    });
  } else if(name==='whistle'){
    const osc = actx.createOscillator(); osc.type='square';
    osc.frequency.setValueAtTime(1800, t0); osc.frequency.setValueAtTime(2100, t0+0.09); osc.frequency.setValueAtTime(1800, t0+0.18);
    g.gain.setValueAtTime(vol*0.28, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.42);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.43);
  } else if(name==='click'){
    const osc = actx.createOscillator(); osc.type='sine'; osc.frequency.value=880;
    g.gain.setValueAtTime(vol*0.25, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.05);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.06);
  } else if(name==='casetick'){
    const osc = actx.createOscillator(); osc.type='square'; osc.frequency.value=1300;
    g.gain.setValueAtTime(vol*0.16, t0); g.gain.exponentialRampToValueAtTime(0.001, t0+0.045);
    osc.connect(g); osc.start(t0); osc.stop(t0+0.05);
  } else if(name==='casewin'){
    const notes=[659.25,880,1108.73,1318.51];
    notes.forEach((f,i)=>{
      const o = actx.createOscillator(); o.type='sine'; o.frequency.value=f;
      const gg = actx.createGain(); gg.connect(actx.destination);
      const start = t0+i*0.07;
      gg.gain.setValueAtTime(0.0001, start);
      gg.gain.linearRampToValueAtTime(vol*0.45, start+0.015);
      gg.gain.exponentialRampToValueAtTime(0.001, start+0.3);
      o.connect(gg); o.start(start); o.stop(start+0.32);
    });
  }
}
/* ---- ambient stadium crowd noise (procedural, loops under the match, quieter than SFX) ---- */
let ambienceNodes = null;
function startAmbience(){
  if(!actx || ambienceNodes) return;
  const dur = 4;
  const bufferSize = actx.sampleRate*dur;
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  let last=0;
  for(let i=0;i<bufferSize;i++){
    const white = Math.random()*2-1;
    last = (last + 0.02*white)/1.02; // gentle low-pass drift for a low crowd rumble
    data[i] = last*3.2;
  }
  const src = actx.createBufferSource(); src.buffer = buffer; src.loop = true;
  const filter = actx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=500; filter.Q.value=0.5;
  const gain = actx.createGain(); gain.gain.value = sfxVol()*0.18; // noticeably quieter than SFX
  src.connect(filter); filter.connect(gain); gain.connect(actx.destination);
  src.start();
  ambienceNodes = {src, gain};
}
function stopAmbience(){
  if(!ambienceNodes) return;
  try{ ambienceNodes.src.stop(); }catch(e){}
  ambienceNodes = null;
}
function updateAmbienceVolume(){
  if(ambienceNodes) ambienceNodes.gain.gain.value = sfxVol()*0.18;
}
function playCrowdCheer(){
  if(!actx) return;
  const vol = sfxVol();
  if(vol<=0) return;
  const t0 = actx.currentTime;
  const dur = 2.6;
  const bufferSize = Math.floor(actx.sampleRate*dur);
  const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
  const data = buffer.getChannelData(0);
  let last=0;
  for(let i=0;i<bufferSize;i++){
    const white = Math.random()*2-1;
    last = (last + 0.06*white)/1.06;
    data[i] = last*4.5;
  }
  const src = actx.createBufferSource(); src.buffer = buffer;
  const filter = actx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=1100; filter.Q.value=0.7;
  const gain = actx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(vol*0.55, t0+0.35);
  gain.gain.linearRampToValueAtTime(vol*0.4, t0+1.4);
  gain.gain.exponentialRampToValueAtTime(0.001, t0+dur);
  src.connect(filter); filter.connect(gain); gain.connect(actx.destination);
  src.start(t0); src.stop(t0+dur);
}

let lastWallSfxAt = 0;
function throttledWallSfx(){
  const now = performance.now();
  if(now-lastWallSfxAt > 140){ lastWallSfxAt = now; playSfx('wall'); }
}
document.addEventListener('click', e=>{
  if(e.target.closest('.btn, .modecard, .numcell, .chip, .backbtn, .hubrow, .colorcell, .frame-cell')) playSfx('click');
});

