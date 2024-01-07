const {NativeAudio} = require('./util.js');
const freq=48000;
NativeAudio.initSampleBuffers(freq,freq);
NativeAudio.startSpeaker();

let t=0;    // 音波を生成する際の時刻カウンター

// サイン波を生成する。sampleNum: 生成するサンプル数
function generate(sampleNum) {
  // 必要なサンプリングデータの数だけループさせる
  const outSamples=new Int16Array(sampleNum);
  for(let i=0;i<sampleNum;i++) { 
    t += Math.PI/16.0; // 1サンプルごとに時間を進める(2PI=3.14*2=6.28進めると1周期)
    const y=Math.sin(t); // sinの値を求める
    const fsample=y*20000; // 振幅を掛ける    
    outSamples[i]=Math.floor(fsample); // 整数にする
  }
  return outSamples;
}

setInterval(()=>{
  const used=NativeAudio.getPlayBufferUsed();
  if(used<4096) {
    const samples=generate(4096);
    NativeAudio.pushSamplesForPlay(samples);
    console.log("pushed samples:",samples.length,new Date());
  }
  
},25);



