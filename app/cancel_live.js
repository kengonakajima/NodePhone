/*
  NodePhone cancel_live sample (AEC demonstration)

  Usage:
    node cancel_live.js

  Plays counting48k.wav as the far-end signal, captures the microphone in real time,
  removes the acoustic echo via AEC3, and writes the cleaned result to processed.wav.
*/

const fs = require('fs');
const {
  PortAudio,
  aec3Wrapper,
  getVolumeBar,
  getMaxValue,
} = require('./util.js');

const FAR_END_WAV = 'counting48k.wav';
const OUTPUT_WAV = 'processed.wav';

let g_freq = 48000;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    if (arg.includes('freq=32')) g_freq = 32000;
    else if (arg.includes('freq=48')) g_freq = 48000;
  }
}

const farEndData = loadWavMono16(FAR_END_WAV);
if (farEndData.sampleRate !== g_freq) {
  console.log('counting48k.wav sample rate (' + farEndData.sampleRate + ' Hz) is used for playback and capture.');
  g_freq = farEndData.sampleRate;
}

if (fs.existsSync(OUTPUT_WAV)) fs.unlinkSync(OUTPUT_WAV);

aec3Wrapper.setFrequency(g_freq);

PortAudio.initSampleBuffers(g_freq, g_freq, 512);
PortAudio.startMic();
PortAudio.startSpeaker();

const g_recSamples = [];
const g_refSamples = [];
const g_processedFrames = [];
let g_processedSampleCount = 0;

const farSamples = farEndData.samples;
let farSampleIndex = 0;

let g_recMaxSample = 0;
let g_playMaxSample = 0;

console.log('Press Ctrl+C to stop and write ' + OUTPUT_WAV + '.');

setInterval(() => {
  const samples = PortAudio.getRecordedSamples();
  if (samples.length <= 0) return;
  PortAudio.discardRecordedSamples(samples.length);

  for (const sample of samples) {
    if (sample > g_recMaxSample) g_recMaxSample = sample;
    g_recSamples.push(sample);
  }
}, 25);

setInterval(() => {
  if (!aec3Wrapper.initialized) return;
  if (farSamples.length === 0) return;
  if (g_refSamples.length > aec3Wrapper.samples_per_frame * 50) return;

  const playFrame = new Int16Array(aec3Wrapper.samples_per_frame);
  for (let i = 0; i < playFrame.length; i++) {
    playFrame[i] = farSamples[farSampleIndex];
    farSampleIndex++;
    if (farSampleIndex >= farSamples.length) farSampleIndex = 0;
  }

  for (let i = 0; i < playFrame.length; i++) g_refSamples.push(playFrame[i]);

  PortAudio.pushSamplesForPlay(playFrame);

  const framePeak = getMaxValue(playFrame);
  if (framePeak > g_playMaxSample) g_playMaxSample = framePeak;
}, 10);

setInterval(() => {
  if (!aec3Wrapper.initialized) return;
  if (g_recSamples.length < aec3Wrapper.samples_per_frame) return;

  let frameNum = Math.floor(g_recSamples.length / aec3Wrapper.samples_per_frame);
  if (frameNum > 10) frameNum = 10;

  for (let f = 0; f < frameNum; f++) {
    const rec = new Int16Array(aec3Wrapper.samples_per_frame);
    for (let i = 0; i < rec.length; i++) rec[i] = g_recSamples.shift();
    aec3Wrapper.update_rec_frame(rec);

    const ref = new Int16Array(aec3Wrapper.samples_per_frame);
    for (let i = 0; i < ref.length; i++) {
      if (g_refSamples.length > 0) ref[i] = g_refSamples.shift();
      else ref[i] = 0;
    }
    aec3Wrapper.update_ref_frame(ref);

    const processed = new Int16Array(aec3Wrapper.samples_per_frame);
    aec3Wrapper.process(80, processed, 1);

    const stored = new Int16Array(processed.length);
    stored.set(processed);
    g_processedFrames.push(stored);
    g_processedSampleCount += stored.length;
  }
}, 25);

setInterval(() => {
  const enh = aec3Wrapper.initialized ? aec3Wrapper.get_metrics_echo_return_loss_enhancement() : 0;
  const voice = aec3Wrapper.initialized ? aec3Wrapper.get_voice_probability() : 0;

  const lines = [
    'Recorded vol: ' + getVolumeBar(g_recMaxSample),
    'Playing vol:  ' + getVolumeBar(g_playMaxSample),
    'Rec queued:   ' + g_recSamples.length,
    'Ref queued:   ' + g_refSamples.length,
    'Processed frames: ' + g_processedFrames.length,
    'ERLE x1000:   ' + Math.floor(enh * 1000),
    'Voice:        ' + voice,
  ];

  process.stdout.write('\x1Bc');
  console.log(lines.join('\n'));

  g_recMaxSample = 0;
  g_playMaxSample = 0;
}, 250);

let g_saved = false;
function flushProcessed() {
  if (g_saved) return;
  g_saved = true;
  if (g_processedSampleCount <= 0) {
    console.log('No processed samples were collected.');
    return;
  }
  const merged = new Int16Array(g_processedSampleCount);
  let offset = 0;
  for (const frame of g_processedFrames) {
    merged.set(frame, offset);
    offset += frame.length;
  }
  writeWavMono16(OUTPUT_WAV, merged, g_freq);
  console.log('Saved processed output to ' + OUTPUT_WAV + ' (' + g_processedSampleCount + ' samples).');
}

process.once('SIGINT', () => {
  flushProcessed();
  process.exit(0);
});
process.once('SIGTERM', () => {
  flushProcessed();
  process.exit(0);
});
process.once('exit', () => {
  flushProcessed();
});

function loadWavMono16(path) {
  const data = fs.readFileSync(path);
  if (data.toString('ascii', 0, 4) !== 'RIFF') {
    console.log('Unsupported WAV header.');
    process.exit(1);
  }
  if (data.toString('ascii', 8, 12) !== 'WAVE') {
    console.log('Unsupported WAV format.');
    process.exit(1);
  }
  const audioFormat = data.readUInt16LE(20);
  const numChannels = data.readUInt16LE(22);
  const sampleRate = data.readUInt32LE(24);
  const bitsPerSample = data.readUInt16LE(34);

  if (audioFormat !== 1 || numChannels !== 1 || bitsPerSample !== 16) {
    console.log('counting48k.wav must be PCM, mono, 16-bit.');
    process.exit(1);
  }

  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= data.length) {
    const chunkId = data.toString('ascii', offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) {
    console.log('WAV data chunk not found.');
    process.exit(1);
  }

  const pcmSlice = data.slice(dataOffset, dataOffset + dataLength);
  const samples = new Int16Array(pcmSlice.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcmSlice.readInt16LE(i * 2);
  }
  return { sampleRate, samples };
}

function writeWavMono16(path, samples, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const samplesBuffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  samplesBuffer.copy(buffer, 44);

  fs.writeFileSync(path, buffer);
}
