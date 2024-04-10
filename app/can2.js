const {PortAudio,getVolumeBar,appendBinaryToFile,to_f,to_s,calcMse,append_f,rm,save_f,calcERLE,getMaxValue,padNumber,totMag} = require('./util.js');
const freq=2000;
const SPF=32;
PortAudio.initSampleBuffers(freq,freq,SPF);
PortAudio.startMic();
PortAudio.startSpeaker();

const to_save=false;

rm("ref.pcm")
rm("rec.pcm");
rm("estim.pcm");
rm("play.pcm");

function cancelEchoNoop(ref,rec) {
  if(rec.length!=ref.length) throw "invalid_len";
  const canceled=new Float32Array(rec.length);
  for(let i=0;i<rec.length;i++) canceled[i]=rec[i];
  return {canceled, estimated:[], maxCoef:0, maxCoefInd:0,lastMse:0};          
}

const FILTER_LEN=300;
const g_filter_coefficients=new Float32Array(FILTER_LEN);
let g_peak_counter={};
let g_estimated_delay=null;
let g_min_mse=99999;

function cancelEcho(ref,rec) {
//  console.log("cancelEcho: ref:",calcMse(ref),"rec:",calcMse(rec));//,ref.join(" "));//,"||",rec.join(" "));
  if(rec.length!=ref.length) throw "invalid_len";
  // refと　recの長さが違う。
  const N=FILTER_LEN;
  if(ref.length!=N || rec.length!=N) throw "invalid_len";

  // エコー推定
  const estimated=new Float32Array(N);
  const error=new Float32Array(N);

  const origCoef=new Float32Array(N);
  for(let i=0;i<N;i++) origCoef[i]=g_filter_coefficients[i];
  
  const loopMax=20;
  let prevMse=0;
  let lastMse=0;
  for(let l=0;l<loopMax;l++) {
    for(let i=0;i<N;i++) estimated[i]=firFilter(ref,i);

    // エコーを除去した信号をつくる。これがエラー信号となる。エラー信号が小さければ良い。

    for(let i=0;i<N;i++) error[i]=rec[i]-estimated[i];
    const mse=calcMse(error);
    lastMse=mse;
    console.log("err: mse:",mse,"l:",l);//,error.join(" "));
    if(mse<0.000001) {
      console.log("found a good coefficients, quit loop");
      break;    
    }
    if(mse==prevMse) {
      console.log("mse saturated: mse:",mse);
      break;
    }
    prevMse=mse;
    // フィルタ係数を更新
    const u=0.2;
    for(let i=0;i<N;i++) {
      for(let j=0;j<N;j++) {
        if(i-j >= 0) {
          g_filter_coefficients[j] += u * error[i] * ref[i - j];
         }
      }
    }      
  }

  const totalMagnitude=totMag(origCoef,g_filter_coefficients);
  if(totalMagnitude>1) console.log("coef:",g_filter_coefficients.join(","), error.join(","), ref.join(","))
  /*
  // 変な値を削除する
  for(let i=0;i<N;i++) {
    if(error[i]>1) error[i]=1;
    else if(error[i]<-1) error[i]=-1;
  }
  */
  

  let maxCoef=-9999;
  let maxCoefInd=-1;
  for(let i=0;i<N;i++) if(g_filter_coefficients[i]>maxCoef) {maxCoef=g_filter_coefficients[i]; maxCoefInd=i; }
  //  console.log("coe:",g_filter_coefficients.join("\n"));
  if(!g_peak_counter[maxCoefInd]) g_peak_counter[maxCoefInd]=1; else g_peak_counter[maxCoefInd]++;
  if(g_peak_counter[maxCoefInd]>100) {
    if(!g_estimated_delay) {
      g_estimated_delay=maxCoefInd;
      g_min_mse=lastMse;
    } else if(lastMse<g_min_mse) {
      g_estimated_delay=maxCoefInd;      
      g_min_mse=lastMse;
    }
    g_peak_counter={};
  }
  if(g_estimated_delay>0) {
    // スパース化またはプルーニンぐ
    for(let i=0;i<g_estimated_delay-30;i++) g_filter_coefficients[i]*=0.5;
    for(let i=g_estimated_delay+30;i<FILTER_LEN;i++) g_filter_coefficients[i]*=0.5;
  }
  if(maxCoef>10) {
    console.log("RESETTING!!");
    for(let i=0;i<FILTER_LEN;i++) g_filter_coefficients[i]=error[i]=estimated[i]=0;
    g_estimated_delay=null;
    
  }

  return {canceled: error, estimated, maxCoef, maxCoefInd,lastMse,totalMagnitude};
}



// FIRフィルタの処理関数
function firFilter(inputSignal, startIndex) {
  let output = 0;

  // 畳み込み演算
  for (let i = 0; i < FILTER_LEN; i++) {
    const signalIndex = startIndex - i;
    if (signalIndex >= 0) {
      output += g_filter_coefficients[i] * inputSignal[signalIndex];
    }
  }

  return output;
}

function coefBar() {
  const num=50;
  const out=[];
  for(let i=0;i<num;i++) out[i]=' ';
  const step=FILTER_LEN/num;  
  for(let i=0;i<FILTER_LEN;i++) {
    const outi=parseInt(i/step);
    let e=g_filter_coefficients[i];
    if(e<0)e=0;
    if(e>out[outi])out[outi]=e;
  }
  for(let i=0;i<num;i++) {
    if(out[i]>0.5) out[i]='*';
    else if(out[i]>0.2) out[i]='+';
    else if(out[i]>0.1) out[i]='-';
    else if(out[i]>0.05) out[i]='.';
    else out[i]=' ';
  }
  
  return out.join("");
}

const testVoice=[0,500,1000,500,0,-500,-1000,-500,0,500,1000,500,0,-500,-1000,-500,0];

// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 遅延バッファ.
const g_refHistory=[]; // lpcm16 遅延バッファのshiftせず記録しておく用
const g_recHistory=[]; // lpcm16 録音バッファのshiftせず記録しておく用

let g_testVoiceCnt=0;

setInterval(()=>{
  g_testVoiceCnt++;
  
  let recMax=0, playMax=0;
  let enh=0;
  
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  PortAudio.discardRecordedSamples(samples.length); // PortAudioの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>recMax) recMax=sample;
    g_recSamples.push(sample); // 録音バッファに記録
  }

  // SPF単位で処理するが、係数の更新はもっと前の信号も見る。

  
  if(g_recSamples.length>=SPF) {    
    // 常に一定のフレームサイズで動かしていく必要がある。そうしないと係数が安定しない
    let frameNum=Math.floor(g_recSamples.length/SPF);
    if(frameNum>4) frameNum=4;
    //console.log("frameNum:",frameNum,"SPF:",SPF);
    for(let j=0;j<frameNum;j++) {
      const st=new Date().getTime();
      const hoge=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) {
        const sample=g_recSamples.shift();
        g_recHistory.push(sample);
        hoge[i]=sample;
      }
      if(to_save) appendBinaryToFile("rec.pcm",hoge);
      // ここでrecHistoryはrefHistoryに対してSPFぶんだけ進んでいる
      // したがって recはrefよりもSPFだけ常に前。
      const ref=new Float32Array(FILTER_LEN);
      for(let i=0;i<FILTER_LEN;i++) ref[i]=to_f(g_refHistory[g_refHistory.length-FILTER_LEN+i]||0);
      const rec=new Float32Array(FILTER_LEN);
      for(let i=0;i<FILTER_LEN;i++) rec[i]=to_f(g_recHistory[g_recHistory.length-FILTER_LEN+i]||0);
      //console.log("refH:",g_refHistory.length,"recH:",g_recHistory.length);
      const {canceled,estimated,maxCoefInd,maxCoef,lastMse,totalMagnitude}=cancelEcho(ref,rec);
      const estimated_i=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) estimated_i[i]=to_s(estimated[estimated.length-SPF+i]);
      if(to_save) appendBinaryToFile("estim.pcm",estimated_i);
      if(to_save) save_f(g_filter_coefficients,"coef.data");
      const erle=calcERLE(rec,canceled);
      
      playMax=0;
      const play=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) {
        const sample=to_s(canceled[canceled.length-SPF+i]);
        g_refHistory.push(sample);
        play[i]=sample;         // 同じ音を再生バッファに送る
        if(sample>playMax) playMax=sample;
      }
      PortAudio.pushSamplesForPlay(play);  // スピーカーに送る
      if(to_save) appendBinaryToFile("play.pcm",play);

      const et=new Date().getTime();
      console.log("T:",et-st,"maxCoef:",maxCoef.toFixed(6),"lastMse:",lastMse.toFixed(7),"erle:",erle.toFixed(7), "bar:",getVolumeBar(to_s(getMaxValue(rec))), coefBar(), "maxCoefInd:",padNumber(maxCoefInd,3),"delay:",g_estimated_delay,"minMse:",g_min_mse.toFixed(6),"totMag:",totalMagnitude.toFixed(4));
    }
    
  }

  // デバッグ表示
  //console.log("recMax:",recMax,"playMax:",playMax,"recSamples:",g_recSamples.length);
},2);
