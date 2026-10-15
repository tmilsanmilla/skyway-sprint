import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AudioEngine, MUSIC_TEMPO_MULTIPLIER } from './audio-engine.ts';

const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} });
class FakeNode {
  gain=param(); frequency=param(); threshold=param(); knee=param(); ratio=param(); attack=param(); release=param();
  connect() {} disconnect() {} addEventListener() {} start(...args) { this.started=args; } stop() { this.stopped=true; }
}
class FakeBuffer {
  constructor(channels, length, rate) { this.duration=length/rate; this.channels=Array.from({length:channels},()=>new Float32Array(length)); }
  getChannelData(n) { return this.channels[n]; }
  copyToChannel(data,n) { this.channels[n].set(data); }
}
class FakeContext {
  static instances=[];
  currentTime=0; sampleRate=8000; state='running'; destination=new FakeNode(); sources=[];
  constructor() { FakeContext.instances.push(this); }
  createGain() { return new FakeNode(); } createDynamicsCompressor() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); } createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { const n=new FakeNode(); this.sources.push(n); return n; }
  createBuffer(...args) { return new FakeBuffer(...args); }
  async resume() { this.state='running'; }
}
class FakeOffline extends FakeContext {
  static renders=0; static pending=null;
  constructor(channels,length,rate) { super(); this.channels=channels;this.length=length;this.sampleRate=rate; }
  async startRendering() {
    FakeOffline.renders++;
    if(FakeOffline.pending) await FakeOffline.pending;
    return this.createBuffer(this.channels,this.length,this.sampleRate);
  }
}

test('music uses an audio-clocked cached loop, preserves pause position, and cancels late renders',async()=>{
  const oldWindow=globalThis.window, oldOffline=globalThis.OfflineAudioContext;
  globalThis.window={AudioContext:FakeContext};globalThis.OfflineAudioContext=FakeOffline;
  try {
    assert.equal(MUSIC_TEMPO_MULTIPLIER,1.3*.9);
    const engine=new AudioEngine();await engine.start('calm');
    const context=FakeContext.instances[0];const first=context.sources.at(-1);
    assert.equal(first.loop,true);assert.ok(first.buffer.duration>1);assert.deepEqual(first.started,[0,0]);
    context.currentTime=2;engine.pause();assert.equal(first.stopped,true);assert.equal(engine.isPlaying,false);
    await engine.resume();const resumed=context.sources.at(-1);
    assert.deepEqual(resumed.started,[2,2]);assert.equal(FakeOffline.renders,1,'resume reuses the rendered track');
    engine.stop();await engine.start();assert.deepEqual(context.sources.at(-1).started,[2,0]);
    engine.stop();
    let release;FakeOffline.pending=new Promise(resolve=>{release=resolve;});
    const second=new AudioEngine();const starting=second.start('jazz');await Promise.resolve();await Promise.resolve();
    second.pause();release();await starting;assert.equal(second.isPlaying,false);
    const live=FakeContext.instances.find(c=>!(c instanceof FakeOffline)&&c!==context);
    assert.equal(live.sources.length,0,'a render completed after pause cannot start music');
    const source=readFileSync(new URL('./audio-engine.ts',import.meta.url),'utf8');
    assert.doesNotMatch(source,/setInterval\(|setTimeout\(/,'background timer throttling cannot change beat scheduling');
  } finally {
    if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;
    if(oldOffline===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=oldOffline;
    FakeOffline.pending=null;
  }
});
