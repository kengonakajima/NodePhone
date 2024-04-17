const {
  loadLPCMFileSync,
  firFilter,
  firFilterFFT,
  to_f_array,
  to_s_array,
  calcAveragePower,
  findMax,
  save_f,
  plotArrayToImage,
}=require("./util.js");




function echoCancel(ref,rec,coefs,chunkIndex) {
  const st=new Date().getTime();
  const N=ref.length;
  const err=new Float32Array(N);
  let estimated=[];

  const mu=0.002; // 1024だと0.01　2048だと 0.002
  const epsilon=1e-6;
  const recNorm = rec.reduce((sum, value) => sum + value * value, 0);
  const u = mu / (recNorm + epsilon);
  const avgRecP=recNorm/N;
  const refNorm = ref.reduce((sum, value) => sum + value * value, 0);
  const avgRefP=refNorm/N;
  console.log("chunk:",chunkIndex,"U:",u,"recNorm:",recNorm,"avgRecP:",avgRecP,"refNorm:",refNorm,"avgRefP:",avgRefP);
  let fftDt=0;
  
  for(let loop=0;loop<50;loop++) {
    // エコーを推定する
    //estimated=firFilter(ref,coefs,N);
    const fftst=new Date().getTime();
    estimated=firFilterFFT(ref,coefs,N); // 1024要素でFFTなしは1~2ms　FFTは~1ms 2048要素で FFTは1~2ms　FFTなしは4~5ms
    const fftet=new Date().getTime();    
    fftDt=fftet-fftst;
    
    // エコーを除去した信号をつくる。これがエラー信号となる。エラー信号が小さければ良い。
    for(let i=0;i<N;i++) err[i]=rec[i]-estimated[i];
    const errorPower=calcAveragePower(err);
    
    console.log("chunk:",chunkIndex,"loop:",loop,"errPower:",errorPower,"u:",u,"fftDt:",fftDt);

    if(errorPower<0.00001) {
      console.log("found a good coefficients, quit loop. chunk:",chunkIndex);
      break;
    }
    if(errorPower>10000) {
      console.log("error power too big! errp:",errorPower,"chunk:",chunkIndex);
      break;
    }
    // フィルタ係数を更新(NLMS)
    if(avgRefP<0.001) {
      console.log("ref signal is too small. skip! chunk:",chunkIndex);
      break;
    }
    const leaky = 1;
    for(let i=0;i<N;i++) {
      for(let j=0;j<N;j++) {
        if(i-j >= 0) {
          coefs[j] =  leaky * coefs[j] + u * err[i] * ref[i - j];
        }
      }
    }    
  }
  const et=new Date().getTime();  
//  console.log("ec: ref:",rec,"rec:",rec,"err:",err);
  return {canceled: err, estimated, dt:et-st};
}

// counting24k.lpcmは　音がほとんどない領域がけっこうあり、そうした無音領域の後に大きな音がきたときに発散する。
// piano24k.lpcmはすきまがあまりない。
// refのエネルギーが小さいときに係数を更新しないようにしたら、見事におさまった。
// 問題は、収束が遅いこと。50ループで30msしても、errPowerが0.001ぐらいある。 0.0001ぐらいにしたい。
const chunk=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ


const unit=2048; //処理単位  2048にすると発散した
const delay=180; // このサンプル数だけ遅れて録音される。
const rec=to_f_array(new Int16Array(chunk.buffer));
const coefs=new Float32Array(unit); // フィルタ係数

//console.log("rec:",rec,ref); //
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
              "maxInd:",findMax(coefs,delay/2),
              "erle:",erle.toFixed(5),
              "dt:",ecOut.dt
             );
  plotArrayToImage([refChunk,recChunk,ecOut.canceled,ecOut.estimated,coefs],1024,512,`plots/chunk_${l}.png`,1)

  for(let i=0;i<ecOut.canceled.length;i++) finalSamples[l*unit+i]=ecOut.canceled[i];
}
save_f(finalSamples,"can0_canceled.pcm");


