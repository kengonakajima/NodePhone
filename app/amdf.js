/*
  AMDF (Average Magnitude Difference Function) で遅延を推定する。
  matched.js (Σ|recorded[j]·played[d+j]|)、 matched_xcorr.js (NLMS) と
  比較するために 同じ wav ペア / 同じダウンサンプル / 同じ N で動かす。

  AMDF:
      score(d) = Σ_j | recorded[j] − played[d+j] |
      最も小さい d (= 谷) が遅延

  matched.js は d=-565 を出した。AMDF も同じくらい当てるか?
*/
const {
  loadWAVFileSync,
  to_f,
  plotArrayToImage
} = require('./util.js');

const played48k = loadWAVFileSync("counting48k.wav");
const recorded48k = loadWAVFileSync("playRecCounting48k.wav");

const downSamplingFactor = 8;
const N = 4096;

const played = new Float32Array(N);
for (let i = 0; i < N; i++) played[i] = to_f(played48k[i * downSamplingFactor] || 0);
const recorded = new Float32Array(N);
for (let i = 0; i < N; i++) recorded[i] = to_f(recorded48k[i * downSamplingFactor] || 0);

const output = new Float32Array(N * 2);

let minIndex = null;
let minSum = Infinity;

for (let d = -N; d < N; d++) {
  let sum = 0;
  for (let j = 0; j < N; j++) {
    sum += Math.abs(recorded[j] - (played[d+j] || 0));
  }
  output[N+d] = sum;
  if (sum < minSum) {
    minIndex = d;
    minSum = sum;
  }
}

console.log("AMDF (引き算族, 谷探し):");
console.log("  minIndex =", minIndex, ", minSum =", minSum.toFixed(4));
console.log("  (参考: matched.js Σ|x·y|     d=-565, matched_xcorr.js NLMS h ピーク k=524)");
console.log("  (目視 4499/8 ≈ 562 サンプル相当)");

plotArrayToImage([output], 1024, 512, "plots/amdf_output.png", 0.01);
plotArrayToImage([played], 1024, 512, "plots/amdf_played.png", 1);
plotArrayToImage([recorded], 1024, 512, "plots/amdf_recorded.png", 1);
