const {NativeAudio} = require('./util.js');
const freq=48000;
NativeAudio.initSampleBuffers(freq,freq); // NativeAudioの内部バッファを初期化する
NativeAudio.startMic(); // マイクを開始する
console.log("app/rec.js started");

// 100ミリ秒に1回繰り返す
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
  const ntimes = maxVol / 512; // 音量が0~32767の値で得られるので512で割る(0~63)
  const bar = "*".repeat(ntimes); // アスタリスク文字を、音量に応じて0~63回繰り返す
  console.log("mic volume:", bar, "len:",samples.length); 

},25);


setInterval(()=>{
  NativeAudio.update();
},10);
