const addon = require('./build/Release/NativeAudio.node');
addon.initSampleBuffers();
addon.listDevices();


let r=addon.startMic();
console.log("startMic ret:",r);
r=addon.startSpeaker();
console.log("startSpeaker ret:",r);


setInterval(()=>{
  const samples=addon.getRecordedSamples();
  console.log("samples:",samples.length);
  addon.pushSamplesForPlay(samples);
  addon.discardRecordedSamples(samples.length);
  
  
},100);

