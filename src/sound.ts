// Placeholder sounds, synthesised in code. Each name can later be
// swapped for a real recording without changing the game.
let audio: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

// Browsers only allow sound after the player has clicked or tapped
export function startAudio() {
  if (!audio) {
    audio = new AudioContext()
    master = audio.createGain()
    master.gain.value = 0.4
    master.connect(audio.destination)

    noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
    const samples = noiseBuffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
  }
  if (audio.state === 'suspended') audio.resume()
}

function tone(
  frequency: number,
  length: number,
  shape: OscillatorType,
  volume: number,
  delay = 0,
  slideTo = frequency
) {
  if (!audio || !master) return
  const start = audio.currentTime + delay

  const oscillator = audio.createOscillator()
  oscillator.type = shape
  oscillator.frequency.setValueAtTime(frequency, start)
  oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + length)

  const gain = audio.createGain()
  gain.gain.setValueAtTime(volume, start)
  gain.gain.exponentialRampToValueAtTime(0.001, start + length)

  oscillator.connect(gain)
  gain.connect(master)
  oscillator.start(start)
  oscillator.stop(start + length)
}

function noise(
  length: number,
  filterFrequency: number,
  volume: number,
  delay = 0,
  attack = 0
) {
  if (!audio || !master || !noiseBuffer) return
  const start = audio.currentTime + delay

  const source = audio.createBufferSource()
  source.buffer = noiseBuffer
  source.loop = true

  const filter = audio.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = filterFrequency

  const gain = audio.createGain()
  if (attack > 0) {
    gain.gain.setValueAtTime(0.001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + attack)
  } else {
    gain.gain.setValueAtTime(volume, start)
  }
  gain.gain.exponentialRampToValueAtTime(0.001, start + length)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(master)
  source.start(start)
  source.stop(start + length)
}

function crash(pitch: number) {
  noise(0.5, 2500 * pitch, 0.7)
  noise(0.25, 5000 * pitch, 0.4, 0.04)
  tone(900 * pitch, 0.15, 'triangle', 0.3, 0.02, 500 * pitch)
}

function fanfare(notes: number[], gap: number) {
  notes.forEach((note, i) => tone(note, gap * 1.4, 'square', 0.18, i * gap))
}

const SOUNDS = {
  click: (volume: number) => tone(1600, 0.03, 'square', 0.25 * volume),
  thwack: () => {
    noise(0.1, 1200, 0.8)
    tone(220, 0.1, 'triangle', 0.5, 0, 90)
  },
  crash: () => crash(1),
  highCrash: () => crash(2),
  clonk: () => {
    tone(180, 0.18, 'triangle', 0.6, 0, 120)
    tone(420, 0.08, 'square', 0.15)
  },
  honk: () => tone(330, 0.3, 'sawtooth', 0.35, 0, 260),
  squelch: () => {
    tone(700, 0.2, 'sine', 0.5, 0, 90)
    noise(0.12, 500, 0.4)
  },
  fanfare: () => fanfare([392, 392, 392, 523, 392, 523, 659], 0.11),
  winFanfare: () => fanfare([523, 523, 523, 659, 523, 659, 784, 1047], 0.13),
  cheer: () => {
    noise(2.5, 1100, 0.5, 0.1, 0.5)
    noise(2, 1900, 0.3, 0.3, 0.4)
  },
}

export type SoundName = keyof typeof SOUNDS

const lastPlayed = new Map<SoundName, number>()

export function play(name: SoundName, volume = 1) {
  if (!audio) return

  // Stops a pile-up of hits from turning into a buzz
  const now = audio.currentTime
  if (now - (lastPlayed.get(name) ?? -1) < 0.05) return
  lastPlayed.set(name, now)

  SOUNDS[name](volume)
}
