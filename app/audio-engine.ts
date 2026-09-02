export type Soundtrack = "jazz" | "calm" | "energetic";

export type SfxName =
  | "move"
  | "coin"
  | "gem"
  | "hit"
  | "freeze"
  | "shield"
  | "wave"
  | "click";

type AudioContextConstructor = typeof AudioContext;

const TRACK_TEMPO: Record<Soundtrack, number> = {
  jazz: 104,
  calm: 74,
  energetic: 152,
};
const MUSIC_PITCH_MULTIPLIER = 1.1;

const clampVolume = (value: number) => Math.max(0, Math.min(1, value));
const midiFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

/**
 * A small, asset-free Web Audio engine. The context is created lazily so this
 * module is safe to import during a Next.js server render.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private selectedTrack: Soundtrack = "calm";
  private musicVolume = 0.55;
  private sfxVolume = 0.75;
  private playing = false;
  private scheduler: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  private step = 0;
  private readonly scheduledMusic = new Set<AudioScheduledSourceNode>();
  private readonly scheduledSfx = new Set<AudioScheduledSourceNode>();

  get track(): Soundtrack {
    return this.selectedTrack;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get volumes(): Readonly<{ music: number; sfx: number }> {
    return { music: this.musicVolume, sfx: this.sfxVolume };
  }

  /** Start the selected soundtrack. Call from a user gesture to unlock audio. */
  async start(track?: Soundtrack): Promise<void> {
    if (track) this.selectedTrack = track;
    const context = await this.ensureContext();
    if (!context) return;

    if (context.state === "suspended") await context.resume();
    this.playing = true;
    this.restartSequence(false);
  }

  /** Resume music after pause. It is safe to call repeatedly. */
  async resume(): Promise<void> {
    const context = await this.ensureContext();
    if (!context) return;

    if (context.state === "suspended") await context.resume();
    if (this.playing && this.scheduler) return;

    this.playing = true;
    this.nextStepTime = context.currentTime + 0.04;
    this.beginScheduler();
  }

  /** Pause the soundtrack while keeping its place in the loop. */
  pause(): void {
    this.playing = false;
    this.clearScheduler();
    this.stopSources(this.scheduledMusic);
  }

  /** Stop the soundtrack and reset it to the start of the loop. */
  stop(): void {
    this.pause();
    this.step = 0;
    this.nextStepTime = 0;
  }

  /** Switch tracks without allowing the old track's scheduled notes to leak. */
  setTrack(track: Soundtrack): void {
    if (track === this.selectedTrack) return;
    this.selectedTrack = track;
    if (this.playing) this.restartSequence(true);
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
    this.setBusVolume(this.musicBus, this.musicVolume);
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume(volume);
    this.setBusVolume(this.sfxBus, this.sfxVolume);
  }

  /** Play a short procedural sound effect. */
  async playSfx(name: SfxName): Promise<void> {
    const context = await this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume();

    const now = context.currentTime + 0.005;
    switch (name) {
      case "move":
        this.tone("sfx", 330, now, 0.07, 0.13, "square", 430);
        break;
      case "coin":
        this.tone("sfx", 880, now, 0.08, 0.2, "square", 1180);
        this.tone("sfx", 1320, now + 0.07, 0.12, 0.14, "sine");
        break;
      case "gem":
        [659, 880, 1319].forEach((frequency, index) => {
          this.tone("sfx", frequency, now + index * 0.055, 0.18, 0.15, "triangle");
        });
        break;
      case "hit":
        this.noise("sfx", now, 0.18, 0.24, 1500);
        this.tone("sfx", 150, now, 0.24, 0.24, "sawtooth", 55);
        break;
      case "freeze":
        this.noise("sfx", now, 0.32, 0.11, 5200);
        [1175, 987, 740].forEach((frequency, index) => {
          this.tone("sfx", frequency, now + index * 0.06, 0.2, 0.12, "sine", frequency * 0.82);
        });
        break;
      case "shield":
        [523, 784, 1047].forEach((frequency, index) => {
          this.tone(
            "sfx",
            frequency,
            now + index * 0.035,
            0.16,
            0.11,
            "triangle",
            frequency * 1.08,
          );
        });
        break;
      case "wave":
        [392, 523, 659, 784].forEach((frequency, index) => {
          this.tone("sfx", frequency, now + index * 0.09, 0.24, 0.15, "square");
        });
        break;
      case "click":
        this.tone("sfx", 560, now, 0.035, 0.1, "square", 430);
        break;
    }
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (typeof window === "undefined") return null;
    if (this.context && this.context.state !== "closed") return this.context;

    const legacyWindow = window as typeof window & {
      webkitAudioContext?: AudioContextConstructor;
    };
    const Context = window.AudioContext ?? legacyWindow.webkitAudioContext;
    if (!Context) return null;

    const context = new Context();
    const musicBus = context.createGain();
    const sfxBus = context.createGain();
    const limiter = context.createDynamicsCompressor();

    musicBus.gain.value = this.musicVolume;
    sfxBus.gain.value = this.sfxVolume;
    limiter.threshold.value = -12;
    limiter.knee.value = 18;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    musicBus.connect(limiter);
    sfxBus.connect(limiter);
    limiter.connect(context.destination);

    this.context = context;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.limiter = limiter;
    this.noiseBuffer = null;
    return context;
  }

  private restartSequence(keepScheduler: boolean): void {
    if (!this.context) return;
    this.stopSources(this.scheduledMusic);
    this.step = 0;
    this.nextStepTime = this.context.currentTime + 0.04;
    if (!keepScheduler) this.clearScheduler();
    this.beginScheduler();
  }

  private beginScheduler(): void {
    if (this.scheduler || !this.context || !this.playing) return;
    this.scheduleAhead();
    this.scheduler = setInterval(() => this.scheduleAhead(), 25);
  }

  private clearScheduler(): void {
    if (!this.scheduler) return;
    clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private scheduleAhead(): void {
    const context = this.context;
    if (!context || !this.playing || context.state === "closed") return;

    // Recover cleanly if a background tab made the timer fall far behind.
    if (this.nextStepTime < context.currentTime - 0.25) {
      this.nextStepTime = context.currentTime + 0.04;
    }

    const secondsPerStep = 60 / TRACK_TEMPO[this.selectedTrack] / 4;
    while (this.nextStepTime < context.currentTime + 0.18) {
      const swing =
        this.selectedTrack === "jazz" && this.step % 4 === 2
          ? secondsPerStep * 0.28
          : 0;
      this.scheduleTrackStep(this.selectedTrack, this.step, this.nextStepTime + swing);
      this.nextStepTime += secondsPerStep;
      this.step = (this.step + 1) % 32;
    }
  }

  private scheduleTrackStep(track: Soundtrack, step: number, time: number): void {
    if (track === "jazz") {
      const bass = [36, 40, 43, 45, 38, 41, 45, 47];
      const chordRoots = [60, 65, 62, 67];
      if (step % 4 === 0) {
        this.tone("music", midiFrequency(bass[step / 4]), time, 0.42, 0.12, "triangle");
        this.kick(time, 0.13);
      }
      if (step % 8 === 4) this.brush(time, 0.1);
      if (step % 8 === 2 || step % 8 === 6) {
        const root = chordRoots[Math.floor(step / 8)];
        [root, root + 4, root + 10].forEach((note) => {
          this.tone("music", midiFrequency(note), time, 0.24, 0.035, "sine");
        });
      }
      if (step % 2 === 0) this.hat(time, 0.018);
      return;
    }

    if (track === "calm") {
      const roots = [48, 45, 41, 43];
      const root = roots[Math.floor(step / 8)];
      if (step % 8 === 0) {
        [root, root + 7, root + 12].forEach((note, index) => {
          this.tone("music", midiFrequency(note), time + index * 0.035, 1.65, 0.035, "sine");
        });
      }
      if (step % 2 === 0) {
        const arpeggio = [12, 7, 14, 7];
        const note = root + arpeggio[(step / 2) % arpeggio.length];
        this.tone("music", midiFrequency(note), time, 0.5, 0.045, "triangle");
      }
      if (step % 8 === 0) this.kick(time, 0.035);
      return;
    }

    const energeticBass = [40, 40, 43, 38];
    const root = energeticBass[Math.floor(step / 8)];
    if (step % 4 === 0) this.kick(time, 0.2);
    if (step % 8 === 4) this.noise("music", time, 0.1, 0.12, 2600);
    if (step % 2 === 0) this.hat(time, step % 4 === 0 ? 0.05 : 0.025);
    if (step % 4 === 0) {
      this.tone("music", midiFrequency(root), time, 0.2, 0.12, "sawtooth");
    }
    if (step % 2 === 0) {
      const arpeggio = [12, 15, 19, 22];
      const note = root + arpeggio[(step / 2) % arpeggio.length];
      this.tone("music", midiFrequency(note), time, 0.12, 0.07, "square");
    }
  }

  private tone(
    bus: "music" | "sfx",
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    wave: OscillatorType,
    endFrequency?: number,
  ): void {
    const context = this.context;
    const destination = bus === "music" ? this.musicBus : this.sfxBus;
    if (!context || !destination) return;

    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const sourceSet = bus === "music" ? this.scheduledMusic : this.scheduledSfx;
    const pitchMultiplier = bus === "music" ? MUSIC_PITCH_MULTIPLIER : 1;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency * pitchMultiplier, start);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, endFrequency * pitchMultiplier),
        start + duration,
      );
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(destination);
    this.trackSource(sourceSet, oscillator, envelope);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.025);
  }

  private noise(
    bus: "music" | "sfx",
    start: number,
    duration: number,
    volume: number,
    cutoff: number,
  ): void {
    const context = this.context;
    const destination = bus === "music" ? this.musicBus : this.sfxBus;
    if (!context || !destination) return;

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const sourceSet = bus === "music" ? this.scheduledMusic : this.scheduledSfx;
    source.buffer = this.getNoiseBuffer(context);
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    envelope.gain.setValueAtTime(Math.max(0.0001, volume), start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(destination);
    this.trackSource(sourceSet, source, envelope, filter);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private kick(time: number, volume: number): void {
    this.tone("music", 125, time, 0.16, volume, "sine", 42);
  }

  private hat(time: number, volume: number): void {
    this.noise("music", time, 0.045, volume, 6500);
  }

  private brush(time: number, volume: number): void {
    this.noise("music", time, 0.22, volume, 3200);
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(context.sampleRate * 1.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private trackSource(
    sourceSet: Set<AudioScheduledSourceNode>,
    source: AudioScheduledSourceNode,
    ...nodes: AudioNode[]
  ): void {
    sourceSet.add(source);
    source.addEventListener(
      "ended",
      () => {
        sourceSet.delete(source);
        source.disconnect();
        nodes.forEach((node) => node.disconnect());
      },
      { once: true },
    );
  }

  private stopSources(sourceSet: Set<AudioScheduledSourceNode>): void {
    sourceSet.forEach((source) => {
      try {
        source.stop();
      } catch {
        // A source that naturally ended between scheduling and cleanup is fine.
      }
    });
    sourceSet.clear();
  }

  private setBusVolume(bus: GainNode | null, volume: number): void {
    if (!bus || !this.context) return;
    bus.gain.cancelScheduledValues(this.context.currentTime);
    bus.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }
}

export const audioEngine = new AudioEngine();
