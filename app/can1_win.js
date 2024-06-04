/*
  純粋なsin波を利用して調べた結果、
  窓関数を利用して正しく予測できるようになったので、
  その窓関数を
  
  
  
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
  padNumber
}=require("./util.js");


const chunkSize=2048; // チャンクサイズ
const unit=chunkSize*2; //処理単位  

const H_error = new Float32Array(unit); // FIRフィルタの係数Hとは異なる。
for(let i=0;i<unit;i++) H_error[i]=10000; // AEC3から


function echoCancel(ref,rec,coefs,chunkIndex,toUpdateCoefs) {
  const st=new Date().getTime();
  const N=ref.length;

  const x=ref;
  const y=rec;
  
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
  console.log("H:",H);
  console.log("S:",spectrumBar(S,64),calcAveragePowerComplex(S));


  const s = ifft_f(S);
  console.log("s:",s,calcAveragePower(s));
  console.log("y:",y);
  const e = new Float32Array(N); //時間領域の予測誤差

  for(let i=0;i<N;i++) e[i]=y[i]-s[i];

  const E = fft_f(e); // E: eの周波数領域表現

  console.log("e:",e,"error AvgPower:", calcAveragePower(e)*N, calcAveragePower(y) ); // N倍したらYのavgPowと同じ値になる。

  

  const Xs = calcPowerSpectrum(X); // Xs: Xのパワースペクトラム
  const Es = calcPowerSpectrum(E); // Es: Eのパワースペクトラム

  console.log("Es:",Es,"Xs:",Xs);

  const pn=padNumber(chunkIndex,3,'0');
  console.log("pn:",pn);
  plotArrayToImage([Xs,Es],1024,512,`plots/fft_win2_${pn}.png`,1);
  plotArrayToImage([x],1024,512,`plots/fft_win2_x_${pn}.png`,1);
  plotArrayToImage([y],1024,512,`plots/fft_win2_y_${pn}.png`,1);
  plotArrayToImage([s],1024,512,`plots/fft_win2_s_${pn}.png`,1);
  plotArrayToImage([e],1024,512,`plots/fft_win2_e_${pn}.png`,1);    


  //     mu = H_error / (0.5* H_error* X2 + n * E2).
  // partitioningしていないので n=1
  const mu = new Float32Array(N);
  for(let i=0;i<N;i++) mu[i]=H_error[i] / (0.5 * H_error[i] * Xs[i] + 1 * Es[i]);

  console.log("mu:",calcAveragePower(mu));
  let maxmu=0;
  for(let i=0;i<N;i++) {
//    mu[i]=mu[i];
    if(mu[i]>maxmu) {maxmu=mu[i];}
  }
  console.log("maxmu ",maxmu);

  //     H_error = H_error - 0.5 * mu * X2 * H_error.

  for(let i=0;i<N;i++) H_error[i]-=(0.5 * mu[i] * Xs[i] * H_error[i]);

  console.log("H_error:",H_error); 

  // G = mu * E
  const G = new Array(N);


  for(let i=0;i<N;i++) {
    G[i]={
      re: mu[i] * E[i].re,
      im: mu[i] * E[i].im
    };
  }

  console.log("G:",G);

  // H(t+1)=H(t)+G(t)*conj(X(t)).
  //      H_p_ch.re[k] += X_p_ch.re[k] * G.re[k] + X_p_ch.im[k] * G.im[k];
  //      H_p_ch.im[k] += X_p_ch.re[k] * G.im[k] - X_p_ch.im[k] * G.re[k];
  if(toUpdateCoefs) {
    for(let i=0;i<N;i++) {
      H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
      H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
    }
    console.log("H updated:",H);
  }

  const Hs=ifft_f(H);

  plotArrayToImage([Hs],1024,512,`plots/fft_win2_Hs_${pn}.png`,1);
  const m=findMax(Hs);
  console.log("findMax:",m);


  const estimated=new Float32Array(N/2);
  const canceled=new Float32Array(N/2);
  const startInd=N/4;
  const sampleNum=N/2;  
  for(let i=0;i<sampleNum;i++) {
    estimated[i]=s[i+startInd];
    canceled[i]=e[i+startInd];
  }
  console.log("LLL:",estimated.length,canceled.length);
  const et=new Date().getTime();  
  return {canceled, estimated, dt:et-st, detectedDelay: m };
}

// counting24k.lpcmは　音がほとんどない領域がけっこうあり、そうした無音領域の後に大きな音がきたときに発散する。
// piano24k.lpcmはすきまがあまりない。
// refのエネルギーが小さいときに係数を更新しないようにしたら、見事におさまった。
// 問題は、収束が遅いこと。50ループで30msしても、errPowerが0.001ぐらいある。 0.0001ぐらいにしたい。
const chunk=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ



const delay=180; // このサンプル数だけ遅れて録音される。
const rec=to_f_array(new Int16Array(chunk.buffer));
const coefs=createComplexArray(unit); // フィルタ係数




const finalSamples=new Float32Array(rec.length);
const estimatedSamples=new Float32Array(rec.length);
let chunkNum=Math.ceil(rec.length/unit);
if(chunkNum>40) chunkNum=40;

for(let l=0;l<chunkNum;l++) {  
  const recChunk=new Float32Array(unit);
  for(let i=0;i<unit;i++) recChunk[i]=rec[l*chunkSize+i-chunkSize/2]||0;
  const refChunk=new Float32Array(unit);
  for(let i=0;i<unit;i++) refChunk[i]=rec[l*chunkSize+i-delay-chunkSize/2]||0;
  const toUpdateCoefs=true;//(l<5);
  const ecOut=echoCancel(refChunk,recChunk,coefs,l,toUpdateCoefs);
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

  for(let i=0;i<ecOut.canceled.length;i++) {
    let v=ecOut.canceled[i];
//    if(i==0) v=32700;
    finalSamples[l*chunkSize+i]=v;
  }
  for(let i=0;i<ecOut.estimated.length;i++) {
    estimatedSamples[l*chunkSize+i]=ecOut.estimated[i];
  }
}
save_f(rec,"can1_win2_orig.pcm");
save_f(finalSamples,"can1_win2_canceled.pcm");
save_f(estimatedSamples,"can1_win2_estimated.pcm");


