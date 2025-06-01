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

const xBlock=xBlocks[95];
const yBlock=yBlocks[95];


/*
  TODO:

  filterTest.jsは、入力信号を順次進めていったが
  まずbi: 95のブロックについてだけ何度もAdaptしてみる。

  85.3%以上改善しない原因が、順次異なるデータが来るせいかどうかを見極めてみる。
  
  */

// 1. フィルタ係数の初期化（64個、ゼロ初期化）
let H = new Array(64).fill(0);

// 学習率（正規化LMSで安定化）
const mu = 0.002;


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

for (let i=0;i<10000;i++) {
  // 同じブロックについて計算する
  const x = xBlock;
  const y = yBlock;
  
  // 推定信号を計算
  const s = convolve(x, H);
  
  // 誤差信号を計算
  const e = calculateError(y, s);
  
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
  
  console.log(`LOOP ${i}: 誤差電力=${errorPower.toFixed(1)} ERL=${ERL.toFixed(1)}dB ENH=${ENH.toFixed(1)}dB`);
  
  // 4本の線を含むグラフを画像として出力
  const filename = `plots/one_block_${padNumber(i, 3, 0)}_xsye.png`;
  plotArrayToImage([x, s, y, e], 800, 400, filename, 1.0/32768.0);


  // 削減率が十分小さくなったら、その時点での係数を出力する
  if(ENH>24) {
    console.log("Good ENH occured. H:", H.join(","));
    break;
  }
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
const lastX = xBlock;
const lastY = yBlock;
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

