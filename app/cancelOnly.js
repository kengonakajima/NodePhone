/*
  Adaptive FIR Filterを用いてエコー信号をキャンセルするJavaScriptサンプルコード。

  このサンプルコードの目的は、正しくエコー信号を削除できるAdaptive FIR Filterのpure JSコードを実装することである。
  そのため、すでに実装済みのライブラリを利用せず、すべてのアルゴリズムを直接ここに実装する。

  Adaptive FIR Filterは、libwebrtcのAEC3に実装されているものと同等のアルゴリズムを実装する。
  AEC3は12個のパーティションに分かれていて、1ブロック(64サンプルづつ)進むごとに、1つづつパーティションをずらしながら
  フィルタ係数Hを更新する。12個目を更新し終わったら1個目に戻る。
  フィルタ係数は周波数領域のデータであり、65要素の複素数の配列である。これをFftDataと呼ぶ。

  テストに使う音源は、playedとrecordedであり、それぞれ48KHzのデータである。
  playedが、実際に再生した参照信号。ファイルから読み込んだデータは48KHzだが、それを12Khzにダウンサンプルして利用する。
  recordedは、マイクから録音した、回り込み音を含む信号。これが、 959サンプル分遅れていることがあらかじめわかっている。
  フィルタの実装においては、この48KHzのデータを12Khzにダウンサンプリングしたデータを用いる。
  データ形式は LPCM16で、値は -32768から32767までの値をとる。
  
  コードでは、以下の変数名を用いる。

  遠端信号(参照信号,played由来のデータ)をx、その周波数領域(FftData)表現をX, そのスペクトルをXs, エネルギー(二乗和)をx2　とする。
  近端信号(録音信号, recorded由来のデータ)をy, その周波数領域表現をY、そのスペクトルをYs　エネルギーをy2　とする。
  フィルタ係数(周波数領域)をH　とする。
  遠端信号からフィルタを用いて推定した推定信号をs, その周波数領域表現をS,スペクトルをSs,　エネルギーをs2　とする。
  推定信号sとyの誤差を　誤差信号e, その周波数領域表現をE, スペクトルをEs, エネルギーはe2。


  フィルタの処理内容は以下の通りだが、以下の説明は、漏れていたり、誤っている可能性もあるため、
  各ステップにおいて正しさを確認しながら実装したい。

  1. xをFFTして Xにする
  2. 各周波数ビンkに対し、S(k)=H(k)・X(k)
  3. SをIFFTして sにする
  4. e = y - s
  5. eをFFTしてEにする.
  6. ERL = 10 log10( Y2 / S2) を計算し、キャンセル性能を評価する。この値が20以上になると、かなり完璧に消せている。実装成功の指標はこれ。
  7. Hを周波数領域NLMSで更新。 新しいHを H'とし、 uは各周波数ビンごとに入力エネルギーX2で正規化されたステップサイズ。 X*はXの複素共役。
     H' = H + u ・ X* ・ E
     パーティションが12個あるため、パーティションごとにこの更新をしていく。全体を一気に更新はしない。
  8. constrain処理。 更新された周波数領域のフィルタ係数HHをIFFTして時間領域に戻し、インパルス応答の後半部分（エイリアスや長すぎる遅延成分が発生する部分）をゼロにリセットし、その後再度FFTを行って周波数領域に戻すという処理を行っています。これにより、フィルタの効果的な長さを一定に保ち、循環畳み込みによる不要なエイリアスの影響を防ぐ。

  FFTする処理は、たとえば、xをFFTする場合、 paddedFft(x,前回のx) あるいは  zeroPaddedHanningFft(x) といったJS関数が使える。
  
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

const sampleNum=30000;
const downSampleRate=4;
const downSampleNum=Math.floor(sampleNum/4);
const filterSize=2048;



const played=loadLPCMFileSync("glassPlay48k.lpcm").slice(0,sampleNum);  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("glassRec48k.lpcm").slice(0,sampleNum);  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ


// 48K>12K にdownsample
const played12k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) played12k[i]=played[i*downSampleRate];
const recorded12k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) recorded12k[i]=recorded[i*downSampleRate] * -1; 


// この状態で、 recorded12kは、 played12kに対して、959サンプル分、遅れていることが、このコードの前提条件として分かっている。
// recorded12kは、959サンプル遅れている(つまり、配列の後ろの方に信号が位置している)　が、波形はplayed12kとは異なり、
// played12kをスピーカーからいちど再生し、それをマイクから録音した音なので、波形が違っている。
// recorded12kには、近端の話者による声が含まれていないため、理想的には、recorded12kに含まれる音は、ほとんど完全に消し去られてしまうことになる。
// 実際にaec3にこのデータを処理させると、誤差信号eのエネルギーはほぼゼロになる。


const blockNum=Math.floor(downSampleNum/64); //　処理するブロック単位の数
const H=[]; //  12個のフィルタデータを格納する。 パーティションが12個あるので。
for(let i=0;i<12;i++) H[i]=createComplexArray(65); // 65要素の複素数{re,im}の配列が12個。

const estimatedDelay=959; // recordedは、playedに対してこのサンプル数分遅れている(信号の値が来るのがこの要素個数分遅れる)

let prev_x=null;
const Xhist=[]; // Xの履歴。Xを1個づつpushしていくだけ

let currentPartition=0;
const numPartition=12; // aec3は12または13.とりあえず12とする

// デバッグ用の表示
const impulseFactors=[];
for(let i=0;i<12;i++) impulseFactors[i]=new Float32Array(64); // デバッグのために、インパルス応答(時間領域)を保存しておく


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
  Xhist.push(X);  
  prev_x=x;
  
  // 2. 各周波数ビンkに対し、S(k)=H(k)・X(k)
  const S=createComplexArray(65); // Xから推定される信号。  
  for(let pi=0;pi<numPartition;pi++) { // 全部のパーティションの和を推定信号とする。
    let Xp=Xhist[Xhist.length-pi]; // 最新のXから順番に信号を遡る。
    if(!Xp) Xp=createComplexArray(65);
    for(let i=0;i<65;i++) {
      S[i].re += Xp[i].re * H[pi][i].re - Xp[i].im * H[pi][i].im;
      S[i].im += Xp[i].re * H[pi][i].im + Xp[i].im * H[pi][i].re;
    }    
  }
  
  // 3. SをIFFTして sにする.  S:fftdata[128]
  const _s=ifft(fromFftData(S));
  const s=new Float32Array(64);
  const scale=1.0/64.0; // 128.0ではなく。 AEC3がそうなってる  
  for(let i=0;i<64;i++) s[i]=_s[i].re*scale;  

  // 4. e = y - s  Sとyを比較して誤差信号を求める。
  const e=new Float32Array(64);
  for(let i=0;i<64;i++) e[i]=y[i]-s[i];
  
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
  console.log("bi:",bi,"CONVERGE: strict:",filter_converged_strict,"relaxed:",filter_converged_relaxed,"e2:",parseInt(e2),"y2:",y2,"s2:",parseInt(s2),"erl:",erl,"currentPartition:",currentPartition);

  // 7. H' = H + u ・ X* ・ E
  const E2=calcSpectrum(E);
  const X2=calcSpectrum(X);
  
  // gainを計算する
  // X2: f[65] , E: FftData
  const mu=new Float32Array(65);
  const noise_gate=20075344; // aec3での値
  let cnt=0;
  for(let i=0;i<65;i++) {
    if(X2[i]>noise_gate) {
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
  for(let pi=0;pi<numPartition;pi++) {
    let Xp=Xhist[Xhist.length-1-pi]; // 最新のXから順番に信号を遡る。
    if(!Xp) Xp=createComplexArray(65);
    for(let i=0;i<65;i++) {
      H[currentPartition][i].re += Xp[i].re * G[i].re + Xp[i].im * G[i].im;
      H[currentPartition][i].im += Xp[i].re * G[i].im - Xp[i].im * G[i].re;
    }
  }
  console.log("adapt: H[",currentPartition,"].re:",bi,H[currentPartition].map(c=>c.re),"H:",H);

  // 8. adaptした後、1個のパーティションをconstrainする。 
  const h=ifft_f(fromFftData(H[currentPartition])); // 時間領域に戻す
  console.log("h (after ifft):",h); // hは f[128]  ifft_fの中で 64で割る操作が入ってるので、もういちどやる必要はない。
  for(let i=65;i<128;i++) h[i]=0; // 後ろは0にする
  console.log("H[currentPartition] (after fill):",h.join(","));    
  H[currentPartition]=toFftData(fft_f(h));

  console.log("origMF constrain after fft: H[currentPartition].re:",H[currentPartition].map(c=>c.re));


  // 以下デバッグ用
  // 全部のパーティションを1個の配列に入れて可視化する。可視化するのはHではなくhの方。
  impulseFactors[currentPartition]=h;
  const toDump=new Float32Array(64*12);
  for(let i=0;i<numPartition;i++) {
    for(let j=0;j<64;j++) toDump[i*64+j]=impulseFactors[i][j];
  }
  plotArrayToImage([toDump],768,512,`plots/impulseDump_${padNumber(bi,3,0)}.png`,10);

  
  // パーティションを次に進める
  currentPartition++;
  if(currentPartition==numPartition) currentPartition=0;  
}


process.exit(0);

