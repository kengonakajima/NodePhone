const ffi = require('ffi-napi');
const ref = require('ref-napi');
const ArrayType = require('ref-array-napi');


const int = ref.types.int;
const short = ref.types.short;
const ShortArray = ArrayType(short);

const native = ffi.Library('./NativeAudioWin.dll', {
  'initSampleBuffers': ['void', []],
  'startMic': ['void', []],
  'startSpeaker': ['void', []],
  'getRecordedSampleCount': [int, []],
  'getRecordedSample': [short,[int]],
  'pushSamplesForPlay': ['void', [ShortArray,int]],
  'update': ['void', []],
  'stop': ['void', []],
});
console.log("native ok");
native.initSampleBuffers();
native.startMic();
native.startSpeaker();

setInterval(function() {
  const recnum=native.getRecordedSampleCount();
  const samples=[];
  for(let i=0;i<recnum;i++) {
    const sample=native.getRecordedSample(i);
    samples.push(sample);
  }
  console.log("recnum:",recnum,"l:",samples.length);
  const sa = new ShortArray(samples);
  native.pushSamplesForPlay(sa,sa.length);
  native.update()
},50);


