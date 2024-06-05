/*
  countingは複雑な声を含んでいるので、純粋なサイン波でテストする。
  窓関数を用いる。

  窓関数を使うため、推定したいチャンクの前後に chunkSizeが1024の場合

  |　512 | 1024 | 512 | = 合計2048サンプル　の長さの単位でFFTを実行する。

  
  
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



const chunkSize=256;
const unit=chunkSize*2; // 処理単位はチャンクサイズの2倍

const H_error = new Float32Array(unit); // FIRフィルタの係数Hとは異なる。  Xと同じサイズが必要
for(let i=0;i<unit;i++) H_error[i]=10000; // AEC3から

function echoCancel(ref,rec,coefs,chunkIndex) {
  const st=new Date().getTime();
  const N=ref.length;

  const refHann=applyHannWindow(ref);
  const x=refHann;
  const recHann=applyHannWindow(rec);
  const y=recHann;
  
  const X=fft_f(x);
  const Y=fft_f(y);
//  console.log("chunk:",X,Y);

  const H=coefs;

  // FIRフィルタ
  const S = X.map((x, i) => {
    const re = x.re * H[i].re - x.im * H[i].im;
    const im = x.re * H[i].im + x.im * H[i].re;
    return { re, im };
  });
  //console.log("H:",H);
  //console.log("S:",spectrumBar(S,64),calcAveragePowerComplex(S));


  const s = ifft_f(S);
  //console.log("s:",s,calcAveragePower(s));

  const e = new Float32Array(N); //時間領域の予測誤差

  for(let i=0;i<N;i++) e[i]=y[i]-s[i];

  const eHann=applyHannWindow(e);
  const E = fft_f(eHann); // E: eの周波数領域表現
  

  const Xs = calcPowerSpectrum(X); // Xs: Xのパワースペクトラム
  const Es = calcPowerSpectrum(E); // Es: Eのパワースペクトラム

  const pn=padNumber(chunkIndex,3,'0');

  //plotArrayToImage([Xs,Es],1024,512,`plots/fft_win_${pn}.png`,1);
  //plotArrayToImage([x],1024,512,`plots/fft_win_x_${pn}.png`,1);
  //plotArrayToImage([y],1024,512,`plots/fft_win_y_${pn}.png`,1);
  //plotArrayToImage([s],1024,512,`plots/fft_win_s_${pn}.png`,1);
  //plotArrayToImage([e],1024,512,`plots/fft_win_e_${pn}.png`,1);        


  //     mu = H_error / (0.5* H_error* X2 + n * E2).
  // partitioningしていないので n=1
  const mu = new Float32Array(N);
  for(let i=0;i<N;i++) mu[i]=H_error[i] / (0.5 * H_error[i] * Xs[i] + 1 * Es[i]);
//  console.log("mu:",calcAveragePower(mu));

  //     H_error = H_error - 0.5 * mu * X2 * H_error.

  for(let i=0;i<N;i++) H_error[i]-=(0.5 * mu[i] * Xs[i] * H_error[i]);

//  console.log("H_error:",H_error); 

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
    H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
    H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
  }

  const Hs=ifft_f(H);

  //plotArrayToImage([Hs],1024,512,`plots/fft_win_Hs_${pn}.png`,1);
  const m=findMax(Hs);
  

  // ここでsが予測値、eが誤差。両方とも、長さはNなので、出力するのは真ん中の使える部分だけにする必要がある。
  // 
  const estimated=new Float32Array(N/2);
  const canceled=new Float32Array(N/2);
  const startInd=N/4;
  const sampleNum=N/2;  
  for(let i=0;i<sampleNum;i++) {
    estimated[i]=s[i+startInd];
    canceled[i]=e[i+startInd];
    
  }
  const et=new Date().getTime();  
  return {canceled, estimated, dt:et-st, detectedDelay: m };
}



const delay=180; // このサンプル数だけ遅れて録音される。
const rec=new Float32Array(24000*10);
for(let i=0;i<rec.length;i++) {
  const hz=50;
  const t=hz*2*Math.PI/24000;
  rec[i]=Math.sin(i*t)*0.3; // -1 ~ 1
}
const coefs=createComplexArray(unit); // フィルタ係数




const finalSamples=new Float32Array(rec.length);
const estimatedSamples=new Float32Array(rec.length);
let chunkNum=Math.ceil(rec.length/chunkSize);
//if(chunkNum>40) chunkNum=40;

for(let l=0;l<chunkNum;l++) {
  const recChunk=new Float32Array(unit);
  for(let i=0;i<unit;i++) recChunk[i]=rec[l*chunkSize+i-chunkSize/2]||0;
  const refChunk=new Float32Array(unit);
  Array(unit);
  for(let i=0;i<unit;i++) refChunk[i]=rec[l*chunkSize+i-delay-chunkSize/2]||0;
  const ecOut=echoCancel(refChunk,recChunk,coefs,l);    
  const recP=calcAveragePower(recChunk);
  const refP=calcAveragePower(refChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(coefs);

  console.log("chunk:",l,
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(coefs,delay/2),
              "erle:",erle.toFixed(5),
              "detectedDelay:",ecOut.detectedDelay.index,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );

  if(ecOut.canceled.length!=chunkSize) throw "invalid_output_size_1";
  if(ecOut.estimated.length!=chunkSize) throw "invalid_output_size_2";    
  for(let i=0;i<ecOut.canceled.length;i++) {
    let v=ecOut.canceled[i];    
    finalSamples[l*chunkSize+i]=v;
  }
  for(let i=0;i<ecOut.estimated.length;i++) {
    estimatedSamples[l*chunkSize+i]=ecOut.estimated[i];
  }
}
save_f(rec,"can1sin_win_orig.pcm");
save_f(finalSamples,"can1sin_win_canceled.pcm");
save_f(estimatedSamples,"can1sin_win_estimated.pcm");


