const addon = require('./build/Release/NativeAudio.node');
addon.initSampleBuffers(32000);
let r=addon.startMic();
console.log("startMic ret:",r);
r=addon.startSpeaker();
console.log("startSpeaker ret:",r);

// "******      " のような文字列を返す
function getVolumeBar(l16sample) {
  const vol=Math.abs(l16sample);
  const bar = vol / 1024;
  const space = 32-bar;
  return "*".repeat(bar)+" ".repeat(space); 
}

let g_maxSample=0;
setInterval(()=>{
  const samples=addon.getRecordedSamples();
  // 最大音量を記録
  g_maxSample=0;
  for(let i=0;i<samples.length;i++) {
    const sample=samples[i];    
    if(sample>g_maxSample) g_maxSample=sample; 
  }
  console.log("volume:",getVolumeBar(g_maxSample));
  addon.pushSamplesForPlay(samples);
  addon.discardRecordedSamples(samples.length);  
},25);

