const addon = require('./build/Release/NativeAudio.node');
addon.initSampleBuffers();
addon.startSpeaker();

let t=0;    // 音波を生成する際の時刻カウンター
let dt=Math.PI/32.0; // サンプルあたりtの増分

// サイン波を生成する。sampleNum: 生成するサンプル数
function generate(sampleNum) {
  dt+=Math.PI/80; // tの増分を増やす(音の周波数を少し高くする)
  const hz=dt*24000/Math.PI/2.0; // 周波数を計算する
  const nyquist=24000/2; // 再生周波数が24000なので、その半分の12000Hzがナイキスト周波数
  const over=(hz>=nyquist);  // ナイキスト周波数を超えているか？
  console.log("CurrentHz:",Math.floor(hz),"NyquistHz:",nyquist,"Over-nyquist:",over); // 表示
  // 必要なサンプリングデータの数だけループさせる
  const outSamples=new Int16Array(sampleNum);
  for(var i=0;i<sampleNum;i++) { 
    t += dt; // 1サンプルごとに時間を進める(2PI=3.14*2=6.28進めると1周期)
    const y=Math.sin(t); // sinの値を求める
    const sample=y*20000; // 振幅を掛ける    
    outSamples[i]=Math.floor(sample); // 整数にする
  }
  return outSamples;
}

setInterval(()=>{
  const used=addon.getPlayBufferUsed();
  if(used<8192) {
    const samples=generate(8192);
    addon.pushSamplesForPlay(samples);
  }
},100);







