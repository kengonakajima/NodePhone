const {PortAudio, getVolumeBar} = require('./util.js');
const fs=require("fs");

// PortAudioの内部バッファを初期化する
PortAudio.initSampleBuffers(48000,48000,512); 
// マイクを開始する
PortAudio.startMic(); 

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples();
  // サンプルがないときは何もせず、無名関数を終了
  if(samples.length<=0) return;
  // PortAudioの内部バッファを破棄する
  PortAudio.discardRecordedSamples(samples.length); 

  // samplesに含まれる最大音量を調べる。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>maxVol) maxVol=sample;
  }
  // 最大音量を表示する
  const bar = getVolumeBar(maxVol);
  console.log("mic volume:", bar, "len:",samples.length);

  // 録音した音をファイルに保存する
  const b=Buffer.from(samples.buffer);
  fs.appendFileSync("recorded.lpcm16",b);
},25);


