/*
  Adaptive FIR Filterを周波数領域で実装（filterTestOne.jsの周波数領域版）
  
  */

const { plotArrayToImage, padNumber, loadLPCMFileSync, save_fs, 
        paddedFft, ifft, fromFftData, toFftData, fft_f, ifft_f, ifft_65_to_128,
        calcSpectrum, calcPowerSpectrum, createComplexArray, zeroPaddedFft, zeroPaddedHanningFft,
      sumOfSquares } = require('./util.js');

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
const prevXBlock = xBlocks[94];
const prevYBlock = yBlocks[94];

plotArrayToImage([prevXBlock],512,256,`plots/ftof_prevXBlock.png`,1/32768.0);
plotArrayToImage([xBlock],512,256,`plots/ftof_xBlock.png`,1/32768.0);

/*
  周波数領域Adaptive FIR Filter実装
  
  時間領域のfilterTestOne.jsを周波数領域に変換
  単一ブロック（95番）を繰り返し学習して収束特性を調査
  
  */

// 1. 周波数領域フィルタ係数の初期化（65個の複素数、ゼロ初期化）
let H = createComplexArray(65); // {re, im}の配列


// 前のブロック保存用
let prev_x = prevXBlock;
let prev_y = prevYBlock;

const X2Logs=[];
const narrowBandsCounters=new Array(65).fill(0); // 狭帯域信号検出器



// メインループ：周波数領域Adaptive FIRフィルタを学習
// 単一のブロックについて繰り返す。
for (let li = 0; li < 100; li++) {
  // 同じブロックについて計算する
  const x = xBlock;
  const y = yBlock;
  const prev_x = prevXBlock;
  //prev_x=new Float32Array(64).fill(0);
  
  // 1. 時間領域信号をFFTして周波数領域に変換
  const X = paddedFft(x, prev_x); // 常に1個前のと比較している。  

  const Xspec = calcPowerSpectrum(X);
  console.log("Xspec:",Xspec.join(","));
  plotArrayToImage([Xspec],1024,512,`plots/ftof_Xspec.png`,1/10000/10000/1000); // 1000億

  //H[0].re=H[0].im=0;
  
  // 2. 各周波数ビンkに対し、S(k)=H(k)・X(k)
  const S = createComplexArray(65); // Xから推定される信号。  
  for(let i=0;i<65;i++) {
    S[i].re += X[i].re * H[i].re - X[i].im * H[i].im;
    S[i].im += X[i].re * H[i].im + X[i].im * H[i].re;
  }    

  const Sspec=calcPowerSpectrum(S);
  console.log("Sspec:",Sspec.join(","));  
  plotArrayToImage([Sspec],1024,512,`plots/ftof_Sspec_${padNumber(li,3,0)}.png`,1/10000/10000/1000); // 1000億

  // 3. SをIFFTして sにする.  S:fftdata[128]
  const _s=ifft_65_to_128(S); // _sは128サンプルが来ている
  const s=new Float32Array(64);
  for(let i=0;i<64;i++) s[i]=_s[i+64]; // 後半の64サンプルだけを取る。
  console.log("s:",s.join(","));
  plotArrayToImage([s],1024,512,`plots/ftof_s_${padNumber(li,3,0)}.png`,1/32768.0);

  // 4. e = y - s  Sとyを比較して誤差信号を求める。
  const e=new Float32Array(64);
  for(let i=0;i<64;i++) e[i]=y[i]-s[i];

  console.log("s:",s.join(","));

  

  // 5. eをFFTしてEにする.
  //const E=zeroPaddedFft(e);
  const E=zeroPaddedHanningFft(e);

  // 6. ERL = 10 log10( Y2 / S2) を計算
  const y2=sumOfSquares(y);
  const e2=sumOfSquares(e);  
  const s2=sumOfSquares(s);
  const erl=10*Math.log10(y2/e2);
  const ratio=12000 / 16000;
  const kConvergenceThreshold=160000 * ratio; // この定数は、16KHzと12KHzでは2乗和なので調整する必要あり。
  const kConvergenceThresholdLowLevel=25600 * ratio;
  const filter_converged_strict = ( e2 < 0.05 * y2 ) && ( y2 > kConvergenceThreshold );
  const filter_converged_relaxed = ( e2 < 0.2 * y2 ) && ( y2 > kConvergenceThresholdLowLevel);
  console.log("li:",li,"CONVERGE: strict:",filter_converged_strict,"relaxed:",filter_converged_relaxed,"e2:",parseInt(e2),"y2:",y2,"s2:",parseInt(s2),"erl:",erl);

  // 7. H' = H + u ・ X* ・ E
  const E2=calcSpectrum(E);
  const X2_single=calcSpectrum(X);
  X2Logs.push(X2_single);
  const X2=new Float32Array(X.length);  
  // spectralSums相当の和を求める
  X2.fill(0);  
  for(let i=0;i<12;i++) {
    const toAdd=X2Logs[X2Logs.length-1-i];
    if(toAdd) {
      for(let k=0;k<X.length;k++) X2[k]+=toAdd[k];
    }    
  }

  // ここで noPartitionだと、狭帯域信号を検出して、ZEROGAIN処理をするが、一旦省略して、ゲインを計算する

  // gainを計算する
  // X2: f[65] , E: FftData
  const mu=new Float32Array(65);
  const noise_gate=20075344; // aec3での値
  let cnt=0;
  for(let i=0;i<65;i++) {
    if(X2[i]>noise_gate) {
      console.log("SIGNAL! li:",li,"i:",i,"X2[i]:",X2[i]);
      mu[i]= 0.9/X2[i]; // current_config_.rate
      cnt++;
    } else {
      mu[i]=0;
    }
  }

  console.log("mu:,",mu.join(","));
  const Espec=calcPowerSpectrum(E);
  console.log("Espec:,",Espec.join(","));
  
  // G = mu * E
  const G=createComplexArray(65);
  for(let i=0;i<65;i++) {
    G[i].re=mu[i]*E[i].re;
    G[i].im=mu[i]*E[i].im;
  }
  const Gspec=calcPowerSpectrum(G);
  console.log("Gspec:,",Gspec.join(","));

  // 計算したゲインを使って全部のパーティションをadaptする。
  for(let i=0;i<65;i++) {
    H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
    H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
  }
  console.log("adapt: li:",li,"H.re:",H.map(c=>c.re));


  // 8. adaptした後、1個のパーティションをconstrainする。 
  const h=ifft_f(fromFftData(H)); // 時間領域に戻す
  console.log("h (after ifft):",h); // hは f[128]  ifft_fの中で 64で割る操作が入ってるので、もういちどやる必要はない。
  for(let i=64;i<128;i++) h[i]=0; // 後ろは0にする
  console.log("H (after fill):",h.join(","));    
  let Hnext=toFftData(fft_f(h)); // HnextはHとだいぶ違った値になる。絶対値がちょっと小さくなる方向。
  let hnextmax=-999999999999,hmax=-999999999999;
  for(let i=0;i<Hnext.length;i++) {
    if(Hnext[i].re>hnextmax) hnextmax=Hnext[i].re;
    if(H[i].re>hmax) hmax=H[i].re;
  }
  console.log("li:",li,"hnextmax:",hnextmax,"hmax:",hmax,"Hnext:",Hnext,"Horig:",H);
  H=Hnext;
  console.log("constrain after fft: H.re:",H.map(c=>c.re));


  plotArrayToImage([x,s,y,e],1024,512,`plots/ftof_xsye_${padNumber(li,3,0)}.png`,1/32768.0);
  
  
}

