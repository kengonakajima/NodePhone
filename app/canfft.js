const {
  PortAudio,
  getVolumeBar
} = require('./util.js');
const freq=24000; 
PortAudio.initSampleBuffers(freq,freq,512);
PortAudio.startMic();
PortAudio.startSpeaker();



const SPF=512;


////////////////////


function cancelEchoNoop(ref,rec) {
  if(rec.length!=ref.length) throw "invalid_len";
  const canceled=new Int16Array(rec.length);
  for(let i=0;i<rec.length;i++) canceled[i]=rec[i];
  return {canceled};
}



// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 再生バッファ

setInterval(()=>{
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

  // 録音バッファに音が来ていたらエコーキャンセラを呼び出す
  if(g_recSamples.length>=SPF) {
    let frameNum=Math.floor(g_recSamples.length/SPF);
    if(frameNum>10) frameNum=10;
    for(let j=0;j<frameNum;j++) {      
      const rec=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) rec[i]=g_recSamples.shift();
      const ref=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) ref[i]=g_refSamples.shift();
      const {canceled}=cancelEchoNoop(ref,rec);
      playMax=0;
      const play=new Int16Array(SPF);
      for(let i=0;i<SPF;i++) {
        const sample=canceled[i];
        g_refSamples.push(sample); // AEC処理された音を参照バッファに送る
        play[i]=sample;         // 同じ音を再生バッファに送る
        if(sample>playMax) playMax=sample;
      }
      PortAudio.pushSamplesForPlay(play);  // スピーカーに送る     
    }
  }

  // デバッグ表示
  console.log("rec:",getVolumeBar(recMax),
              "play:",getVolumeBar(playMax)
             );
},50);
