const addon = require('./build/Release/NativeAudio.node');

console.log(addon.initSampleBuffers());
addon.listDevices();


let r=addon.startMic();
console.log("startMic ret:",r);
r=addon.startSpeaker();
console.log("startSpeaker ret:",r);

let ary = new Int16Array(512);
let t=0;
for(let i=0;i<ary.length;i++) {
  t=t+0.1;
  ary[i]=Math.sin(t)*10000;
}

addon.pushSamplesForPlay(ary);

setInterval(()=>{
  const samples=addon.getRecordedSamples();
  console.log("samples:",samples.length);
  addon.pushSamplesForPlay(samples);
  addon.discardRecordedSamples(samples.length);
  
  
},100);

