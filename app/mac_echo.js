const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-napi');


const int = ref.types.int;
const short = ref.types.short;
const ShortArray = ArrayType(short);


// initSampleBuffers
// startMic
// startSpeaker

// int getRecordedSampleCount() 
// short getRecordedSample(int index) 
// void pushSamplesForPlay(short *samples, int num) 


const macNative = ffi.Library('./NativeAudioMac.dylib', {
  'initSampleBuffers': ['void', []],
  'startMic': ['void', []],
  'startSpeaker': ['void', []],
  'getRecordedSampleCount': [int, []],
  'getRecordedSample': [short,[int]],
  'pushSamplesForPlay': ['void', [ShortArray,int]]  
});
console.log("macNative ok");
macNative.initSampleBuffers();
macNative.startMic();
macNative.startSpeaker();

setInterval(function() {
  const recnum=macNative.getRecordedSampleCount();
  const samples=[];
  for(let i=0;i<recnum;i++) {
    const sample=macNative.getRecordedSample(i);
    samples.push(sample);
  }
//  シフトせんならんのちゃう
  console.log("recnum:",recnum,"l:",samples.length);
  const sa = new ShortArray(samples);
  macNative.pushSamplesForPlay(sa,sa.length);

},50);


