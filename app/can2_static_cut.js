/*

can2_staticだが、どうしても700サンプルほど推定値が前にずれる問題があるため
いったん人工的にちいさなズレのrecを作ってそれでcoarseを用いずに試す。
  
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
  getMaxValue,
  highpassFilter
}=require("./util.js");




function createEchoCanceler(N) {
  const filter={
    N,
    H: createComplexArray(N),
    H_error: new Float32Array(N),
  };
  for(let i=0;i<N;i++) filter.H_error[i]=10000; // AEC3から。適当な値で初期化する
  filter.process = function(ref,rec) {
    const recP=calcAveragePower(rec);
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

    // H_error = H_error + factor * erl.
    // erl[k]=送信信号のPSD[k] / エコー経路(係数)のPSD
    const HPS=calcPowerSpectrum(filter.H);
    const EPS=calcPowerSpectrum(E);
    const erl=new Float32Array(N);
    for(let i=0;i<N;i++) {
      if(HPS[i]!=0) erl[i]=EPS[i] / HPS[i];
    }
    //console.log("erl:",spectrumBar(erl,64),findMax(erl)); // 0に近い値から20万ぐらいの値までをとるようだ。
    const factor=1; // 0.01: 最大erle
    for(let i=0;i<N;i++) {
      filter.H_error[i] += factor * erl[i];
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
    return {canceled, estimated, detectedDelay: m, erle,canceledPower, recPower,estimatedPower,refPower,Hs,x,y, dt:et-st ,e,s};
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


const played=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("playRecCut.lpcm16");  // countingを再生して録音したものを100サンプル程度の遅れ(右ずれ)にしたもの。
console.log("LEN:",played.length,recorded.length);
const chunkSize=256; //512; // チャンクサイズ
const fftSize=1024; // FFTの窓のサイズ

let rec=to_f_array(new Int16Array(recorded.buffer));
let ref=to_f_array(new Int16Array(played.buffer));

// どっちもhpかけてみる
//rec=highpassFilter(rec,24000,500);
//ref=highpassFilter(ref,24000,500);
//save_f(rec,"can2_hp_rec.lpcm");
//save_f(ref,"can2_hp_ref.lpcm");



const refinedRec=new Float32Array(recorded.length);
for(let i=0;i<recorded.length;i++) refinedRec[i]=rec[i]; 
const refinedRef=new Float32Array(played.length);
for(let i=0;i<played.length;i++) refinedRef[i]=ref[i];



// 粗な推定ができたので、次は高精度な推定を行う。
const refinedEC=createEchoCanceler(fftSize);
let refinedChunkNum=Math.ceil(refinedRec.length/chunkSize);

const origSamples=new Float32Array(rec.length);
const finalSamples=new Float32Array(rec.length);
const estimatedSamples=new Float32Array(rec.length);

refinedChunkNum= 500;

const offset=0;

for(let l=0;l<refinedChunkNum;l++) {
  const startIndex=l*chunkSize;
  const refinedRecChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) refinedRecChunk[i]=refinedRec[startIndex+i+offset]||0;
  // ここでrefチャンクを作るときに、 coarseで雑に推定した値を足す。
  const refinedRefChunk=new Float32Array(fftSize);
  for(let i=0;i<fftSize;i++) refinedRefChunk[i]=refinedRef[startIndex+i+offset]||0; // すでにCut済みなのでずらさない
  
  const ecOut=refinedEC.process(refinedRefChunk,refinedRecChunk);


  /*
  plotArrayToImage([refinedRecChunk],1024,512,`plots/can2_refined_cut_rec_${l}.png`,1);
  plotArrayToImage([refinedRefChunk],1024,512,`plots/can2_refined_cut_ref_${l}.png`,1);
  plotArrayToImage([ecOut.estimated],1024,512,`plots/can2_refined_cut_estimated_${l}.png`,1);
  plotArrayToImage([ecOut.canceled],1024,512,`plots/can2_refined_cut_canceled_${l}.png`,1);      
  plotArrayToImage([ecOut.Hs],1024,512,`plots/can2_refined_cut_Hs_${l}.png`,1);
  plotArrayToImage([ecOut.e],1024,512,`plots/can2_refined_e_${l}.png`,1);
  plotArrayToImage([refinedRecChunk,ecOut.s],1024,512,`plots/can2_refined_cut_aaa_${l}.png`,1);  
*/
  
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
              "can:",getVolumeBar(to_s(getMaxValue(ecOut.canceled))),
              "recP:",recP.toFixed(5),
              "refP:",refP.toFixed(5),
              "canP:",canP.toFixed(5),
              "estP:",estP.toFixed(5),
              "erle:",erle.toFixed(5),
              "detectedDelay:",ecOut.detectedDelay.index,
              "dt:",ecOut.dt
             );

  // ecOut.canceledに含まれる1024個のデータの中の真ん中のchunkSizeだけ取得すべし。
  const centerIndex=fftSize/2/2;
  const leftSize=chunkSize/2;
  const readStartIndex=centerIndex-leftSize;
  for(let i=0;i<chunkSize;i++) finalSamples[l*chunkSize+i]=ecOut.canceled[readStartIndex+i];
  for(let i=0;i<chunkSize;i++) estimatedSamples[l*chunkSize+i]=ecOut.estimated[readStartIndex+i];
  for(let i=0;i<chunkSize;i++) origSamples[l*chunkSize+i]=refinedRecChunk[i];

}

// 単位信号で状態を調べる。
const idSignal=new Float32Array(fftSize);
idSignal[fftSize/2]=1;
const response=refinedEC.applyFilter(idSignal);
plotArrayToImage([response],1024,512,"plots/can2_cut_response.png",1);
//for(let i=0;i<response.length;i++) console.log(i,response[i]);


save_f(finalSamples,"can2_cut_canceled.pcm");
save_f(estimatedSamples,"can2_cut_estimated.pcm");
save_f(origSamples,"can2_cut_origrec.pcm");

