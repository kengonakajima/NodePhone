/*
  単純な (符号付き) 相互相関で遅延を推定する。
  matched.js (Σ|x·y|, 絶対値) との対比のため、こちらは ABS を取らない。

  xcorr:
      score(d) = Σ_j  recorded[j] · played[d+j]      (符号付き)
      |score(d)| が最大の d が遅延 (符号は位相反転を許す)

  matched.js (Σ|x·y|): d=-565
  matched_xcorr.js (NLMS, AEC3 方式): k=524 (= d=-524 相当)
  目視 (Audacity): 4499/8 ≈ 562 サンプル相当
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

let bestIndex = null;
let bestAbs = 0;
let bestSigned = 0;

for (let d = -N; d < N; d++) {
  let sum = 0;
  for (let j = 0; j < N; j++) {
    sum += recorded[j] * (played[d+j] || 0);
  }
  output[N+d] = sum;   // 符号付きをそのまま記録
  const abs = Math.abs(sum);
  if (abs > bestAbs) {
    bestIndex = d;
    bestAbs = abs;
    bestSigned = sum;
  }
}

console.log("単純相互相関 (掛け算族, 山探し):");
console.log("  bestIndex (|sum| 最大) =", bestIndex);
console.log("  signed sum =", bestSigned.toFixed(4));
console.log("  (signed sum が負なら 位相反転が起きている)");
console.log("");
console.log("  参考:");
console.log("    matched.js     Σ|x·y|  d=-565");
console.log("    matched_xcorr  NLMS h  k=524");
console.log("    AMDF           Σ|x-y|  (amdf.js を実行して比較)");
console.log("    目視           Audacity ≈ 562");

plotArrayToImage([output], 1024, 512, "plots/xcorr_output.png", 0.01);
plotArrayToImage([played], 1024, 512, "plots/xcorr_played.png", 1);
plotArrayToImage([recorded], 1024, 512, "plots/xcorr_recorded.png", 1);
