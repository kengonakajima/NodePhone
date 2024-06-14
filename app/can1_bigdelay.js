/*

  can1_classでチャンクサイズよりも大幅に大きな遅延を発生させて、
  coarseとrefinedを併用して大きな遅延を推定させるテスト
  
  */

const {
  loadLPCMFileSync,
  firFilter,
  firFilterFFT,
  to_f_array,
  to_s_array,
  calcAveragePower,
  findMax,
  findMaxComplex,  
  save_f,
  fft_f,
  ifft_f,  
  plotArrayToImage,
  createComplexArray,
  spectrumBar,
  calcAveragePowerComplex,
  calcPowerSpectrum,
  padNumber,
  applyHannWindow
}=require("./util.js");




function createEchoCanceler(N) {
  const filter={
    N,
    H: createComplexArray(N),
    H_error: new Float32Array(N),
  };
  for(let i=0;i<N;i++) filter.H_error[i]=10000; // AEC3から。適当な値で初期化する
  filter.process = function(ref,rec) {
    const st=new Date().getTime();
    const x=applyHannWindow(ref);
    const y=applyHannWindow(rec);
    
    const X=fft_f(x);
    const Y=fft_f(y);

    // FIRフィルタ
    const S = X.map((x, i) => {
      const re = x.re * filter.H[i].re - x.im * filter.H[i].im;
      const im = x.re * filter.H[i].im + x.im * filter.H[i].re;
      return { re, im };
    });

    const s = ifft_f(S); // FIRフィルタの出力信号の時間領域表現
    const e = new Float32Array(N); // 残差信号

    for(let i=0;i<N;i++) e[i]=y[i]-s[i];

    const eHann=applyHannWindow(e);
    const E = fft_f(eHann); // E: eの周波数領域表現

    const Xs = calcPowerSpectrum(X); // Xs: Xのパワースペクトラム
    const Es = calcPowerSpectrum(E); // Es: Eのパワースペクトラム

    //     mu = H_error / (0.5* H_error* X2 + n * E2).
    const mu = new Float32Array(N);
    for(let i=0;i<N;i++) mu[i]=filter.H_error[i] / (0.5 * filter.H_error[i] * Xs[i] + 1 * Es[i]);

    //     H_error = H_error - 0.5 * mu * X2 * H_error.
    for(let i=0;i<N;i++) filter.H_error[i]-=(0.5 * mu[i] * Xs[i] * filter.H_error[i]);

    // G = mu * E
    const G = new Array(N);

    for(let i=0;i<N;i++) {
      G[i]={
        re: mu[i] * E[i].re,
        im: mu[i] * E[i].im
      };
    }

    // H(t+1)=H(t)+G(t)*conj(X(t)).
    //      H_p_ch.re[k] += X_p_ch.re[k] * G.re[k] + X_p_ch.im[k] * G.im[k];
    //      H_p_ch.im[k] += X_p_ch.re[k] * G.im[k] - X_p_ch.im[k] * G.re[k];
    for(let i=0;i<N;i++) {
      filter.H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
      filter.H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
    }

    const Hs=ifft_f(filter.H);    
    const m=findMax(Hs);

    
    // ここでsが予測値、eが誤差。両方とも、長さはNなので、出力するのは真ん中の使える部分だけにする必要がある。
    // このフィルタは前後の部分をのぞいた中央部分の2/N個を出力とする。
    const estimated=new Float32Array(N/2);
    const canceled=new Float32Array(N/2);
    const startInd=N/4;
    const copyNum=N/2;  
    for(let i=0;i<copyNum;i++) {
      estimated[i]=s[i+startInd];
      canceled[i]=e[i+startInd];
    }

    const recPower=calcAveragePower(rec);
    const refPower=calcAveragePower(ref);  
    const canceledPower=calcAveragePower(canceled);
    const estimatedPower=calcAveragePower(estimated);  
    const erle= 10 * Math.log10(recPower / canceledPower);
    const et=new Date().getTime();
    return {canceled, estimated, detectedDelay: m, erle,canceledPower, recPower,estimatedPower,refPower,Hs,x,y, dt:et-st };
  }
  return filter;
}


// counting24k.lpcmは　音がほとんどない領域がけっこうあり、そうした無音領域の後に大きな音がきたときに発散する。
// piano24k.lpcmはすきまがあまりない。
// refのエネルギーが小さいときに係数を更新しないようにしたら、見事におさまった。
// 問題は、収束が遅いこと。50ループで30msしても、errPowerが0.001ぐらいある。 0.0001ぐらいにしたい。
const chunk=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ
//const chunk=loadLPCMFileSync("long_a.lpcm");  // 元のデータ。これが再生用データ

const chunkSize=256; // チャンクサイズ
const fftSize=1024; // FFTの窓のサイズ
const delay=4011; // このサンプル数だけ遅れて録音される。
const rec=to_f_array(new Int16Array(chunk.buffer));
const coarseRatio=16; // coarseフィルタの倍率
const coarseInputLen=parseInt(chunk.length/coarseRatio);
const coarseRec=new Float32Array(coarseInputLen);
for(let i=0;i<coarseInputLen;i++) coarseRec[i]=rec[i*coarseRatio]; // 粗なフィルタ用の録音データ
const coarseRef=new Float32Array(coarseInputLen);
for(let i=0;i<coarseInputLen;i++) coarseRef[i]=rec[i*coarseRatio-delay]||0; // 人工的な遅れを追加

const refinedRec=new Float32Array(chunk.length);
for(let i=0;i<chunk.length;i++) refinedRec[i]=rec[i]; 
const refinedRef=new Float32Array(chunk.length);
for(let i=0;i<chunk.length;i++) refinedRef[i]=rec[i-delay]||0; // 人工的な遅れを追加

let coarseDetectedDelay=0;

const coarseEC=createEchoCanceler(fftSize);


// coarseRecをchunkSizeで刻む
const coarseChunkNum=Math.ceil(coarseRec.length/chunkSize);

for(let l=0;l<coarseChunkNum;l++) {  
  // 窓が1024なので、実効は512で前後に256個づつある。
  // [256][512][256]
  // startIndexはこの一番先頭のところを示している。
  const startIndex=l*chunkSize;
  const coarseRecChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) coarseRecChunk[i]=coarseRec[startIndex+i]||0;
  const coarseRefChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) coarseRefChunk[i]=coarseRef[startIndex+i]||0;
  
  const ecOut=coarseEC.process(coarseRefChunk,coarseRecChunk);

  plotArrayToImage([coarseRecChunk],1024,512,`plots/big_coarse_${l}_rec_chunk.png`,1);
  plotArrayToImage([coarseRefChunk],1024,512,`plots/big_coarse_${l}_ref_chunk.png`,1);    
  plotArrayToImage([ecOut.Hs],1024,512,`plots/big_coarse_${l}_Hs.png`,1);
  
  const recP=calcAveragePower(coarseRecChunk);
  const refP=calcAveragePower(coarseRefChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(coarseEC.H);

  coarseDetectedDelay=ecOut.detectedDelay.index;
  
  console.log("chunk:",l,
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(coarseEC.H,delay/2),
              "erle:",erle.toFixed(5),
              "coarseDetectedDelay:",coarseDetectedDelay,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );
}
save_f(coarseRec,"can1_big_coarse_rec.pcm");
save_f(coarseRef,"can1_big_coarse_ref.pcm");


const toDelayRefined=(fftSize-coarseDetectedDelay)*coarseRatio;
console.log("coarseDetectedDelay:",coarseDetectedDelay,"toDelayRefined:",toDelayRefined);


if(coarseDetectedDelay==0) throw "coarse_detect_fail";


// 粗な推定ができたので、次は高精度な推定を行う。
const refinedEC=createEchoCanceler(fftSize);
let refinedChunkNum=Math.ceil(refinedRec.length/chunkSize);

const finalSamples=new Float32Array(rec.length);
const estimatedSamples=new Float32Array(rec.length);

refinedChunkNum= 250;

for(let l=0;l<refinedChunkNum;l++) {
  const startIndex=l*chunkSize;
  const refinedRecChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) refinedRecChunk[i]=refinedRec[startIndex+i]||0;
  // ここでrefチャンクを作るときに、 coarseで雑に推定した値を足す。
  const refinedRefChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) refinedRefChunk[i]=refinedRef[startIndex+i+toDelayRefined]||0;
  
  const ecOut=refinedEC.process(refinedRefChunk,refinedRecChunk);


  plotArrayToImage([refinedRecChunk],1024,512,`plots/big_refined_${l}_rec_chunk.png`,1);
  plotArrayToImage([refinedRefChunk],1024,512,`plots/big_refined_${l}_ref_chunk.png`,1);  
  plotArrayToImage([ecOut.Hs],1024,512,`plots/big_refined_${l}_Hs.png`,1);
  
  const recP=calcAveragePower(refinedRecChunk);
  const refP=calcAveragePower(refinedRefChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(refinedEC.H);

  console.log("chunk:",l,
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(refinedEC.H,delay/2),
              "erle:",erle.toFixed(5),
              "detectedDelay:",ecOut.detectedDelay.index,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );


  
}
save_f(finalSamples,"can1_big_canceled.pcm");
save_f(estimatedSamples,"can1_big_estimated.pcm");


