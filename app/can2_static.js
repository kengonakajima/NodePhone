/*

  counting24kと、その物理的再生を playrec.jsで録音した playRec.lpcm16 (playRec.wavに変換)を利用してキャンセルを試す。
  
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
  to_s,
  plotArrayToImage,
  createComplexArray,
  spectrumBar,
  calcAveragePowerComplex,
  calcPowerSpectrum,
  padNumber,
  applyHannWindow,
  getVolumeBar,
  getMaxValue
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
  // FIRフィルタだけをやる。時間領域の信号をFFTのサイズで入れること。
  filter.applyFilter = function(y) {
    if(y.length!=filter.N) throw "invalid_size";
    const Y=fft_f(y);
    const S = Y.map((x, i) => {
      const re = x.re * filter.H[i].re - x.im * filter.H[i].im;
      const im = x.re * filter.H[i].im + x.im * filter.H[i].re;
      return { re, im };
    });
    const s=ifft_f(S);
    return s;
  }

  return filter;
}


// counting24k.lpcmは　音がほとんどない領域がけっこうあり、そうした無音領域の後に大きな音がきたときに発散する。
// piano24k.lpcmはすきまがあまりない。
// refのエネルギーが小さいときに係数を更新しないようにしたら、見事におさまった。
// 問題は、収束が遅いこと。50ループで30msしても、errPowerが0.001ぐらいある。 0.0001ぐらいにしたい。
const played=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("playRec.lpcm16");  // 元のデータ。これが再生用データ
console.log("LEN:",played.length,recorded.length);
const chunkSize=256; //512; // チャンクサイズ
const fftSize=1024; // FFTの窓のサイズ

const rec=to_f_array(new Int16Array(recorded.buffer));
const ref=to_f_array(new Int16Array(played.buffer));

const coarseRatio=16; // coarseフィルタの倍率
const coarseRecLen=Math.ceil(recorded.length/coarseRatio);
const coarseRec=new Float32Array(coarseRecLen);
for(let i=0;i<coarseRecLen;i++) coarseRec[i]=rec[i*coarseRatio]; // 粗なフィルタ用の録音データ
const coarseRefLen=Math.ceil(played.length/coarseRatio);
const coarseRef=new Float32Array(coarseRefLen);
for(let i=0;i<coarseRefLen;i++) coarseRef[i]=ref[i*coarseRatio]||0; 

const refinedRec=new Float32Array(recorded.length);
for(let i=0;i<recorded.length;i++) refinedRec[i]=rec[i]; 
const refinedRef=new Float32Array(played.length);
for(let i=0;i<played.length;i++) refinedRef[i]=ref[i];

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

  plotArrayToImage([coarseRecChunk],1024,512,`plots/can2_coarse_rec_${l}.png`,1);
  plotArrayToImage([coarseRefChunk],1024,512,`plots/can2_coarse_ref_${l}.png`,1);    
  plotArrayToImage([ecOut.Hs],1024,512,`plots/can2_coarse_Hs_${l}.png`,1);
  
  const recP=calcAveragePower(coarseRecChunk);
  const refP=calcAveragePower(coarseRefChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(coarseEC.H);

  coarseDetectedDelay=ecOut.detectedDelay.index;
  
  console.log("chunk:",l,
              "rec:",getVolumeBar(to_s(getMaxValue(coarseRecChunk))),
              "ref:",getVolumeBar(to_s(getMaxValue(coarseRefChunk))),
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(coarseEC.H),
              "erle:",erle.toFixed(5),
              "coarseDetectedDelay:",coarseDetectedDelay,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );
}
save_f(coarseRec,"can2_coarseRec.pcm");
save_f(coarseRef,"can2_coarseRef.pcm");


let toDelayRefined=coarseDetectedDelay*coarseRatio;
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
  for(let i=0;i<fftSize;i++) refinedRefChunk[i]=refinedRef[startIndex+i-toDelayRefined]||0;
  
  const ecOut=refinedEC.process(refinedRefChunk,refinedRecChunk);


  plotArrayToImage([refinedRecChunk],1024,512,`plots/can2_refined_rec_${l}.png`,1);
  plotArrayToImage([refinedRefChunk],1024,512,`plots/can2_refined_ref_${l}.png`,1);  
  plotArrayToImage([ecOut.Hs],1024,512,`plots/can2_refined_Hs_${l}.png`,1);
  
  const recP=calcAveragePower(refinedRecChunk);
  const refP=calcAveragePower(refinedRefChunk);
  const canP=calcAveragePower(ecOut.canceled);
  const estP=calcAveragePower(ecOut.estimated);  
  const erle= 10 * Math.log10(recP / canP);
  const coefsP=calcAveragePowerComplex(refinedEC.H);

  console.log("chunk:",l,
              "rec:",getVolumeBar(to_s(getMaxValue(refinedRecChunk))),
              "ref:",getVolumeBar(to_s(getMaxValue(refinedRefChunk))),
              "est:",getVolumeBar(to_s(getMaxValue(ecOut.estimated))),
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "maxInd:",findMaxComplex(refinedEC.H),
              "erle:",erle.toFixed(5),
              "detectedDelay:",ecOut.detectedDelay.index,
              "coefsP:",coefsP,
              "dt:",ecOut.dt
             );

  // ecOut.canceledに含まれる1024個のデータの中の真ん中のchunkSizeだけ取得すべし。
  const centerIndex=fftSize/2/2;
  const leftSize=chunkSize/2;
  const readStartIndex=centerIndex-leftSize;
  for(let i=0;i<chunkSize;i++) finalSamples[l*chunkSize+i]=ecOut.canceled[readStartIndex+i];
  for(let i=0;i<chunkSize;i++) estimatedSamples[l*chunkSize+i]=ecOut.estimated[readStartIndex+i];
  
}

// 単位信号で状態を調べる。
const idSignal=new Float32Array(fftSize);
idSignal[fftSize/2]=1;
idSignal[fftSize/2+100]=1;
const response=refinedEC.applyFilter(idSignal);
plotArrayToImage([response],1024,512,"plots/can2_response.png",1);
for(let i=0;i<response.length;i++) console.log(i,response[i]);


save_f(finalSamples,"can2_canceled.pcm");
save_f(estimatedSamples,"can2_estimated.pcm");


