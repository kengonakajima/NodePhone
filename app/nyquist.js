const {NativeAudio} = require('./util.js');
// ナイキスト周波数の影響を体験するため、わざと低い周波数を指定する
const freq=8000; 
NativeAudio.initSampleBuffers(freq,freq);
NativeAudio.startSpeaker();

let t=0;    // 音波を生成する際の時刻カウンター
let dt=Math.PI/20.0; // サンプルあたりtの増分

// サイン波を生成する。sampleNum: 生成するサンプル数
function generate(sampleNum) {
  dt+=Math.PI/16; // tの増分を増やす(音の周波数を少し高くする)
  const hz=dt*freq/Math.PI/2.0; // 周波数を計算する
  const nyquist=freq/2; // 再生周波数が24000なので、その半分の12000Hzがナイキスト周波数
  const over=(hz>=nyquist);  // ナイキスト周波数を超えているか？
  console.log("Freq:",freq,"NyquistHz:",nyquist,"CurrentHz:",Math.floor(hz),"Over-nyquist:",over); 
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
  // 再生用バッファの残り量を調べる
  const used=NativeAudio.getPlayBufferUsed();
  // 残り量が減ったら、次のサンプルを生成する
  if(used<2048) {
    const samples=generate(2048);
    NativeAudio.pushSamplesForPlay(samples);
  }
},25);







