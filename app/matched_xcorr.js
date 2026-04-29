/*
  AEC3 と同じ方式 (NLMS で matched filter を学習) で遅延を推定する。
  matched.js (Σ|recorded[j]·played[d+j]| のブルートフォース) と比較するために作成。

  AEC3 の MatchedFilter (簡易版):
      y_hat[n] = Σ_k h[k] · played[n - k]
      e[n]     = recorded[n] - y_hat[n]
      h[k]   += μ · e[n] / ‖x_w‖² · played[n - k]

  反復学習後、h のピーク位置 k_peak が推定された遅延となる。
  matched.js は maxIndex = -565 を出力した:
      mul = recorded[j] · played[d+j]   d=-565 で和が最大
      ⇒ recorded[j] は played[j-565] と相関 (= played の 565 サンプル過去のエコー)
  本実装の慣習では h[565] にピークが立つはず。
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

// フィルタ長: 期待される遅延 |d_max| を十分カバー (matched.js の |-565| より十分大きく)
const M = 1024;
const MU = 0.5;
const EPOCHS = 10;

const h = new Float32Array(M);

// 初期 norm = Σ_{k=0..M-1} played[k]^2 (n = M-1 のときのウィンドウ)
let norm0 = 0;
for (let k = 0; k < M; k++) norm0 += played[k] * played[k];

for (let ep = 0; ep < EPOCHS; ep++) {
  let norm = norm0;
  for (let n = M - 1; n < N; n++) {
    // y_hat = Σ_k h[k] · played[n - k]
    let yhat = 0;
    for (let k = 0; k < M; k++) yhat += h[k] * played[n - k];
    const e = recorded[n] - yhat;

    // h[k] += μ · e / norm · played[n - k]
    if (norm > 1e-9) {
      const factor = MU * e / norm;
      for (let k = 0; k < M; k++) {
        h[k] += factor * played[n - k];
      }
    }

    // norm を sliding window で更新 (次の n のために)
    if (n + 1 < N) {
      const inSamp = played[n + 1];
      const outSamp = played[n + 1 - M];
      norm += inSamp * inSamp - outSamp * outSamp;
    }
  }
  // 次の epoch のために norm をリセット
}

// h のピーク位置を探す (絶対値が最大)
let maxK = 0, maxAbs = 0;
for (let k = 0; k < M; k++) {
  if (Math.abs(h[k]) > maxAbs) {
    maxAbs = Math.abs(h[k]);
    maxK = k;
  }
}

console.log("matched filter (NLMS) 学習結果:");
console.log("  フィルタ長 M =", M, ", μ =", MU, ", epochs =", EPOCHS);
console.log("  h ピーク位置 k =", maxK, ", h[k] =", h[maxK].toFixed(6));
console.log("  対応する matched.js の d = -" + maxK);
console.log("  (参考: matched.js の出力は d=-565)");

plotArrayToImage([h], 1024, 512, "plots/matched_xcorr_h.png", 1);
plotArrayToImage([played], 1024, 512, "plots/matched_xcorr_played.png", 1);
plotArrayToImage([recorded], 1024, 512, "plots/matched_xcorr_recorded.png", 1);
