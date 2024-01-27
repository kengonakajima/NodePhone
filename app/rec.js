const {NativeAudio, getVolumeBar} = require('./util.js');
const freq=48000;
// NativeAudioの内部バッファを初期化する
NativeAudio.initSampleBuffers(freq,freq); 
// マイクを開始する
NativeAudio.startMic(); 

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=NativeAudio.getRecordedSamples();
  // サンプルがないときは何もせず、無名関数を終了
  if(samples.length<=0) return;
  // NativeAudioの内部バッファを破棄する
  NativeAudio.discardRecordedSamples(samples.length); 

  // samplesに含まれる最大音量を調べる。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>maxVol) maxVol=sample;
  }
  // 最大音量を表示する
  const bar = getVolumeBar(maxVol);
  console.log("mic volume:", bar, "len:",samples.length); 
},25);


