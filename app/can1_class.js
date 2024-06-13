/*
  純粋なsin波を利用して調べた結果、
  窓関数を利用して正しく予測できるようになったので、
  
  
  
  
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


const chunkSize=512; // チャンクサイズ
const N=chunkSize*2; //処理単位  

function createEchoCanceler() {
  const filter={
    H: createComplexArray(N),
    H_error: new Float32Array(N),
  };
  for(let i=0;i<N;i++) filter.H_error[i]=10000; // AEC3から。適当な値で初期化する
  filter.process = function(ref,rec) {
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
    return {canceled, estimated, detectedDelay: m, erle,canceledPower, recPower,estimatedPower,refPower,Hs,x,y };
  }
  return filter;
}


// counting24k.lpcmは　音がほとんどない領域がけっこうあり、そうした無音領域の後に大きな音がきたときに発散する。
// piano24k.lpcmはすきまがあまりない。
// refのエネルギーが小さいときに係数を更新しないようにしたら、見事におさまった。
// 問題は、収束が遅いこと。50ループで30msしても、errPowerが0.001ぐらいある。 0.0001ぐらいにしたい。
const chunk=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ
//const chunk=loadLPCMFileSync("long_a.lpcm");  // 元のデータ。これが再生用データ



const delay=50; // このサンプル数だけ遅れて録音される。
const rec=to_f_array(new Int16Array(chunk.buffer));

const ec=createEchoCanceler();

const finalSamples=new Float32Array(rec.length);
const estimatedSamples=new Float32Array(rec.length);
let chunkNum=Math.ceil(rec.length/chunkSize);

for(let l=0;l<chunkNum;l++) {  
  const recChunk=new Float32Array(N);
  for(let i=0;i<N;i++) recChunk[i]=rec[l*chunkSize+i-chunkSize/2]||0;
  const refChunk=new Float32Array(N);
  for(let i=0;i<N;i++) refChunk[i]=rec[l*chunkSize+i-delay-chunkSize/2]||0;
  const ecOut=ec.process(refChunk,recChunk);
  const recP=calcAveragePower(recChunk);
  const refP=calcAveragePower(refChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(ec.H);

  console.log("chunk:",l,
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(ec.H,delay/2),
              "erle:",erle.toFixed(5),
              "detectedDelay:",ecOut.detectedDelay.index,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );

  for(let i=0;i<ecOut.canceled.length;i++) {
    let v=ecOut.canceled[i];
    finalSamples[l*chunkSize+i]=v;
  }
  for(let i=0;i<ecOut.estimated.length;i++) {
    estimatedSamples[l*chunkSize+i]=ecOut.estimated[i];
  }
}
save_f(rec,"can1_win2_class_orig.pcm");
save_f(finalSamples,"can1_win2_class_canceled.pcm");
save_f(estimatedSamples,"can1_win2_class_estimated.pcm");


