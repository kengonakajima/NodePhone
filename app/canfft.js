const {
  PortAudio,
  getVolumeBar,
  to_f_array,
  to_s_array,
  fft_f,
  ifft,
  spectrumBar
} = require('./util.js');
const freq=24000; 
PortAudio.initSampleBuffers(freq,freq,512);
PortAudio.startMic();
PortAudio.startSpeaker();



const SPF=512;


////////////////////


// 何もしないダミーの関数
function cancelEchoNoop(ref,rec) {
  if(rec.length!=ref.length) throw "invalid_len";
  const canceled=new Int16Array(rec.length);
  for(let i=0;i<rec.length;i++) canceled[i]=rec[i];
  return {canceled};
}

// FFT版きゃんセラー
function cancelEcho(ref,rec) {
  if(rec.length!=ref.length) throw "invalid_len";
  const rec_f=to_f_array(rec);
  // 時間領域から周波数領域に変換する
  const recSpectrum=fft_f(rec_f);

  // 周波数領域から時間領域に戻す
  const r=ifft(recSpectrum);

  const canceled=to_s_array(r);

  return {canceled,recSpectrum};
}



// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 再生バッファ

setInterval(()=>{
  let enh=0;
  
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  PortAudio.discardRecordedSamples(samples.length); // PortAudioの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) g_recSamples.push(sample); // 録音バッファに記録

  // 録音バッファに音が来ていたらエコーキャンセラを呼び出す
  if(g_recSamples.length>=SPF) {
    let frameNum=Math.floor(g_recSamples.length/SPF);
    if(frameNum>10) frameNum=10;
    for(let j=0;j<frameNum;j++) {      
      const rec=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) rec[i]=g_recSamples.shift();
      const ref=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) ref[i]=g_refSamples.shift();
      const st=new Date().getTime();
      const {canceled,recSpectrum}=cancelEcho(ref,rec);
      const et=new Date().getTime();
      const dt=et-st;
      const play=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) {
        const sample=canceled[i];
        g_refSamples.push(sample); // AEC処理された音を参照バッファに送る
        play[i]=sample;         // 同じ音を再生バッファに送る
      }
      PortAudio.pushSamplesForPlay(play);  // スピーカーに送る

      // 表示
      const recSpecBar=spectrumBar(recSpectrum,32);
      console.log("T:",dt,recSpecBar);
    }
  }

},50);
