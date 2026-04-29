/*
  5 方式の遅延推定の「揺れなさ」を測る。
  同じ wav ペアを 短い窓 (W) で sliding しながら走らせて、
  各方式の per-window 推定値を集め、散らばり (std, IQR, range) を出す。

  - AMDF       : Σ|x − y|, 谷
  - matched    : Σ|x·y|,    山 (envelope, matched.js と同じ)
  - xcorr      : Σ x·y,     |·| 最大 (符号付き)
  - NLMS       : streaming で h を学習し、各窓位置で h ピークをスナップショット
  - hamming    : AECM 方式。FFT→バンドごとに適応閾値で 2値化→Hamming 距離の谷

  目視 (Audacity): 4499 サンプル @ 48kHz ≒ 562 サンプル @ 6kHz
  どれが目視に近い & どれがブレないか?
*/
const {
  loadWAVFileSync,
  to_f,
  fft_f,
  calcSpectrum
} = require('./util.js');

const played48k = loadWAVFileSync("counting48k.wav");
const recorded48k = loadWAVFileSync("playRecCounting48k.wav");

const downSamplingFactor = 8;
const totalLen = Math.floor(played48k.length / downSamplingFactor);
const played = new Float32Array(totalLen);
for (let i = 0; i < totalLen; i++) played[i] = to_f(played48k[i * downSamplingFactor] || 0);
const recorded = new Float32Array(totalLen);
for (let i = 0; i < totalLen; i++) recorded[i] = to_f(recorded48k[i * downSamplingFactor] || 0);

const W = 1024;        // 窓長 (約 170 ms @ 6kHz)
const STRIDE = 256;
const D_MAX = 800;     // 探索範囲 [-800, +800), 期待値 565 を含む

// エネルギー閾値: グローバル RMS の 0.5 倍以上の窓だけ採用 (silent は捨てる)
let recSqSum = 0;
for (let i = 0; i < totalLen; i++) recSqSum += recorded[i] * recorded[i];
const overallRms = Math.sqrt(recSqSum / totalLen);
const ENERGY_THRESHOLD = overallRms * 0.5;

console.log(`totalLen=${totalLen} samples (${(totalLen/6000).toFixed(2)} s @ 6kHz)`);
console.log(`overallRms=${overallRms.toFixed(4)}, threshold=${ENERGY_THRESHOLD.toFixed(4)}`);
console.log(`W=${W}, STRIDE=${STRIDE}, D_MAX=${D_MAX}\n`);

// === per-window: AMDF, matched, xcorr ===
const positions = [];
const amdfRes = [];
const matchedRes = [];
const xcorrRes = [];

for (let t = D_MAX; t + W + D_MAX < totalLen; t += STRIDE) {
  let rms2 = 0;
  for (let j = 0; j < W; j++) rms2 += recorded[t+j] * recorded[t+j];
  if (Math.sqrt(rms2/W) < ENERGY_THRESHOLD) continue;
  positions.push(t);

  // AMDF
  let bD_a = 0, bS_a = Infinity;
  for (let d = -D_MAX; d < D_MAX; d++) {
    let s = 0;
    for (let j = 0; j < W; j++) s += Math.abs(recorded[t+j] - played[t+d+j]);
    if (s < bS_a) { bS_a = s; bD_a = d; }
  }
  amdfRes.push(bD_a);

  // matched (Σ|x·y|)
  let bD_m = 0, bS_m = -Infinity;
  for (let d = -D_MAX; d < D_MAX; d++) {
    let s = 0;
    for (let j = 0; j < W; j++) s += Math.abs(recorded[t+j] * played[t+d+j]);
    if (s > bS_m) { bS_m = s; bD_m = d; }
  }
  matchedRes.push(bD_m);

  // xcorr (signed Σx·y, |·| 最大)
  let bD_x = 0, bA_x = 0;
  for (let d = -D_MAX; d < D_MAX; d++) {
    let s = 0;
    for (let j = 0; j < W; j++) s += recorded[t+j] * played[t+d+j];
    if (Math.abs(s) > bA_x) { bA_x = Math.abs(s); bD_x = d; }
  }
  xcorrRes.push(bD_x);
}

// === hamming: フレーム単位の 2値スペクトルを事前計算 ===
const FRAME = 64;
const FSTRIDE = 8;            // フレーム間隔 (= 遅延分解能 サンプル)
const NUM_BANDS = 32;
const KBAND_FIRST = 1;
const numFrames = Math.floor((totalLen - FRAME) / FSTRIDE) + 1;
const ALPHA = 1 / 64;

function frameBinSeq(signal) {
  const threshold = new Float32Array(NUM_BANDS);
  const out = new Uint32Array(numFrames);
  // 初期 threshold を最初の 20 フレームの平均で埋める
  const initFrames = Math.min(numFrames, 20);
  const initBuf = new Array(NUM_BANDS).fill(0);
  for (let f = 0; f < initFrames; f++) {
    const start = f * FSTRIDE;
    const buf = new Array(FRAME);
    for (let i = 0; i < FRAME; i++) buf[i] = signal[start + i];
    const ps = calcSpectrum(fft_f(buf));
    for (let i = 0; i < NUM_BANDS; i++) initBuf[i] += ps[KBAND_FIRST + i] / initFrames;
  }
  for (let i = 0; i < NUM_BANDS; i++) threshold[i] = initBuf[i];
  for (let f = 0; f < numFrames; f++) {
    const start = f * FSTRIDE;
    const buf = new Array(FRAME);
    for (let i = 0; i < FRAME; i++) buf[i] = signal[start + i];
    const ps = calcSpectrum(fft_f(buf));
    let bits = 0;
    for (let i = 0; i < NUM_BANDS; i++) {
      const v = ps[KBAND_FIRST + i];
      if (v > threshold[i]) bits |= (1 << i);
      threshold[i] += ALPHA * (v - threshold[i]);
    }
    out[f] = bits >>> 0;
  }
  return out;
}

console.log("computing binary spectra...");
const farBin = frameBinSeq(played);
const nearBin = frameBinSeq(recorded);

function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// per-window hamming valley search
const D_FMAX = Math.floor(D_MAX / FSTRIDE);   // フレーム遅延範囲
const hammingRes = positions.map(t => {
  const fStart = Math.max(0, Math.ceil(t / FSTRIDE));
  const fEnd = Math.min(numFrames, Math.floor((t + W - FRAME) / FSTRIDE));
  let bestD = 0, bestSum = Infinity;
  for (let df = -D_FMAX; df <= D_FMAX; df++) {
    let sum = 0, cnt = 0;
    for (let n = fStart; n < fEnd; n++) {
      const m = n - df;
      if (m < 0 || m >= numFrames) continue;
      sum += popcount32(nearBin[n] ^ farBin[m]);
      cnt++;
    }
    if (cnt === 0) continue;
    const avg = sum / cnt;
    if (avg < bestSum) { bestSum = avg; bestD = df; }
  }
  // 符号: near[n] が far[n - df] と一致 → df>0 = near 遅れ。
  // 他方式の d (matched.js は d=-565) と揃えるため、 d = -df*FSTRIDE で格納。
  // 表示時 -d → 正の遅延 (565) になる。
  return -bestD * FSTRIDE;
});

// === NLMS streaming with snapshots ===
const M_NLMS = 1024;
const MU = 0.5;
const h = new Float32Array(M_NLMS);
let norm = 0;
for (let k = 0; k < M_NLMS; k++) norm += played[k] * played[k];

// 「窓 t..t+W-1 が確定するタイミング」= n == t+W-1 で h スナップショット
const snapshotN = positions.map(t => t + W - 1);
let nextSnapIdx = 0;
const nlmsRes = new Array(positions.length).fill(null);

for (let n = M_NLMS - 1; n < totalLen; n++) {
  let yhat = 0;
  for (let k = 0; k < M_NLMS; k++) yhat += h[k] * played[n - k];
  const e = recorded[n] - yhat;
  if (norm > 1e-9) {
    const factor = MU * e / norm;
    for (let k = 0; k < M_NLMS; k++) h[k] += factor * played[n - k];
  }
  if (n + 1 < totalLen) {
    norm += played[n+1]*played[n+1] - played[n+1-M_NLMS]*played[n+1-M_NLMS];
  }
  while (nextSnapIdx < snapshotN.length && n === snapshotN[nextSnapIdx]) {
    let maxK = 0, maxAbs = 0;
    for (let k = 0; k < M_NLMS; k++) {
      if (Math.abs(h[k]) > maxAbs) { maxAbs = Math.abs(h[k]); maxK = k; }
    }
    nlmsRes[nextSnapIdx] = -maxK;   // 慣習 d = -k
    nextSnapIdx++;
  }
}

// === summarize ===
function summarize(name, arr) {
  const valid = arr.filter(v => v !== null);
  if (valid.length === 0) { console.log(`  ${name}: no data`); return; }
  const sorted = [...valid].sort((a,b) => a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const q1 = sorted[Math.floor(sorted.length/4)];
  const q3 = sorted[Math.floor(3*sorted.length/4)];
  const mean = valid.reduce((a,b) => a+b, 0) / valid.length;
  const v = valid.reduce((a,b) => a+(b-mean)*(b-mean), 0) / valid.length;
  const std = Math.sqrt(v);
  const min = sorted[0], max = sorted[sorted.length-1];
  console.log(`  ${name.padEnd(18)}  median=${String(median).padStart(5)}  mean=${mean.toFixed(1).padStart(6)}  std=${std.toFixed(1).padStart(5)}  IQR=[${q1},${q3}]  range=[${min},${max}]`);
}

console.log(`採用された窓: ${positions.length} 個\n`);
console.log(`目視 (Audacity): ≈ 562 (= 4499 / 8)\n`);
console.log(`揺れの統計 (per-window 推定値):\n`);
summarize('AMDF      Σ|x-y|', amdfRes.map(d => -d));    // d=-565 → 表示は 565
summarize('matched   Σ|x·y|', matchedRes.map(d => -d));
summarize('xcorr     Σ x·y ', xcorrRes.map(d => -d));
summarize('NLMS h-peak     ', nlmsRes.map(d => d === null ? null : -d));
summarize('hamming valley  ', hammingRes.map(d => -d));

console.log(`\nper-window 推定 (推定遅延 = -d を表示):`);
console.log(`  t (6kHz)    AMDF  matched  xcorr   NLMS  hamming`);
for (let i = 0; i < positions.length; i++) {
  const t = positions[i];
  const a = -amdfRes[i];
  const m = -matchedRes[i];
  const x = -xcorrRes[i];
  const n = nlmsRes[i] === null ? "—" : -nlmsRes[i];
  const h = -hammingRes[i];
  console.log(`  ${String(t).padStart(6)}     ${String(a).padStart(4)}    ${String(m).padStart(4)}    ${String(x).padStart(4)}   ${String(n).padStart(4)}    ${String(h).padStart(4)}`);
}
