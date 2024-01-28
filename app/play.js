const {NativeAudio} = require('./util.js');
const freq=48000; // サンプリング周波数
NativeAudio.initSampleBuffers(freq,freq); //NativeAudioを初期化
NativeAudio.startSpeaker(); // スピーカー起動

const hz=220; // 生成する音の周波数
const dt=Math.PI * 2 * hz / freq; // 1サンプルあたりの時間差
let t=0;    // 音波を生成する際の時刻カウンター

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // 再生用バッファの残り量を調べる
  const used=NativeAudio.getPlayBufferUsed();
  if(used>=4096) return;
  // 残り量が少ない場合はサイン波を4096サンプルづつ生成する
  const n=4096;
  const samples=new Int16Array(n);
  for(let i=0;i<n;i++) { 
    t += dt; // 1サンプルごとに時間を進める
    const y=Math.sin(t); // sinの値を求める
    const sample=y*20000; // 振幅を掛ける    
    samples[i]=Math.floor(sample); // 整数にする
  }
  NativeAudio.pushSamplesForPlay(samples);
  console.log("pushed samples:",samples.length,new Date());
},25);



