/*
  Adaptive FIR Filterだけをテストする
  
  */

const { plotArrayToImage, padNumber, loadLPCMFileSync, save_fs } = require('./util.js');

// データロードとダウンサンプリング
const sampleNum = 48000;
const downSampleRate = 4; // 48KHz → 12KHz
const downSampleNum = Math.floor(sampleNum / downSampleRate);

const played = loadLPCMFileSync("counting48k.lpcm").slice(0, sampleNum);
const recorded = loadLPCMFileSync("playRecCounting48k.lpcm16").slice(0, sampleNum);

// 48K→12Kにダウンサンプル
const played12k = new Float32Array(downSampleNum);
for(let i = 0; i < downSampleNum; i++) played12k[i] = played[i * downSampleRate];
const recorded12k = new Float32Array(downSampleNum);
for(let i = 0; i < downSampleNum; i++) recorded12k[i] = recorded[i * downSampleRate] * -1; // macosの事情

// 遅延補償（partitions.jsと同様）
const estimatedDelay = 1216; // counting48k recordedは、playedに対してこのサンプル数分遅れている

// 64サンプルごとに区切ってブロック化
const blockNum = Math.floor(downSampleNum / 64);
const xBlocks = [];
const yBlocks = [];

for(let i = 0; i < blockNum; i++) {
  const xBlock = new Array(64);
  const yBlock = new Array(64);
  for(let j = 0; j < 64; j++) {
    // 遅延補償を適用：参照信号は過去の位置から読み出し
    xBlock[j] = played12k[i * 64 + j - estimatedDelay] || 0;
    yBlock[j] = recorded12k[i * 64 + j];
  }
  xBlocks.push(xBlock);
  yBlocks.push(yBlock);
}

console.log(`データロード完了: ${blockNum}ブロック生成`);

/*
  TODO:
  
  時間領域信号を用いた Adaptive FIR Filterを実装する。
  xBlocksが参照信号xで、64サンプルの音声信号である。
  yBlocksが対応する録音信号yである。
  このフィルタは、エコーキャンセルのために使うフィルタである。
  yにはxを再生したときの回り込み音が含まれている。
  それをできるだけ除去するのが目的である。

  フィルタは以下のように動作する。
  まずxに対してフィルタを適用して推定信号sを得る。
  yとsの差が誤差信号eである。
  eが最小になるようなフィルタ係数をLMSで学習して更新し続ける。

  フィルタ係数は64個とする。

  クラスなどを追加せずに、フィルタ係数Hと素朴な関数だけで実装する。
  
  ## 実装計画

  ### 目的
  エコーキャンセル用のAdaptive FIR Filter（64タップ）をLMSアルゴリズムで実装

  ### データ構造
  - xBlocks: 参照信号（再生音）- 24ブロック×64サンプル
  - yBlocks: 録音信号（回り込み音含む）- 24ブロック×64サンプル
  - フィルタ係数: H[64] - 64個の係数

  ### アルゴリズム流れ
  1. 推定信号計算: s = x * H (畳み込み)
  2. 誤差信号計算: e = y - s
  3. 係数更新: H = H + μ * e * x (LMS)

  ### 実装順序
  
  【高優先度】
  1. フィルタ係数H（64個）の初期化
  2. 畳み込み関数の実装
  3. LMSアルゴリズムによる係数更新

  【中優先度】
  4. 誤差信号計算
  5. メインループ（24ブロック処理）

  【低優先度】
  6. 結果出力・検証機能

  ### 技術的考慮点
  - 学習率μ: 収束性と安定性のバランス
  - 初期値: ゼロ初期化が一般的
  - 数値安定性: オーバーフロー対策
  - メモリ効率: 64サンプル単位の処理
  
  */

// 1. フィルタ係数の初期化（64個、ゼロ初期化）
let H = new Array(64).fill(0);

// 学習率（正規化LMSで安定化）
const mu = 0.001;

// 全ブロックの誤差信号を保存する配列
const allErrorSignals = [];
// 全ブロックの録音信号を保存する配列
const allRecordedSignals = [];

// 2. 畳み込み関数（x信号にフィルタHを適用して推定信号sを生成）
function convolve(x, H) {
  const s = new Array(x.length).fill(0);
  for (let n = 0; n < x.length; n++) {
    for (let k = 0; k < H.length && k <= n; k++) {
      s[n] += H[k] * x[n - k];
    }
  }
  return s;
}

// 3. 誤差信号計算関数（y - s）
function calculateError(y, s) {
  const e = new Array(y.length).fill(0);
  for (let i = 0; i < y.length; i++) {
    e[i] = y[i] - s[i];
  }
  return e;
}

// 4. LMSアルゴリズムによるフィルタ係数更新（正規化版）
function updateFilter(H, x, e, mu) {
  // 入力信号の電力を計算
  const xPower = x.reduce((sum, val) => sum + val * val, 0) / x.length;
  const normalizedMu = xPower > 0 ? mu / xPower : mu;
  
  for (let k = 0; k < H.length; k++) {
    for (let n = k; n < x.length; n++) {
      H[k] += normalizedMu * e[n] * x[n - k];
    }
  }
}

// 5. メインループ：各ブロックでAdaptive FIRフィルタを学習
console.log("Adaptive FIR Filter開始");
console.log(`ブロック数: ${xBlocks.length}, フィルタ係数: ${H.length}, 学習率: ${mu}`);

for (let blockIndex = 0; blockIndex < xBlocks.length; blockIndex++) {
  const x = xBlocks[blockIndex];
  const y = yBlocks[blockIndex];
  
  // 推定信号を計算
  const s = convolve(x, H);
  
  // 誤差信号を計算
  const e = calculateError(y, s);
  
  // 誤差信号と録音信号を全体配列に追加
  allErrorSignals.push(...e);
  allRecordedSignals.push(...y);
  
  // フィルタ係数を更新
  updateFilter(H, x, e, mu);
  
  // 進捗表示（1ブロックごと）
  const errorPower = e.reduce((sum, val) => sum + val * val, 0) / e.length;
  const signalPower = y.reduce((sum, val) => sum + val * val, 0) / y.length;
  const refPower = x.reduce((sum, val) => sum + val * val, 0) / x.length;
  
  // ERL (Echo Return Loss): 10*log10(参照信号電力/誤差電力)
  const ERL = refPower > 0 && errorPower > 0 ? 10 * Math.log10(refPower / errorPower) : 0;
  
  // ENH (Enhancement): 10*log10(受信信号電力/誤差電力) 
  const ENH = signalPower > 0 && errorPower > 0 ? 10 * Math.log10(signalPower / errorPower) : 0;
  
  console.log(`ブロック ${blockIndex}: 誤差電力=${errorPower.toFixed(1)} ERL=${ERL.toFixed(1)}dB ENH=${ENH.toFixed(1)}dB`);
  
  // 4本の線を含むグラフを画像として出力
  const filename = `plots/block_${padNumber(blockIndex, 3, 0)}_xsye.png`;
  plotArrayToImage([x, s, y, e], 800, 400, filename, 1.0/32768.0);
}

// 6. 結果出力・検証
console.log("\n=== フィルタ学習完了 ===");

// 最終的なフィルタ係数の統計
const maxCoeff = Math.max(...H.map(Math.abs));
const avgCoeff = H.reduce((sum, val) => sum + Math.abs(val), 0) / H.length;
console.log(`フィルタ係数統計:`);
console.log(`  最大絶対値: ${maxCoeff.toFixed(6)}`);
console.log(`  平均絶対値: ${avgCoeff.toFixed(6)}`);

// 最終ブロックでの性能評価
const lastX = xBlocks[xBlocks.length - 1];
const lastY = yBlocks[yBlocks.length - 1];
const finalS = convolve(lastX, H);
const finalE = calculateError(lastY, finalS);
const finalErrorPower = finalE.reduce((sum, val) => sum + val * val, 0) / finalE.length;
const signalPower = lastY.reduce((sum, val) => sum + val * val, 0) / lastY.length;
const errorReduction = ((signalPower - finalErrorPower) / signalPower * 100);

console.log(`\n最終ブロック（103）での性能:`);
console.log(`  信号電力: ${signalPower.toFixed(3)}`);
console.log(`  誤差電力: ${finalErrorPower.toFixed(3)}`);
console.log(`  誤差削減: ${errorReduction.toFixed(1)}%`);

// 重要なフィルタ係数を表示（絶対値が大きい上位10個）
const indexedH = H.map((val, idx) => ({value: val, index: idx}));
indexedH.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
console.log(`\n主要フィルタ係数（上位10個）:`);
for (let i = 0; i < Math.min(10, indexedH.length); i++) {
  const {value, index} = indexedH[i];
  console.log(`  H[${index}] = ${value.toFixed(6)}`);
}

// 7. 全誤差信号をLPCM16として保存
console.log(`\n誤差信号保存:`);
console.log(`  総サンプル数: ${allErrorSignals.length}`);
console.log(`  ファイル名: filterTest_error_signals.lpcm16`);
save_fs(new Float32Array(allErrorSignals), "filterTest_error_signals.lpcm16");
console.log(`  保存完了`);

// 8. 全録音信号をLPCM16として保存
console.log(`\n録音信号保存:`);
console.log(`  総サンプル数: ${allRecordedSignals.length}`);
console.log(`  ファイル名: filterTest_recorded_signals.lpcm16`);
save_fs(new Float32Array(allRecordedSignals), "filterTest_recorded_signals.lpcm16");
console.log(`  保存完了`);
