const {PortAudio,getVolumeBar} = require('./util.js');
const freq=48000;
PortAudio.initSampleBuffers(freq,freq);
PortAudio.startMic();
PortAudio.startSpeaker();

setInterval(()=>{
  const samples=PortAudio.getRecordedSamples();
  // 最大音量を記録
  let maxSample=0;
  for(let i=0;i<samples.length;i++) {
    const sample=samples[i];    
    if(sample>maxSample) maxSample=sample; 
  }
  console.log("volume:",getVolumeBar(maxSample));
  PortAudio.pushSamplesForPlay(samples);
  PortAudio.discardRecordedSamples(samples.length);  
},25);

