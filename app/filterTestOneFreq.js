/*
  Adaptive FIR Filterを周波数領域で実装（filterTestOne.jsの周波数領域版）
  
  */

const { plotArrayToImage, padNumber, loadLPCMFileSync, save_fs, 
        paddedFft, ifft, fromFftData, toFftData, fft_f, ifft_f,
        calcSpectrum, calcPowerSpectrum, createComplexArray } = require('./util.js');

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
  const xBlock = new Float32Array(64);
  const yBlock = new Float32Array(64);
  for(let j = 0; j < 64; j++) {
    // 遅延補償を適用：参照信号は過去の位置から読み出し
    xBlock[j] = played12k[i * 64 + j - estimatedDelay] || 0;
    yBlock[j] = recorded12k[i * 64 + j];
  }
  xBlocks.push(xBlock);
  yBlocks.push(yBlock);
}

console.log(`データロード完了: ${blockNum}ブロック生成`);

const xBlock = xBlocks[95];
const yBlock = yBlocks[95];

/*
  周波数領域Adaptive FIR Filter実装
  
  時間領域のfilterTestOne.jsを周波数領域に変換
  単一ブロック（95番）を繰り返し学習して収束特性を調査
  
  */

// 1. 周波数領域フィルタ係数の初期化（65個の複素数、ゼロ初期化）
let H = createComplexArray(65); // {re, im}の配列

// 学習率
const mu = 0.002;

// 前のブロック保存用
let prev_x = null;

// 2. 周波数領域での推定信号計算関数
function frequencyDomainConvolve(X, H) {
  // S(k) = H(k) * X(k) (周波数領域での畳み込みは掛け算)
  const S = createComplexArray(65);
  for(let i = 0; i < 65; i++) {
    S[i].re = X[i].re * H[i].re - X[i].im * H[i].im;
    S[i].im = X[i].re * H[i].im + X[i].im * H[i].re;
  }
  return S;
}

// 3. 時間領域への変換関数
function ifftToTimeDomain(S) {
  const _s = ifft(fromFftData(S));
  const s = new Float32Array(64);
  const scale = 1.0 / 64.0;
  for(let i = 0; i < 64; i++) s[i] = _s[i].re * scale;
  return s;
}

// 4. 誤差信号計算関数（時間領域）
function calculateError(y, s) {
  const e = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) {
    e[i] = y[i] - s[i];
  }
  return e;
}

// 5. 周波数領域LMSアルゴリズムによるフィルタ係数更新（noPartition.js準拠）
function updateFilterFrequencyDomain(H, X, E, mu) {
  // X2 (パワースペクトラム) を計算
  const X2 = calcSpectrum(X);
  
  // noise_gate
  const noise_gate = 20075344; // noPartition.jsと同じ値
  
  // ゲイン計算: mu[k] = 0.9 / X2[k] (noPartition.js準拠)
  const mu_freq = new Float32Array(65);
  let cnt = 0;
  
  for(let i = 0; i < 65; i++) {
    if(X2[i] > noise_gate) {
      mu_freq[i] = 0.9 / X2[i]; // noPartition.jsと同じ
      cnt++;
    } else {
      mu_freq[i] = 0;
    }
  }
  
  // console.log(`ゲート通過ビン: ${cnt}/65`);
  
  // G = mu * E (noPartition.js準拠)
  const G = createComplexArray(65);
  for(let i = 0; i < 65; i++) {
    G[i].re = mu_freq[i] * E[i].re;
    G[i].im = mu_freq[i] * E[i].im;
  }
  
  // フィルタ更新: H(k) = H(k) + X*(k) * G(k) (noPartition.js準拠)
  for(let i = 0; i < 65; i++) {
    H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
    H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
  }
}

// 6. Constrain処理（因果性保証）
function constrainFilter(H) {
  // 周波数領域から時間領域に変換
  const h = ifft_f(fromFftData(H));
  
  // 後半部分（非因果部分）をゼロクリア
  for(let i = 65; i < 128; i++) {
    h[i] = 0;
  }
  
  // 時間領域から周波数領域に戻す
  return toFftData(fft_f(h));
}

// 7. メインループ：周波数領域Adaptive FIRフィルタを学習
console.log("周波数領域 Adaptive FIR Filter開始");

for (let i = 0; i < 100; i++) {
  // 同じブロックについて計算する
  const x = xBlock;
  const y = yBlock;
  
  // 1. 時間領域信号をFFTして周波数領域に変換
  const X = paddedFft(x, prev_x ? prev_x : x);
  prev_x = x;
  
  // 2. 周波数領域で推定信号を計算
  const S = frequencyDomainConvolve(X, H);
  
  // 3. 推定信号を時間領域に戻す
  const s = ifftToTimeDomain(S);
  
  // 4. 時間領域で誤差信号を計算
  const e = calculateError(y, s);
  
  // 5. 誤差信号を周波数領域に変換
  const E = paddedFft(e, new Float32Array(64));
  
  // 6. 周波数領域でフィルタ係数を更新
  updateFilterFrequencyDomain(H, X, E, mu);
  
  // 7. Constrain処理（因果性保証）
  H = constrainFilter(H);
  
  // 進捗表示
  const errorPower = e.reduce((sum, val) => sum + val * val, 0) / e.length;
  const signalPower = y.reduce((sum, val) => sum + val * val, 0) / y.length;
  const refPower = x.reduce((sum, val) => sum + val * val, 0) / x.length;
  
  // ERL (Echo Return Loss): 10*log10(参照信号電力/誤差電力)
  const ERL = refPower > 0 && errorPower > 0 ? 10 * Math.log10(refPower / errorPower) : 0;
  
  // ENH (Enhancement): 10*log10(受信信号電力/誤差電力) 
  const ENH = signalPower > 0 && errorPower > 0 ? 10 * Math.log10(signalPower / errorPower) : 0;
  
  console.log(`LOOP ${i}: 誤差電力=${errorPower.toFixed(1)} ERL=${ERL.toFixed(1)}dB ENH=${ENH.toFixed(1)}dB`);
  
  // 4本の線を含むグラフを画像として出力
  const filename = `plots/one_block_freq_${padNumber(i, 3, 0)}_xsye.png`;
  plotArrayToImage([x, s, y, e], 800, 400, filename, 1.0/32768.0);

  // 削減率が十分小さくなったら、その時点での係数を出力する
  if(ENH > 24) {
    console.log("Good ENH occurred.");
    
    // 周波数領域係数を時間領域に変換して表示
    const h_time = ifft_f(fromFftData(H));
    const h_display = new Float32Array(64);
    for(let j = 0; j < 64; j++) {
      h_display[j] = h_time && h_time[j] !== undefined ? h_time[j] : 0;
    }
    
    console.log("H (time domain):", h_display.join(","));
    plotArrayToImage([h_display], 800, 400, `plots/one_goodENH_H_freq.png`, 1);
    break;
  }
}

// 8. 結果出力・検証
console.log("\n=== 周波数領域フィルタ学習完了 ===");

// 最終的なフィルタ係数の統計（時間領域に変換）
const finalH_time = ifft_f(fromFftData(H));

const h_coeffs = new Float32Array(64);
if (finalH_time && finalH_time.length >= 64) {
  for(let i = 0; i < 64; i++) {
    const val = finalH_time[i];
    h_coeffs[i] = (typeof val === 'number' && !isNaN(val) && isFinite(val)) ? val : 0;
  }
} else {
  console.log("警告: ifft_f結果が不正です");
  h_coeffs.fill(0);
}

const maxCoeff = Math.max(...h_coeffs.map(Math.abs));
const avgCoeff = h_coeffs.reduce((sum, val) => sum + Math.abs(val), 0) / h_coeffs.length;
console.log(`フィルタ係数統計 (時間領域換算):`);
console.log(`  最大絶対値: ${maxCoeff.toFixed(6)}`);
console.log(`  平均絶対値: ${avgCoeff.toFixed(6)}`);

// 最終ブロックでの性能評価
const lastX = xBlock;
const lastY = yBlock;

// 最終推定信号計算
const finalX = paddedFft(lastX, lastX);
const finalS_freq = frequencyDomainConvolve(finalX, H);
const finalS = ifftToTimeDomain(finalS_freq);
const finalE = calculateError(lastY, finalS);

const finalErrorPower = finalE.reduce((sum, val) => sum + val * val, 0) / finalE.length;
const signalPower = lastY.reduce((sum, val) => sum + val * val, 0) / lastY.length;
const errorReduction = ((signalPower - finalErrorPower) / signalPower * 100);

console.log(`\n最終ブロック（95）での性能:`);
console.log(`  信号電力: ${signalPower.toFixed(3)}`);
console.log(`  誤差電力: ${finalErrorPower.toFixed(3)}`);
console.log(`  誤差削減: ${errorReduction.toFixed(1)}%`);

// 重要なフィルタ係数を表示（絶対値が大きい上位10個）
try {
  const indexedH = [];
  for (let idx = 0; idx < h_coeffs.length; idx++) {
    const val = h_coeffs[idx];
    if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
      indexedH.push({ value: val, index: idx });
    }
  }
  
  indexedH.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  console.log(`\n主要フィルタ係数（上位10個）:`);
  for (let i = 0; i < Math.min(10, indexedH.length); i++) {
    const {value, index} = indexedH[i];
    console.log(`  H[${index}] = ${value.toFixed(6)}`);
  }

  // 周波数領域係数の振幅スペクトラムも表示
  const H_power = calcPowerSpectrum(H);
  if (H_power && H_power.length > 0) {
    const indexedH_freq = [];
    for (let idx = 0; idx < H_power.length; idx++) {
      const val = H_power[idx];
      if (typeof val === 'number' && !isNaN(val) && isFinite(val)) {
        indexedH_freq.push({ value: val, index: idx });
      }
    }
    
    indexedH_freq.sort((a, b) => b.value - a.value);
    console.log(`\n周波数領域フィルタ振幅スペクトラム（上位10個）:`);
    for (let i = 0; i < Math.min(10, indexedH_freq.length); i++) {
      const {value, index} = indexedH_freq[i];
      console.log(`  |H[${index}]|² = ${value.toFixed(6)}`);
    }
  }
} catch (error) {
  console.log("結果表示中にエラーが発生しました:", error.message);
}