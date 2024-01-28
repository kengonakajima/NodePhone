const {NativeAudio} = require('./util.js');
const freq=48000; // サンプリング周波数
NativeAudio.initSampleBuffers(freq,freq); //NativeAudioを初期化
NativeAudio.startSpeaker(); // スピーカー起動

const hz=220; // 生成する音の周波数
const dt=Math.PI * 2 * hz / freq; // 1サンプルあたりの時間差
let t=0;    // 音波を生成する際の時刻カウンター

// サイン波を生成する。sampleNum: 生成するサンプル数
function generate(sampleNum) {
  // 必要なサンプリングデータの数だけループさせる
  const outSamples=new Int16Array(sampleNum);
  for(let i=0;i<sampleNum;i++) { 
    t += dt; // 1サンプルごとに時間を進める
    const y=Math.sin(t); // sinの値を求める
    const fsample=y*20000; // 振幅を掛ける    
    outSamples[i]=Math.floor(fsample); // 整数にする
  }
  return outSamples;
}

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // 再生用バッファの残り量を調べる
  const used=NativeAudio.getPlayBufferUsed();
  if(used<4096) {
    // 残り量が少ない場合は音を4096サンプルづつ生成する
    const samples=generate(4096);
    NativeAudio.pushSamplesForPlay(samples);
    console.log("pushed samples:",samples.length,new Date());
  }
  
},25);



