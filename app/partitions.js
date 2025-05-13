/*
  cancelOnly.js の partitionなし版

  partitionなしでどういう動きをするかしらべる。

  X2の内容の正しさを確認した結果、X2のpartitioning、つまり12個前のX2を残しておいて、
  その結果を合計(spectralSum)した値を使う必要があることがわかった。
  
  
  */
const {
  spectrumBar,
  energyBar,  
  getVolumeBar,
  findMaxSquare,
  findMax,
  plotArrayToImage,
  save_fs,
  getMaxValue,
  decimateFloat32Array,
  createComplexArray,
  loadLPCMFileSync,
  to_f,
  save_f,
  paddedFft,
  padNumber,
  ifft,
  fft_f,
  ifft_f,
  f2cArray,
  fft_to_s,
  zeroPaddedHanningFft,
  calcSpectrum,
  fromFftData,
  toFftData,
  sumOfSquares,
  toIntArray
} = require('./util.js');

const sampleNum=48000;
const downSampleRate=4;
const downSampleNum=Math.floor(sampleNum/downSampleRate);


const played=loadLPCMFileSync("glassPlay48k.lpcm").slice(0,sampleNum);  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("glassRec48k.lpcm").slice(0,sampleNum);  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ


// 48K>12K にdownsample
const played12k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) played12k[i]=played[i*downSampleRate];
const recorded12k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) recorded12k[i]=recorded[i*downSampleRate] * -1; 

// デバッグ用に、 olayed12kに750Hzのサイン波を生成する。
//for(let i=0;i<downSampleNum;i++) {
//  const t=i/12000.0;
//  played12k[i]=Math.sin(2*Math.PI*750*t)*2000;
//}

// この状態で、 recorded12kは、 played12kに対して、959サンプル分、遅れていることが、このコードの前提条件として分かっている。
// recorded12kは、959サンプル遅れている(つまり、配列の後ろの方に信号が位置している)　が、波形はplayed12kとは異なり、
// played12kをスピーカーからいちど再生し、それをマイクから録音した音なので、波形が違っている。
// recorded12kには、近端の話者による声が含まれていないため、理想的には、recorded12kに含まれる音は、ほとんど完全に消し去られてしまうことになる。
// 実際にaec3にこのデータを処理させると、誤差信号eのエネルギーはほぼゼロになる。


const blockNum=Math.floor(downSampleNum/64); //　処理するブロック単位の数
var H=createComplexArray(65); // 65要素の複素数{re,im}の配列。パーティションなし

const estimatedDelay=959; // recordedは、playedに対してこのサンプル数分遅れている(信号の値が来るのがこの要素個数分遅れる)

let poorSignalExcitationCounter=0;
let prev_x=null;

const narrowBandsCounters=new Array(65).fill(0); // 狭帯域信号検出器
const X2Logs=[]; // ここにX2をpushしていく。[0]が最も古く[length-1]が最も新しい。

// ブロック数の回数くりかえす。 biはblock index.
for(let bi=0;bi<blockNum;bi++) {
  // マイクからの時間領域サンプルデータy。64個づつ来る。
  const y=new Float32Array(64); 
  for(let i=0;i<64;i++) y[i]=recorded12k[bi*64+i];
  // 参照信号x
  const x=new Float32Array(64);
  for(let i=0;i<64;i++) x[i]=played12k[bi*64+i-estimatedDelay]||0; // estimatedDelay個前にずれた場所を読み出すことで、yの信号と同期している。

  // この時点で、 同じ時刻のxとyがそろっているので、フィルタを実装していく。
  
  console.log("bi:",bi,"y:",y.join(","),"x:",x.join(","));


  // 1. xをFFTして Xにする
  const X=paddedFft(x,prev_x ? prev_x : x);  // 128 timedomain to 65 fftdata   X: FftData
  prev_x=x;
  
  // 2. 各周波数ビンkに対し、S(k)=H(k)・X(k)
  const S=createComplexArray(65); // Xから推定される信号。  
  for(let i=0;i<65;i++) {
    S[i].re += X[i].re * H[i].re - X[i].im * H[i].im;
    S[i].im += X[i].re * H[i].im + X[i].im * H[i].re;
  }    
  
  // 3. SをIFFTして sにする.  S:fftdata[128]
  const _s=ifft(fromFftData(S));
  const s=new Float32Array(64);
  const scale=1.0/64.0; // 128.0ではなく。 AEC3がそうなってる  
  for(let i=0;i<64;i++) s[i]=_s[i].re*scale;  

  // 4. e = y - s  Sとyを比較して誤差信号を求める。
  const e=new Float32Array(64);
  for(let i=0;i<64;i++) e[i]=y[i]-s[i];
  
  // ろぐする
  console.log("bi:",bi,"signal x:",x.join(","));
  console.log("bi:",bi,"signal s:",s.join(","));
  console.log("bi:",bi,"signal y:",y.join(","));
  console.log("bi:",bi,"signal e:",e.join(","));
  plotArrayToImage([x,s,y,e],1024,256,`plots/nopartition_${padNumber(bi,3,0)}_xsye.png`,1/32768.0);

  // 5. eをFFTしてEにする.
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
  console.log("bi:",bi,"CONVERGE: strict:",filter_converged_strict,"relaxed:",filter_converged_relaxed,"e2:",parseInt(e2),"y2:",y2,"s2:",parseInt(s2),"erl:",erl);

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
  // ここでX2の狭帯域信号をカウントする
  // 狭帯域信号の判定は、それぞれの周波数ビンが、隣の周波数ビンのパワーの3倍以上だったら狭帯域とみなし、
  // そのビンをカウントアップする。
  const channelCounters=new Array(X2_single.length).fill(0);
  for(let i=1;i<X2_single.length-1;i++) {
    if(X2_single[i]>X2_single[i+1]*3 && X2_single[i]>X2_single[i-1]*3) { // 両隣の3倍よりも大きい
      channelCounters[i-1]++;
    }
  }
  for(let i=1;i<channelCounters.length-1;i++) {
    if(channelCounters[i-1]>0) {
      narrowBandsCounters[i-1]++;
    } else {
      narrowBandsCounters[i-1]=0;
    }
  }
  // 狭帯域信号の検出器の値のどれかが10以上かどうかを判定する
  let narrowBandSignal=false;
  for(let i=1;i<narrowBandsCounters.length-1;i++) {
    if(narrowBandsCounters[i-1]>10) {
      narrowBandSignal=true;
      break;
    }
  }
  poorSignalExcitationCounter++;
  if(narrowBandSignal) {
    poorSignalExcitationCounter=0;
  }
  const zeroGain = (poorSignalExcitationCounter<12);

  //
  const ccstrs=[];
  for(let i=0;i<channelCounters.length;i++) ccstrs.push(channelCounters[i]>0 ? "*" : ".");
  console.log("bi:",bi,"channelCounters:    ",ccstrs.join(" "));
  console.log("bi:",bi,"narrowBandsCounters:",narrowBandsCounters.join(","),"NB:",narrowBandSignal,"zeroGain:",zeroGain);
  
  console.log("X2: bi:",bi,"X2:",X2.join(","));
  plotArrayToImage([X2],1024,512,`plots/nopartition_x2_${bi}.png`,1/32768/32768/10);  


  if(zeroGain) {
    // ゲインがない。つまり、Hを更新しない
    console.log("bi:",bi,"zeroGain:",zeroGain,"H.re:",H.map(c=>c.re));
  } else {
    // gainを計算する
    // X2: f[65] , E: FftData
    const mu=new Float32Array(65);
    const noise_gate=20075344; // aec3での値
    let cnt=0;
    for(let i=0;i<65;i++) {
      if(X2[i]>noise_gate) {
        console.log("SIGNAL! bi:",bi,"i:",i,"X2[i]:",X2[i]);
        mu[i]= 0.9/X2[i]; // current_config_.rate
        cnt++;
      } else {
        mu[i]=0;
      }
    }

    // G = mu * E
    const G=createComplexArray(65);
    for(let i=0;i<65;i++) {
      G[i].re=mu[i]*E[i].re;
      G[i].im=mu[i]*E[i].im;
    }

    // 計算したゲインを使って全部のパーティションをadaptする。
    for(let i=0;i<65;i++) {
      H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
      H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
    }
    console.log("adapt: bi:",bi,"H.re:",H.map(c=>c.re));
  
  
    // 8. adaptした後、1個のパーティションをconstrainする。 
    const h=ifft_f(fromFftData(H)); // 時間領域に戻す
    console.log("h (after ifft):",h); // hは f[128]  ifft_fの中で 64で割る操作が入ってるので、もういちどやる必要はない。
    for(let i=65;i<128;i++) h[i]=0; // 後ろは0にする
    console.log("H (after fill):",h.join(","));    
    Hnext=toFftData(fft_f(h)); // HnextはHとだいぶ違った値になる。絶対値がちょっと小さくなる方向。
    let hnextmax=-999999999999,hmax=-999999999999;
    for(let i=0;i<Hnext.length;i++) {
      if(Hnext[i].re>hnextmax) hnextmax=Hnext[i].re;
      if(H[i].re>hmax) hmax=H[i].re;
    }
    console.log("bi:",bi,"hnextmax:",hnextmax,"hmax:",hmax,"Hnext:",Hnext,"Horig:",H);
    H=Hnext;
    console.log("constrain after fft: H.re:",H.map(c=>c.re));
  }

  {
    // デバッグ用
    const h=ifft_f(fromFftData(H)); // 時間領域に戻す
    plotArrayToImage([h],768,512,`plots/h_${padNumber(bi,3,0)}.png`,1);
  }

  
 
}


process.exit(0);

