const chickenHit = document.querySelector('#chicken-hit');
const chickenArt = document.querySelector('#chicken-art');
const chickenRain = document.querySelector('#chicken-rain');
const pressPoint = document.querySelector('#press-point');
const handCursor = document.querySelector('#hand-cursor');
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

const MAX_HOLD_SECONDS = 0.9;
let isPressing = false;
let pressStartedAt = 0;
let animationFrame = 0;
let statusTimeout = 0;
let activePointerId = null;
let keyboardPress = false;
let pointerOverChicken = false;
let muted = false;
let count = loadCount();
let audioContext = null;
let squeakEngine = null;
let squeakEnginePromise = null;

// Recalibrated against the smaller toy in youtube WDmuvYvxqC4
// ("Fidget Toy Shrilling Chicken"). Its cry is shorter and more piercing than
// the earlier large chicken: a tiny high-frequency crack, a chirping reed
// around the 1 kHz / 2 kHz family, then a quick little fall and cut-off. The
// 5.8 s clip contains several separate squeaks, so a single web release must
// stay short rather than turning them into one long 3-second scream.
function getSmallCryDuration(air) {
  if (air < 0.12) return 0.12 + (air / 0.12) * 0.1;
  if (air < 0.35) return 0.22 + ((air - 0.12) / 0.23) * 0.38;
  if (air < 0.65) return 0.6 + ((air - 0.35) / 0.3) * 0.3;
  return 0.9 + ((air - 0.65) / 0.35) * 0.35;
}
const SQUEAK_WORKLET_SOURCE = String.raw`
const HARMONICS = [0.04, 1, 0.28, 0.08, 0.035, 0.02, 0.018, 0.012];
const HARMONIC_NORM = 1 / 2.15;

function getCryDuration(air) {
  if (air < 0.12) return 0.12 + (air / 0.12) * 0.1;
  if (air < 0.35) return 0.22 + ((air - 0.12) / 0.23) * 0.38;
  if (air < 0.65) return 0.6 + ((air - 0.35) / 0.3) * 0.3;
  return 0.9 + ((air - 0.65) / 0.35) * 0.35;
}

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
          duration: getCryDuration(air),
          frame: 0,
          phase: 0,
          lp: 0,
          bandFast: 0,
          bandSlow: 0,
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
        // The small body exhales a thin, high rasp rather than a deep rubber
        // groan, so keep this layer quiet and light.
        mixed += (noise - exhaust.lp) * exhaust.gain * (0.05 + exhaust.air * 0.035);
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

        const tailDuration = Math.min(0.1, voice.duration * 0.16);
        const tailProgress = Math.max(
          0,
          Math.min(1, (time - (voice.duration - tailDuration)) / tailDuration),
        );

        // The small toy has a brief shrill attack, a compact chirping body,
        // and a quick fall. It should never inherit the large toy's long,
        // smooth three-second release envelope.
        const attack = Math.min(1, time / 0.022);
        const supply = attack * (1 - tailProgress) * (0.9 + 0.1 * (1 - progress));

        const noise = this.random() * 2 - 1;
        voice.lp += (noise - voice.lp) * 0.32;
        const hiss = noise - voice.lp;

        // Two short low-pass memories make the small toy's thin, high rasp
        // instead of adding a broad noisy layer.
        voice.bandFast += (noise - voice.bandFast) * 0.5;
        voice.bandSlow += (noise - voice.bandSlow) * 0.15;
        const midHighRasp = voice.bandFast - voice.bandSlow;

        const lock = Math.max(0, Math.min(1, (time - 0.012) / 0.042));
        const chirp = Math.sin(time * Math.PI * 2 * 7.2 + voice.wobble) * 0.035;
        const settling = 0.055 * Math.exp(-time / 0.09);
        // The smaller reed sits higher and chirps around a stable note. The
        // only decisive downward movement is the final short tail.
        let frequency = 520 * (1 + settling + chirp);
        if (tailProgress > 0) {
          frequency *= 1 - 0.22 * Math.pow(tailProgress, 0.68);
        }

        voice.phase += (Math.PI * 2 * frequency) / sampleRate;
        if (voice.phase > Math.PI * 2) voice.phase -= Math.PI * 2;

        // Additive with the measured weights. The real spectrum is narrow --
        // h2 and h3 carry it and little survives above h5 -- so saturating a
        // rich waveform would add a buzz the toy does not have.
        let tone = 0;
        for (let h = 0; h < HARMONICS.length; h += 1) {
          tone += Math.sin(voice.phase * (h + 1)) * HARMONICS[h];
        }
        tone *= HARMONIC_NORM;

        const crackEnvelope = Math.exp(-time / 0.055) * (1 - Math.exp(-time / 0.003));
        const crackBurst = (noise - voice.lp) * crackEnvelope * (0.22 + voice.air * 0.1);
        const crackRasp = midHighRasp * crackEnvelope * 0.2;
        const breath = hiss * 0.055 * (0.45 + voice.air * 0.55);
        const shrillBody = midHighRasp * (0.018 + voice.air * 0.018);
        mixed += supply * (tone * lock * (0.38 + voice.air * 0.15) + breath * lock + shrillBody);
        mixed += crackBurst + crackRasp;
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
  interactionStatus.textContent = '它还活着，暂时';
  intensityValue.textContent = '未开始';
  intensityChip.textContent = '0%';
  meterFill.style.transform = 'scaleX(0)';
  meterFill.style.backgroundColor = 'var(--blue)';
  durationReadout.textContent = '00.00 秒';
}

function setHandPosition(clientX, clientY) {
  if (!handCursor || clientX == null || clientY == null) return;
  handCursor.style.setProperty('--hand-x', `${clientX}px`);
  handCursor.style.setProperty('--hand-y', `${clientY}px`);
}

function showHandCursor(clientX, clientY) {
  if (!handCursor || clientX == null || clientY == null) return;
  setHandPosition(clientX, clientY);
  handCursor.classList.add('is-visible');
}

function hideHandCursor() {
  if (!handCursor) return;
  handCursor.classList.remove('is-visible', 'is-grabbing');
}

function setHandGrabbing(grabbing) {
  if (!handCursor) return;
  handCursor.classList.toggle('is-grabbing', grabbing);
}

function startChickenRain() {
  if (!chickenRain || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const source = chickenArt?.querySelector('svg');
  if (!source) return;

  const chickenCount = 12;

  for (let index = 0; index < chickenCount; index += 1) {
    const fallingChicken = document.createElement('span');
    const clone = source.cloneNode(true);
    const spread = 8 + ((index * 37 + Math.random() * 18) % 84);
    const delay = index * 0.08 + Math.random() * 0.32;
    const duration = 2050 + Math.random() * 950;
    const start = -90 - Math.random() * 240;
    const midDrift = -120 + Math.random() * 240;
    const endDrift = -180 + Math.random() * 360;

    fallingChicken.className = 'falling-chicken';
    fallingChicken.style.setProperty('--fall-x', `${spread}%`);
    fallingChicken.style.setProperty('--fall-start', `${start}px`);
    fallingChicken.style.setProperty('--fall-size', `${24 + Math.random() * 30}px`);
    fallingChicken.style.setProperty('--fall-scale', `${0.8 + Math.random() * 0.34}`);
    fallingChicken.style.setProperty('--fall-opacity', `${0.64 + Math.random() * 0.28}`);
    fallingChicken.style.setProperty('--fall-rotation', `${-26 + Math.random() * 52}deg`);
    fallingChicken.style.setProperty('--fall-mid-drift', `${midDrift}px`);
    fallingChicken.style.setProperty('--fall-end-drift', `${endDrift}px`);
    fallingChicken.style.setProperty('--fall-exit-drift', `${endDrift + (-36 + Math.random() * 72)}px`);
    fallingChicken.style.setProperty('--fall-mid-y', `${31 + Math.random() * 24}vh`);
    fallingChicken.style.setProperty('--fall-end-y', `${67 + Math.random() * 25}vh`);
    fallingChicken.style.setProperty('--fall-mid-spin', `${-90 + Math.random() * 180}deg`);
    fallingChicken.style.setProperty('--fall-end-spin', `${-180 + Math.random() * 360}deg`);
    fallingChicken.style.setProperty('--fall-exit-spin', `${120 + Math.random() * 260}deg`);
    fallingChicken.style.setProperty('--fall-delay', `${delay}s`);
    fallingChicken.style.setProperty('--fall-duration', `${duration}ms`);
    clone.removeAttribute('role');
    clone.removeAttribute('aria-label');
    clone.setAttribute('aria-hidden', 'true');
    fallingChicken.append(clone);
    fallingChicken.addEventListener('animationend', () => fallingChicken.remove(), { once: true });
    chickenRain.append(fallingChicken);
  }
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
  // Same short, shrill shape for browsers without AudioWorklet.
  const now = context.currentTime;
  const duration = getSmallCryDuration(air);
  const tailStart = now + Math.max(0, duration - Math.min(0.1, duration * 0.16));
  const output = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const partials = [
    { ratio: 1, level: 0.05 },
    { ratio: 2, level: 0.56 },
    { ratio: 3, level: 0.18 + air * 0.1 },
    { ratio: 4, level: 0.045 },
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
    osc.frequency.setValueAtTime(520 * 1.055 * ratio, now);
    osc.frequency.setValueAtTime(520 * ratio, now + Math.min(0.09, duration * 0.25));
    osc.frequency.setValueAtTime(520 * ratio, tailStart);
    osc.frequency.linearRampToValueAtTime(520 * 0.78 * ratio, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.022);
    gain.gain.setValueAtTime(level, tailStart);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(compressor);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  });

  const crack = context.createOscillator();
  const crackGain = context.createGain();
  crack.type = 'sawtooth';
  crack.frequency.setValueAtTime(760, now);
  crack.frequency.linearRampToValueAtTime(1180, now + 0.05);
  crackGain.gain.setValueAtTime(0.0001, now);
  crackGain.gain.linearRampToValueAtTime(0.06 + air * 0.05, now + 0.01);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(0.12, duration));
  crack.connect(crackGain).connect(compressor);
  crack.start(now);
  crack.stop(now + Math.min(0.14, duration + 0.02));
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
    hideHandCursor();
    const rect = chickenHit.getBoundingClientRect();
    setPressOrigin(rect.left + rect.width / 2, rect.top + rect.height / 2);
  } else {
    showHandCursor(clientX, clientY);
    setHandGrabbing(true);
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
  setHandGrabbing(false);
  if (!pointerOverChicken) hideHandCursor();
  cancelAnimationFrame(animationFrame);

  if (shouldSqueak) {
    count += 1;
    saveCount();
    squeezeCount.textContent = formatCount(count);
    lastDuration.textContent = `${elapsed.toFixed(2)} 秒`;
    interactionStatus.textContent = '尖叫！实验成功';
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

chickenHit.addEventListener('pointerenter', (event) => {
  if (event.pointerType !== 'mouse') return;
  pointerOverChicken = true;
  showHandCursor(event.clientX, event.clientY);
});

chickenHit.addEventListener('pointerleave', (event) => {
  if (event.pointerType !== 'mouse') return;
  pointerOverChicken = false;
  hideHandCursor();
});

chickenHit.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse' && pointerOverChicken) {
    showHandCursor(event.clientX, event.clientY);
  }
  if (isPressing && event.pointerId === activePointerId) setPressOrigin(event.clientX, event.clientY);
});

window.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse' && pointerOverChicken) {
    setHandPosition(event.clientX, event.clientY);
  }
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
  pointerOverChicken = false;
  hideHandCursor();
});

muteButton.addEventListener('click', () => {
  muted = !muted;
  if (muted) sendSqueezeState(0, 0);
  renderSoundIcon();
});

resetButton.addEventListener('click', resetCount);

squeezeCount.textContent = formatCount(count);
setIdleState();
window.setTimeout(startChickenRain, 120);
