import { rnd } from "./state";

let AC: AudioContext | null = null;
export let muted = false;
export function setMuted(v: boolean): void { muted = v; }

function ac(): AudioContext {
  if (!AC) AC = new AudioContext();
  return AC;
}

/** ユーザー操作のタイミングで呼び出し、AudioContextの再生制限を解除する */
export function unlockAudio(): void { ac(); }

function tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.08, when = 0): void {
  if (muted) return;
  try {
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur + 0.02);
  } catch {
    // AudioContextが使えない環境では黙って無視する
  }
}

export const SND = {
  tick: (): void => tone(660, 0.05, "square", 0.05),
  dice: (): void => { for (let i = 0; i < 5; i++) tone(440 + rnd(400), 0.04, "square", 0.05, i * 0.06); },
  coin: (): void => { tone(880, 0.09, "sine", 0.1); tone(1318, 0.14, "sine", 0.1, 0.09); },
  bad: (): void => { tone(220, 0.18, "sawtooth", 0.09); tone(147, 0.3, "sawtooth", 0.09, 0.16); },
  card: (): void => { tone(523, 0.07, "triangle", 0.1); tone(784, 0.1, "triangle", 0.1, 0.07); },
  fanfare: (): void => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "triangle", 0.12, i * 0.13));
    tone(1047, 0.5, "triangle", 0.12, 0.55);
  },
  bonbi: (): void => { [196, 185, 175, 165].forEach((f, i) => tone(f, 0.3, "sawtooth", 0.1, i * 0.28)); },
  king: (): void => {
    [98, 93, 98, 87].forEach((f, i) => tone(f, 0.4, "sawtooth", 0.14, i * 0.3));
    tone(587, 0.7, "sawtooth", 0.06, 0.5);
  },
  win: (): void => { [523, 587, 659, 784, 880, 1047].forEach((f, i) => tone(f, 0.15, "triangle", 0.12, i * 0.11)); },
};
