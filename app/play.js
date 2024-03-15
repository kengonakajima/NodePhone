const freq=24000; // サンプリング周波数
const {PortAudio,appendBinaryToFile} = require('./util.js');
PortAudio.initSampleBuffers(freq,freq); //PortAudioを初期化
PortAudio.startSpeaker(); // スピーカー起動

const hz=220; // 生成する音の周波数
const dt=Math.PI * 2 * hz / freq; // 1サンプルあたりの時間差
let t=0;    // 音波を生成する際の時刻カウンター

const st=new Date().getTime(); // 開始時刻
// 25ミリ秒に1回繰り返す
setInterval(()=>{
  const curt=new Date().getTime(); // 現在時刻
  const elt=curt-st; // 経過時間
  // 再生用バッファの残り量を調べる
  const used=PortAudio.getPlayBufferUsed();
  // 残り量が少ない場合はサイン波を4096サンプルづつ生成する
  const n=4096*4;
  if(used>=n) return;
  const samples=new Int16Array(n);
  for(let i=0;i<n;i++) { 
    const y=Math.sin(t); // sinの値を求める
    const sample=y*20000; // 振幅を掛ける    
    samples[i]=sample;//Math.floor(sample); // 整数にする
    t += dt; // 1サンプル分の時間を進める
  }
  PortAudio.pushSamplesForPlay(samples);
//  appendBinaryToFile("played.raw",samples);
},25);




