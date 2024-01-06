const addon = require('./build/Release/NativeAudio.node'); // addonを読み込む
const freq=48000;
addon.initSampleBuffers(freq,freq); // addonの内部バッファを初期化する
addon.startMic(); // マイクを開始する

// 100ミリ秒に1回繰り返す
setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=addon.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  addon.discardRecordedSamples(samples.length); // addonの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>maxVol) maxVol=sample;
  }
  // 音量を表示する
  const ntimes = maxVol / 512; // 音量が0~32767の値で得られるので512で割る(0~63)
  const bar = "*".repeat(ntimes); // アスタリスク文字を、音量に応じて0~63回繰り返す
  console.log("mic volume:", bar, new Date().getTime(), "len:",samples.length); 
},25);


