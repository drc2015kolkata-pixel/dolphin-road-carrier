// Web Audio API sound feedback for Dolphin Road Carriers ERP
// Uses lightweight oscillator synthesis — zero external audio file network requests.

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * Crisp two-tone verification beep (C6 -> E6) played upon saving sheets, bills, and entries.
 */
export function playVerifiedBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const tones = [
      { freq: 1046.5, start: now, duration: 0.09, gain: 0.12 },
      { freq: 1318.5, start: now + 0.095, duration: 0.14, gain: 0.14 },
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, t.start);
      gain.gain.setValueAtTime(0.0001, t.start);
      gain.gain.exponentialRampToValueAtTime(t.gain, t.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t.start + t.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t.start);
      osc.stop(t.start + t.duration + 0.02);
    }
  } catch {
    // Ignore browser autoplay restrictions silently
  }
}

/**
 * Subtle amber/red alert beep when OCR detects missing Total Freight or POD Shortage/Breakage/Leakage.
 */
export function playAlertBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(520, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // Ignore browser autoplay restrictions silently
  }
}
