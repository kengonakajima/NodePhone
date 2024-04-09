const {PortAudio,getVolumeBar} = require('./util.js');
const freq=48000;
PortAudio.initSampleBuffers(freq,freq,512);
PortAudio.startMic();
PortAudio.startSpeaker();

setInterval(()=>{
  const samples=PortAudio.getRecordedSamples();
  // 最大音量を表示
  let maxSample=0;
  for(let i=0;i<samples.length;i++) {
    const sample=samples[i];    
    if(sample>maxSample) maxSample=sample; 
  }
  console.log("volume:",getVolumeBar(maxSample));
  PortAudio.discardRecordedSamples(samples.length);  
  PortAudio.pushSamplesForPlay(samples);
},25);

