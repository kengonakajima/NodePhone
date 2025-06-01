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
  
  

// 1. フィルタ係数の初期化（64個、ゼロ初期化）
let H = [
 0.5256555582602495,0.05575896749433738,0.15579858542322886,-0.19780282707399638,0.03463212878790943,0.050035413368147756,-0.08490015272701636,0.030277247199539524,-0.0015414763653535412,-0.0849244291437314,0.0033529153693575443,0.09808050287646708,0.06590624956639175,-0.0723437444942659,-0.09099477655810045,0.0798352035230626,0.08007025078082222,-0.02359722970491714,-0.0025854529510062263,-0.040367629797807836,-0.05104020246163092,0.07015780613217341,0.06828433239970379,0.036640420992783626,-0.030138977841963302,-0.08562852711742806,0.05873645545970489,0.13341550765185048,0.044620358093844126,-0.059877517073471456,-0.038657514649927956,0.096217077737302,0.08114116903202043,0.016979670617197837,-0.017285832817398383,0.03547779796934373,0.02465139914204973,0.0020155765889114346,0.08649020514010146,0.03292038473985261,-0.06812599673096441,-0.0761798386681416,0.0608633077428016,0.10155739352537582,-0.041927260939171825,-0.10833960433748738,-0.027408441995624006,0.05554582113768961,-0.004114002967556238,-0.05287508003248222,-0.004549871322871314,-0.053552107663573774,-0.0773586378132223,0.008543664771148311,0.039731096969514254,-0.04579910054423814,-0.12711672896270573,-0.02292533426430228,0.07358424988570877,-0.021722651583305965,-0.08321455680885129,-0.039626007394514204,-0.023957987940995077,0.004798563729987596
];

if(H.length!=64) process.exit(1);

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


// 5. メインループ：各ブロックでAdaptive FIRフィルタを学習
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
