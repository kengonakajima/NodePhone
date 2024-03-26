const {PortAudio,getVolumeBar} = require('./util.js');
const freq=48000;
PortAudio.initSampleBuffers(freq,freq);
PortAudio.startMic();
PortAudio.startSpeaker();

let g_maxSample=0;
setInterval(()=>{
  const samples=PortAudio.getRecordedSamples();
  // 最大音量を記録
  g_maxSample=0;
  for(let i=0;i<samples.length;i++) {
    const sample=samples[i];    
    if(sample>g_maxSample) g_maxSample=sample; 
  }
  console.log("volume:",getVolumeBar(g_maxSample));
  PortAudio.pushSamplesForPlay(samples);
  PortAudio.discardRecordedSamples(samples.length);  
},25);

