/*
  録音された音声(counting24k)を一定サンプル数遅延させてエコーが含まれる音を人工的に作り 
  その人工的なエコーを含む音の遅延を、FIRフィルタを用いて推定するプログラム。
  推定には逐次重回帰分析を用いるが、can0との違いは、FFTを用いてFIRフィルタの処理とすべての解析を時間領域の信号を用いるため、
  計算量が多すぎて必要な速度で処理できない。
　
  遅延の推定自体は正しくできる。

  この推定結果は、FFTを用いて周波数領域で処理するバージョンとの比較用に役立てる。
  

  これが動けば、実際にマイクとスピーカーを使って物理的な回り込み音を消すプログラムn動作確認に進むことができる。
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



const unit=2048; //処理単位  

const H_error = new Float32Array(unit); // FIRフィルタの係数Hとは異なる。
for(let i=0;i<unit;i++) H_error[i]=10000; // AEC3から


function echoCancel(ref,rec,coefs,chunkIndex) {
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

  const e = new Float32Array(N); //時間領域の予測誤差

  for(let i=0;i<N;i++) e[i]=y[i]-s[i];

  const E = fft_f(e); // E: eの周波数領域表現

  console.log("e:",e,"error AvgPower:", calcAveragePower(e)*N, calcAveragePower(y) ); // N倍したらYのavgPowと同じ値になる。

  

  const Xs = calcPowerSpectrum(X); // Xs: Xのパワースペクトラム
  const Es = calcPowerSpectrum(E); // Es: Eのパワースペクトラム

  console.log("Es:",Es,"Xs:",Xs);

  const pn=padNumber(chunkIndex,3,'0');
  console.log("pn:",pn);
  plotArrayToImage([Xs,Es],1024,512,`plots/fft_${pn}.png`,1);
  plotArrayToImage([x,y,s,e],1024,512,`plots/fft_xyse_${pn}.png`,1);  


  //     mu = H_error / (0.5* H_error* X2 + n * E2).
  // partitioningしていないので n=1
  const mu = new Float32Array(N);
  for(let i=0;i<N;i++) mu[i]=H_error[i] / (0.5 * H_error[i] * Xs[i] + 1 * Es[i]);

  console.log("mu:",mu);

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

  for(let i=0;i<N;i++) {
    H[i].re += X[i].re * G[i].re + X[i].im * G[i].im;
    H[i].im += X[i].re * G[i].im - X[i].im * G[i].re;
  }

  console.log("H updated:",H);

  const Hs=ifft_f(H);

  plotArrayToImage([Hs],1024,512,`plots/fft_Hs_${chunkIndex}.png`,1);
  const m=findMax(Hs);
  console.log("findMax:",m);
  

  const estimated=s;
  const et=new Date().getTime();  
  return {canceled: e, estimated, dt:et-st};
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

const chunkNum=Math.ceil(rec.length/unit);
for(let l=0;l<chunkNum;l++) {  
  const recChunk=new Float32Array(unit);
  for(let i=0;i<unit;i++) recChunk[i]=rec[l*unit+i];
  const refChunk=new Float32Array(unit);
  for(let i=0;i<unit;i++) refChunk[i]=rec[l*unit+i+delay]||0;
  const ecOut=echoCancel(refChunk,recChunk,coefs,l);
  const recP=calcAveragePower(recChunk);
  const refP=calcAveragePower(refChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);


  console.log("chunk:",l,
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(coefs,delay/2),
              "erle:",erle.toFixed(5),
              "dt:",ecOut.dt
             );
//  plotArrayToImage([refChunk,recChunk,ecOut.canceled,ecOut.estimated,coefs],1024,512,`plots/chunk_${l}.png`,1)

  for(let i=0;i<ecOut.canceled.length;i++) finalSamples[l*unit+i]=ecOut.canceled[i];
}
save_f(finalSamples,"can1_canceled.pcm");


