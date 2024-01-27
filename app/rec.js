const {NativeAudio, getVolumeBar} = require('./util.js');
const freq=48000;
NativeAudio.initSampleBuffers(freq,freq); // NativeAudioの内部バッファを初期化する
NativeAudio.startMic(); // マイクを開始する

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=NativeAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  NativeAudio.discardRecordedSamples(samples.length); // NativeAudioの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>maxVol) maxVol=sample;
  }
  // 音量を表示する
  const bar = getVolumeBar(maxVol);
  console.log("mic volume:", bar, new Date().getTime(), "len:",samples.length); 
},25);


