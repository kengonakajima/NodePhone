const {NativeAudio} = require('./util.js');
const freq=48000;
NativeAudio.initSampleBuffers(freq,freq);
NativeAudio.startMic();
NativeAudio.startSpeaker();

// "******      " のような文字列を返す
function getVolumeBar(l16sample) {
  const vol=Math.abs(l16sample);
  const bar = vol / 1024;
  const space = 32-bar;
  return "*".repeat(bar)+" ".repeat(space); 
}

let g_maxSample=0;
setInterval(()=>{
  const samples=NativeAudio.getRecordedSamples();
  // 最大音量を記録
  g_maxSample=0;
  for(let i=0;i<samples.length;i++) {
    const sample=samples[i];    
    if(sample>g_maxSample) g_maxSample=sample; 
  }
  console.log("volume:",getVolumeBar(g_maxSample));
  NativeAudio.pushSamplesForPlay(samples);
  NativeAudio.discardRecordedSamples(samples.length);  
},25);

