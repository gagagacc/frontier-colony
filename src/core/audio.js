/**
 * 程序化音频：不依赖任何音频素材文件，全部用 WebAudio 合成。
 * 好处是零下载、零版权问题、随时可调；后续接入真实音效时替换 play() 即可。
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.volume = 0.55;
    this.musicVolume = 0.32;
    this.muted = false;
    this._musicTimer = null;
    this._musicStep = 0;
    this._lastPlay = new Map();
  }

  /** 必须由用户手势触发 */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // ---------- 基础发声元件 ----------

  _tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.3, attack = 0.005, slideTo = null, delay = 0, dest = null }) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(dest || this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.15, vol = 0.25, filter = 1200, q = 1, type = 'lowpass', delay = 0, sweepTo = null }) {
    if (!this.ctx) return;
    const t0 = this.t + delay;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(filter, t0); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  /** 限流：同名音效在极短时间内不重复堆叠 */
  _throttle(name, ms = 45) {
    const now = performance.now();
    const last = this._lastPlay.get(name) || 0;
    if (now - last < ms) return false;
    this._lastPlay.set(name, now);
    return true;
  }

  // ---------- 游戏音效 ----------

  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const v = opts.volume ?? 1;
    switch (name) {
      case 'shoot':
        if (!this._throttle('shoot', 55)) return;
        this._tone({ freq: 620, slideTo: 180, dur: 0.09, type: 'square', vol: 0.11 * v });
        this._noise({ dur: 0.07, vol: 0.09 * v, filter: 2600, sweepTo: 600 });
        break;
      case 'shootHeavy':
        if (!this._throttle('shootHeavy', 90)) return;
        this._tone({ freq: 260, slideTo: 70, dur: 0.19, type: 'sawtooth', vol: 0.17 * v });
        this._noise({ dur: 0.16, vol: 0.15 * v, filter: 1500, sweepTo: 240 });
        break;
      case 'melee':
        if (!this._throttle('melee', 70)) return;
        this._noise({ dur: 0.11, vol: 0.16 * v, filter: 3200, type: 'bandpass', q: 1.1, sweepTo: 900 });
        break;
      case 'hit':
        if (!this._throttle('hit', 40)) return;
        this._tone({ freq: 210, slideTo: 90, dur: 0.07, type: 'triangle', vol: 0.13 * v });
        break;
      case 'hurt':
        if (!this._throttle('hurt', 110)) return;
        this._tone({ freq: 200, slideTo: 62, dur: 0.24, type: 'sawtooth', vol: 0.2 * v });
        break;
      case 'kill':
        if (!this._throttle('kill', 60)) return;
        this._noise({ dur: 0.2, vol: 0.14 * v, filter: 900, sweepTo: 120 });
        this._tone({ freq: 150, slideTo: 48, dur: 0.19, type: 'square', vol: 0.1 * v });
        break;
      case 'explode':
        this._noise({ dur: 0.5, vol: 0.34 * v, filter: 700, sweepTo: 60 });
        this._tone({ freq: 92, slideTo: 34, dur: 0.42, type: 'sine', vol: 0.26 * v });
        break;
      case 'build':
        this._tone({ freq: 320, slideTo: 640, dur: 0.13, type: 'square', vol: 0.14 * v });
        this._tone({ freq: 480, slideTo: 900, dur: 0.15, type: 'triangle', vol: 0.1 * v, delay: 0.07 });
        break;
      case 'pickup':
        if (!this._throttle('pickup', 35)) return;
        this._tone({ freq: 880, slideTo: 1320, dur: 0.07, type: 'triangle', vol: 0.09 * v });
        break;
      case 'coin':
        if (!this._throttle('coin', 40)) return;
        this._tone({ freq: 1180, dur: 0.05, type: 'square', vol: 0.07 * v });
        this._tone({ freq: 1560, dur: 0.06, type: 'square', vol: 0.06 * v, delay: 0.035 });
        break;
      case 'levelup':
        [0, 0.09, 0.18, 0.3].forEach((d, i) => {
          this._tone({ freq: [523, 659, 784, 1046][i], dur: 0.28, type: 'triangle', vol: 0.15 * v, delay: d });
        });
        break;
      case 'unlock':
        [0, 0.1].forEach((d, i) => this._tone({ freq: [660, 990][i], dur: 0.3, type: 'sine', vol: 0.14 * v, delay: d }));
        break;
      case 'alarm':
        this._tone({ freq: 440, slideTo: 300, dur: 0.5, type: 'sawtooth', vol: 0.2 * v });
        this._tone({ freq: 330, slideTo: 220, dur: 0.55, type: 'sawtooth', vol: 0.18 * v, delay: 0.42 });
        break;
      case 'waveKlaxon':
        for (let i = 0; i < 3; i++) {
          this._tone({ freq: 300, slideTo: 520, dur: 0.34, type: 'sawtooth', vol: 0.17 * v, delay: i * 0.42 });
        }
        break;
      case 'uiClick':
        this._tone({ freq: 1400, dur: 0.03, type: 'square', vol: 0.05 * v });
        break;
      case 'uiOpen':
        this._tone({ freq: 420, slideTo: 700, dur: 0.1, type: 'triangle', vol: 0.08 * v });
        break;
      case 'uiClose':
        this._tone({ freq: 640, slideTo: 340, dur: 0.1, type: 'triangle', vol: 0.07 * v });
        break;
      case 'error':
        this._tone({ freq: 160, dur: 0.16, type: 'square', vol: 0.13 * v });
        break;
      case 'dodge':
        this._noise({ dur: 0.2, vol: 0.1 * v, filter: 800, sweepTo: 2600, type: 'bandpass', q: 0.7 });
        break;
      case 'engine':
        this._tone({ freq: 68, dur: 0.3, type: 'sawtooth', vol: 0.07 * v });
        break;
      case 'nestBreak':
        this._noise({ dur: 0.85, vol: 0.34 * v, filter: 1100, sweepTo: 90 });
        this._tone({ freq: 130, slideTo: 30, dur: 0.8, type: 'sine', vol: 0.24 * v });
        break;
      case 'baseAlarm':
        this._tone({ freq: 720, slideTo: 460, dur: 0.7, type: 'square', vol: 0.19 * v });
        break;
      default:
        break;
    }
  }

  // ---------- 环境音乐 ----------
  /** 极简太空氛围：缓慢的和弦垫音 + 偶发脉冲 */
  startMusic(mood = 'calm') {
    if (!this.ctx || this._musicTimer) return;
    this._musicStep = 0;
    const scales = {
      calm: [110, 146.83, 164.81, 220, 261.63],
      tense: [98, 116.54, 146.83, 174.61, 196],
      dark: [82.41, 98, 123.47, 146.83, 164.81],
    };
    const tick = () => {
      const notes = scales[mood] || scales.calm;
      const base = notes[this._musicStep % notes.length];
      const dur = mood === 'calm' ? 6.5 : 4.2;
      this._pad(base, dur, mood === 'dark' ? 0.05 : 0.038);
      if (this._musicStep % 4 === 2) this._pad(base * 1.5, dur * 0.8, 0.024);
      this._musicStep++;
    };
    tick();
    this._musicTimer = setInterval(tick, mood === 'calm' ? 6200 : 4000);
    this._mood = mood;
  }

  setMood(mood) {
    if (this._mood === mood) return;
    this.stopMusic();
    this._musicStep = 0;
    this.startMusic(mood);
  }

  _pad(freq, dur, vol) {
    if (!this.ctx) return;
    const t0 = this.t;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    osc2.type = 'triangle'; osc2.frequency.value = freq * 1.004;
    f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.6;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(f); osc2.connect(f); f.connect(g); g.connect(this.musicGain);
    osc.start(t0); osc2.start(t0);
    osc.stop(t0 + dur + 0.1); osc2.stop(t0 + dur + 0.1);
  }

  stopMusic() {
    if (this._musicTimer) { clearInterval(this._musicTimer); this._musicTimer = null; }
  }
}
