const chickenHit = document.querySelector('#chicken-hit');
const chickenArt = document.querySelector('#chicken-art');
const pressPoint = document.querySelector('#press-point');
const interactionStatus = document.querySelector('#interaction-status');
const durationReadout = document.querySelector('#duration-readout');
const squeezeCount = document.querySelector('#squeeze-count');
const lastDuration = document.querySelector('#last-duration');
const intensityValue = document.querySelector('#intensity-value');
const intensityChip = document.querySelector('#intensity-chip');
const meterFill = document.querySelector('#meter-fill');
const muteButton = document.querySelector('#mute-button');
const resetButton = document.querySelector('#reset-button');
const soundLabel = document.querySelector('#sound-label');

const MAX_HOLD_SECONDS = 1;
let isPressing = false;
let pressStartedAt = 0;
let animationFrame = 0;
let statusTimeout = 0;
let activePointerId = null;
let keyboardPress = false;
let muted = false;
let count = loadCount();
let audioContext = null;
let squeakEngine = null;
let squeakEnginePromise = null;

// Calibrated against the reference recording (youtube fDr9G1e1Xq4). Aligning
// its audio with the video's hand motion shows what the toy actually does:
// the cry starts as the hand STOPS moving and runs long after the squeeze is
// over -- a 0.25 s squeeze yields a 1.06 s cry, 0.75 s yields 3.87 s. So the
// scream is not the air being pushed out. Squeezing empties the body quickly
// and only rasps; the rubber then springs back slowly and drags air back in
// through the reed, and that slow intake is the scream. Displaced volume sets
// its length, which is why a brief press can sing for four seconds.
//
// Measured on the three cries: fundamental ~440 Hz whose 2nd (880 Hz) and 3rd
// (1320 Hz) partials carry nearly all the energy; level plateaus at 70-95% for
// the whole cry instead of decaying; pitch rises over the attack then sags 13%
// as the body refills and the restoring force fades. The exhaust rasp measures
// a quarter as loud, unpitched, and centred five times higher.
const SQUEAK_WORKLET_SOURCE = String.raw`
// h3 is set per voice below, since it varies with pressure.
const HARMONICS = [0.08, 1, 0, 0.1, 0.05, 0.025, 0.03, 0.04, 0.03, 0.02];
const HARMONIC_NORM = 1 / 2.4;

class ScreamingChickenProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cries = [];
    this.exhaust = { gain: 0, target: 0, air: 0, lp: 0 };
    this.seed = 17389;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'squeeze') {
        // Air is leaving the body. It only rasps -- the reed does not sing on
        // the way out, and it goes quiet the moment the squeeze stops moving.
        this.exhaust.target = data.rate;
        this.exhaust.air = data.air;
      } else if (data.type === 'release') {
        this.exhaust.target = 0;
        const air = Math.max(0, Math.min(1, data.air));
        this.cries.push({
          air,
          // Length is the volume to refill over the reed's intake rate, not
          // how long the user held.
          duration: 0.3 + air * 3.6,
          frame: 0,
          phase: 0,
          lp: 0,
          breakUntil: 0,
          nextBreak: sampleRate * (0.6 + this.random() * 1.2),
          wobble: this.random() * Math.PI * 2,
        });
      }
    };
  }

  random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const frameCount = output[0].length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let mixed = 0;

      // --- air being pushed out: a rasp, never a scream ---
      const exhaust = this.exhaust;
      exhaust.gain += (exhaust.target - exhaust.gain) * 0.0016;
      if (exhaust.gain > 0.0005) {
        const noise = this.random() * 2 - 1;
        exhaust.lp += (noise - exhaust.lp) * 0.32;
        // Measured a quarter as loud as the cry and centred far higher, so the
        // deeper the squeeze the coarser it gets.
        mixed += (noise - exhaust.lp) * exhaust.gain * (0.07 + exhaust.air * 0.045);
      }

      // --- air being drawn back in: the cry ---
      for (let index = this.cries.length - 1; index >= 0; index -= 1) {
        const voice = this.cries[index];
        const time = voice.frame / sampleRate;
        const progress = time / voice.duration;

        if (progress >= 1) {
          this.cries.splice(index, 1);
          continue;
        }

        // The rubber's restoring force does the work, so the level holds while
        // the body is still out of shape and shuts off as it finishes filling.
        const attack = Math.min(1, time / 0.035);
        const closing = Math.min(1, (1 - progress) / 0.05);
        const supply = attack * closing * (0.82 + 0.18 * (1 - progress));

        const noise = this.random() * 2 - 1;
        voice.lp += (noise - voice.lp) * 0.32;
        const hiss = noise - voice.lp;

        const lock = Math.max(0, Math.min(1, (time - 0.018) / 0.055));
        const vibrato = Math.sin(time * Math.PI * 2 * 5.5 + voice.wobble) * 0.012;
        // Pitch tracks the restoring force: it climbs on the attack, then sags
        // 13% as the body regains its shape. Smooth -- no steps.
        let frequency =
          454 * (0.94 + 0.06 * attack) * (1 - 0.13 * Math.pow(progress, 1.4)) * (1 + vibrato);

        // Only the deepest squeezes refill hard enough to overdrive the reed
        // into a brief higher mode. Short squeezes stay clean and level, which
        // is why the first two cries in the reference hold one clear note.
        if (voice.air > 0.75) {
          if (voice.frame >= voice.nextBreak) {
            voice.breakUntil = voice.frame + sampleRate * (0.012 + this.random() * 0.028);
            voice.nextBreak = voice.frame + sampleRate * (0.7 + this.random() * 1.4);
          }
          if (voice.frame < voice.breakUntil) frequency *= 2.06;
        }

        voice.phase += (Math.PI * 2 * frequency) / sampleRate;
        if (voice.phase > Math.PI * 2) voice.phase -= Math.PI * 2;

        // Additive with the measured weights. The real spectrum is narrow --
        // h2 and h3 carry it and little survives above h5 -- so saturating a
        // rich waveform would add a buzz the toy does not have.
        let tone = 0;
        for (let h = 0; h < HARMONICS.length; h += 1) {
          // The 3rd partial thins as the intake hardens: 0.79 on the gentlest
          // cry down to 0.46 on the hardest. Soft squeezes are reedier.
          const weight = h === 2 ? 1.02 - voice.air * 0.47 : HARMONICS[h];
          tone += Math.sin(voice.phase * (h + 1)) * weight;
        }
        tone *= HARMONIC_NORM;

        const breath = hiss * 0.09 * (0.4 + voice.air * 0.6);
        const startup = hiss * (1 - lock) * 0.34;
        mixed += supply * (tone * lock * (0.31 + voice.air * 0.31) + breath * lock + startup);
        voice.frame += 1;
      }

      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel][frame] = mixed;
      }
    }

    return true;
  }
}

registerProcessor('screaming-chicken-processor', ScreamingChickenProcessor);
`;

function loadCount() {
  try {
    return Math.max(0, Number.parseInt(localStorage.getItem('squeak-count') || '0', 10) || 0);
  } catch {
    return 0;
  }
}

function saveCount() {
  try {
    localStorage.setItem('squeak-count', String(count));
  } catch {
    // Storage is an enhancement; the interaction still works without it.
  }
}

function formatCount(value) {
  return String(value).padStart(3, '0');
}

function setIdleState() {
  chickenHit.classList.remove('is-pressing');
  chickenHit.style.setProperty('--squeeze-scale', '1');
  pressPoint.style.left = '50%';
  pressPoint.style.top = '50%';
  interactionStatus.textContent = '准备好了';
  intensityValue.textContent = '未开始';
  intensityChip.textContent = '0%';
  meterFill.style.transform = 'scaleX(0)';
  meterFill.style.backgroundColor = 'var(--blue)';
  durationReadout.textContent = '00.00 秒';
}

function setPressOrigin(clientX, clientY) {
  const rect = chickenHit.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
  const xPercent = `${(x / rect.width) * 100}%`;
  const yPercent = `${(y / rect.height) * 100}%`;
  chickenHit.style.setProperty('--press-x', xPercent);
  chickenHit.style.setProperty('--press-y', yPercent);
  pressPoint.style.left = xPercent;
  pressPoint.style.top = yPercent;
  chickenHit.querySelector('.touch-ripple').style.left = xPercent;
  chickenHit.querySelector('.touch-ripple').style.top = yPercent;
}

function sendSqueezeState(rate, air) {
  if (!squeakEngine) return;
  squeakEngine.port.postMessage({ type: 'squeeze', rate: muted ? 0 : rate, air });
}

function getIntensity(elapsed) {
  return Math.min(100, Math.round((elapsed / MAX_HOLD_SECONDS) * 100));
}

function updatePress() {
  if (!isPressing) return;
  const elapsed = Math.min(MAX_HOLD_SECONDS, (performance.now() - pressStartedAt) / 1000);
  const intensity = getIntensity(elapsed);
  const scale = Math.max(0.56, 1 - intensity * 0.0044);
  chickenHit.style.setProperty('--squeeze-scale', String(scale));
  // Air only leaves while the body is still collapsing. Holding at full
  // squeeze displaces nothing more, so the rasp dies away on its own.
  sendSqueezeState(elapsed < MAX_HOLD_SECONDS ? 1 : 0, intensity / 100);
  durationReadout.textContent = `${elapsed.toFixed(2).padStart(5, '0')} 秒`;
  intensityValue.textContent = intensity > 72 ? '重' : intensity > 38 ? '中' : '轻';
  intensityChip.textContent = `${intensity}%`;
  meterFill.style.transform = `scaleX(${intensity / 100})`;
  meterFill.style.backgroundColor = intensity > 72 ? 'var(--orange)' : 'var(--blue)';
  animationFrame = requestAnimationFrame(updatePress);
}

function ensureAudio() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

async function ensureSqueakEngine() {
  const context = ensureAudio();
  if (!context || !context.audioWorklet) return null;
  if (squeakEngine) return squeakEngine;
  if (squeakEnginePromise) return squeakEnginePromise;

  squeakEnginePromise = (async () => {
    const workletUrl = URL.createObjectURL(new Blob([SQUEAK_WORKLET_SOURCE], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(workletUrl);
      const engine = new AudioWorkletNode(context, 'screaming-chicken-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // The worklet already produces the measured spectrum, so the chain only
      // clears rumble and holds the peaks steady instead of re-colouring it.
      const rumble = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();
      const output = context.createGain();

      rumble.type = 'highpass';
      rumble.frequency.value = 180;
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      output.gain.value = 1.35;

      engine.connect(rumble).connect(compressor);
      compressor.connect(output).connect(context.destination);
      squeakEngine = engine;
      return engine;
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
  })().catch(() => {
    squeakEnginePromise = null;
    return null;
  });

  return squeakEnginePromise;
}

function playFallbackSqueak(context, air) {
  // Same shape as the worklet for browsers without AudioWorklet: the reference
  // tone is close enough to three partials that oscillators can carry it.
  const now = context.currentTime;
  const duration = 0.3 + air * 3.6;
  const output = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const partials = [
    { ratio: 1, level: 0.08 },
    { ratio: 2, level: 0.5 },
    { ratio: 3, level: 0.26 + air * 0.14 },
    { ratio: 4, level: 0.05 },
  ];

  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  output.gain.value = 1.35;
  compressor.connect(output).connect(context.destination);

  partials.forEach(({ ratio, level }) => {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    // Pitch sags with the emptying body, exactly as measured.
    osc.frequency.setValueAtTime(446 * ratio, now);
    osc.frequency.linearRampToValueAtTime(446 * 0.8 * ratio, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.035);
    // A plateau, not a decay -- the level holds while air remains.
    gain.gain.setValueAtTime(level, now + duration * 0.95);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(compressor);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  });
}

function playSqueak(intensity) {
  if (muted) return;
  const context = ensureAudio();
  if (!context) return;

  // Intensity is how far the body was compressed, so it is the volume the
  // rubber now has to drag back in through the reed -- that sets the cry.
  const air = Math.max(0.04, intensity / 100);

  ensureSqueakEngine().then((engine) => {
    if (muted) return;
    if (!engine) {
      playFallbackSqueak(context, air);
      return;
    }
    engine.port.postMessage({ type: 'release', air });
  });
}

function startPress(clientX, clientY, pointerId = null) {
  if (isPressing) return;
  isPressing = true;
  activePointerId = pointerId;
  pressStartedAt = performance.now();
  if (clientX == null || clientY == null) {
    const rect = chickenHit.getBoundingClientRect();
    setPressOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);
  } else {
    setPressOrigin(clientX, clientY);
  }
  window.clearTimeout(statusTimeout);
  chickenHit.classList.add('is-pressing');
  interactionStatus.textContent = '按住不放';
  ensureAudio();
  ensureSqueakEngine();
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(updatePress);
}

function finishPress(shouldSqueak = true) {
  if (!isPressing) return;
  const elapsed = Math.min(MAX_HOLD_SECONDS, (performance.now() - pressStartedAt) / 1000);
  const intensity = getIntensity(elapsed);
  isPressing = false;
  activePointerId = null;
  cancelAnimationFrame(animationFrame);

  if (shouldSqueak) {
    count += 1;
    saveCount();
    squeezeCount.textContent = formatCount(count);
    lastDuration.textContent = `${elapsed.toFixed(2)} 秒`;
    interactionStatus.textContent = '尖叫！';
    playSqueak(intensity);
    chickenHit.classList.remove('is-pressing');
    window.clearTimeout(statusTimeout);
    statusTimeout = window.setTimeout(setIdleState, 700);
  } else {
    sendSqueezeState(0, 0);
    setIdleState();
  }
}

function renderSoundIcon() {
  const icon = muted
    ? '<path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m23 9-6 6M17 9l6 6" />'
    : '<path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />';
  muteButton.querySelector('svg').innerHTML = icon;
  muteButton.setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
  muteButton.setAttribute('aria-pressed', String(muted));
  soundLabel.textContent = muted ? '声音已静音' : '声音已开启';
}

function resetCount() {
  count = 0;
  saveCount();
  squeezeCount.textContent = formatCount(count);
  lastDuration.textContent = '--.-- 秒';
  interactionStatus.textContent = '次数已清零';
  window.clearTimeout(statusTimeout);
  statusTimeout = window.setTimeout(setIdleState, 900);
}

chickenHit.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  activePointerId = event.pointerId;
  chickenHit.setPointerCapture(event.pointerId);
  startPress(event.clientX, event.clientY, event.pointerId);
});

chickenHit.addEventListener('pointermove', (event) => {
  if (isPressing && event.pointerId === activePointerId) setPressOrigin(event.clientX, event.clientY);
});

chickenHit.addEventListener('pointerup', (event) => {
  if (event.pointerId === activePointerId) finishPress(true);
});

chickenHit.addEventListener('pointercancel', (event) => {
  if (event.pointerId === activePointerId) finishPress(false);
});

chickenHit.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
    event.preventDefault();
    keyboardPress = true;
    startPress();
  }
});

chickenHit.addEventListener('keyup', (event) => {
  if (keyboardPress && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault();
    keyboardPress = false;
    finishPress(true);
  }
});

window.addEventListener('blur', () => {
  if (isPressing) {
    keyboardPress = false;
    finishPress(false);
  }
});

muteButton.addEventListener('click', () => {
  muted = !muted;
  if (muted) sendSqueezeState(0, 0);
  renderSoundIcon();
});

resetButton.addEventListener('click', resetCount);

squeezeCount.textContent = formatCount(count);
setIdleState();
