/*
  AECM (delay_estimator.cc) と同じ方式: FFT → バンドごとに適応閾値で 2値化 →
  各候補遅延 d に対して Hamming 距離の総和を計算し、最小 (谷) を遅延とする。

  AECM:
      BinarySpectrum: 各バンドで spectrum_q15 と threshold_spectrum (MeanEstimator
                      で適応的に更新される平均) を比較し、上回ったら 1 にする
      Hamming 距離   : popcount(near_bin XOR far_bin[n - d])

  目視 (Audacity)        : 4499/8 ≈ 562 サンプル相当 (@ 6kHz)
  matched.js  Σ|x·y|     : d = -565
  matched_xcorr NLMS h   : k =  524
  amdf.js     Σ|x-y|     : d = -555
  xcorr.js    Σ x·y      : d = -608
*/
const {
  loadWAVFileSync,
  to_f,
  fft_f,
  calcSpectrum,
  plotArrayToImage
} = require('./util.js');

const played48k = loadWAVFileSync("counting48k.wav");
const recorded48k = loadWAVFileSync("playRecCounting48k.wav");

const downSamplingFactor = 8;
const totalLen = Math.floor(played48k.length / downSamplingFactor);
const played = new Float32Array(totalLen);
for (let i = 0; i < totalLen; i++) played[i] = to_f(played48k[i * downSamplingFactor] || 0);
const recorded = new Float32Array(totalLen);
for (let i = 0; i < totalLen; i++) recorded[i] = to_f(recorded48k[i * downSamplingFactor] || 0);

// ----- フレーム化と FFT -----
const FRAME = 64;            // FFT サイズ
const STRIDE = 8;            // フレーム間隔 (= サンプル分解能)
const NUM_BANDS = 32;        // 使うバンド数 (DC を除いた 1..32)
const KBAND_FIRST = 1;       // FFT bin 1 から
const D_FRAME_MAX = 120;     // 候補フレーム遅延 (= 0..960 サンプル)

const numFrames = Math.floor((totalLen - FRAME) / STRIDE) + 1;
console.log(`totalLen=${totalLen}, numFrames=${numFrames}, STRIDE=${STRIDE} (delay分解能=${STRIDE}サンプル)`);

// 各フレームの power spectrum (32 バンド) を計算
function frameSpectra(signal) {
  const out = new Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * STRIDE;
    const buf = new Array(FRAME);
    for (let i = 0; i < FRAME; i++) buf[i] = signal[start + i];
    const X = fft_f(buf);
    const ps = calcSpectrum(X);
    const bands = new Float32Array(NUM_BANDS);
    for (let i = 0; i < NUM_BANDS; i++) bands[i] = ps[KBAND_FIRST + i];
    out[f] = bands;
  }
  return out;
}

const farSpec = frameSpectra(played);
const nearSpec = frameSpectra(recorded);

// ----- 2値化: バンドごとに MeanEstimator (1次 IIR) で平均を追跡し、上回ったら 1 -----
// AECM では shift=6 (= alpha = 1/64 相当)。ここでは同じ係数を使う。
const ALPHA = 1 / 64;

function binarize(specSeq) {
  const threshold = new Float32Array(NUM_BANDS);
  const out = new Uint32Array(numFrames);
  // 初期値は最初の数フレームの平均で適当に埋める
  const initFrames = Math.min(numFrames, 20);
  for (let f = 0; f < initFrames; f++) {
    for (let i = 0; i < NUM_BANDS; i++) threshold[i] += specSeq[f][i] / initFrames;
  }
  for (let f = 0; f < numFrames; f++) {
    let bits = 0;
    for (let i = 0; i < NUM_BANDS; i++) {
      const v = specSeq[f][i];
      if (v > threshold[i]) bits |= (1 << i);
      // MeanEstimator 更新
      threshold[i] += ALPHA * (v - threshold[i]);
    }
    out[f] = bits >>> 0;
  }
  return out;
}

const farBin = binarize(farSpec);
const nearBin = binarize(nearSpec);

// popcount
function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

// ----- 全フレーム横断で総 Hamming 距離が最小の d (フレーム単位) を探す -----
const scores = new Float32Array(D_FRAME_MAX + 1);
for (let d = 0; d <= D_FRAME_MAX; d++) {
  let sum = 0;
  let count = 0;
  for (let n = d; n < numFrames; n++) {
    sum += popcount32(nearBin[n] ^ farBin[n - d]);
    count++;
  }
  scores[d] = sum / count;  // 平均 Hamming 距離
}

let bestD = 0, bestScore = Infinity;
for (let d = 0; d <= D_FRAME_MAX; d++) {
  if (scores[d] < bestScore) { bestScore = scores[d]; bestD = d; }
}

const bestSamples = bestD * STRIDE;

console.log("Hamming 距離 (谷探し):");
console.log(`  best frame delay = ${bestD} frames (= ${bestSamples} samples @ 6kHz)`);
console.log(`  mean hamming    = ${bestScore.toFixed(3)} bits / ${NUM_BANDS}`);
console.log("");
console.log("  参考:");
console.log("    目視           Audacity ≈ 562 samples");
console.log("    matched.js     Σ|x·y|        d = -565");
console.log("    matched_xcorr  NLMS h ピーク k =  524");
console.log("    amdf.js        Σ|x-y|        d = -555");
console.log("    xcorr.js       Σ x·y         d = -608");

// プロット用に scores 配列を出す
const scoresArr = new Float32Array(scores.length);
for (let i = 0; i < scores.length; i++) scoresArr[i] = scores[i];
plotArrayToImage([scoresArr], 1024, 512, "plots/hamming_valley_output.png", 0.05);
