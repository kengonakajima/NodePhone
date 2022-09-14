const aec3 = require('./aec3.js');

const FREQ=48000;
const SAMPLES_PER_FRAME=FREQ/100;


let aec3Wrapper={ initialized: false};
aec3.onRuntimeInitialized = () => {
  aec3Wrapper.workmem=aec3._malloc(2*SAMPLES_PER_FRAME);
  aec3Wrapper.init=aec3.cwrap("aec3_init","void",["number","number","number"]);
  aec3Wrapper.debug_print=aec3.cwrap("aec3_debug_print","void",[]);
  aec3Wrapper.get_metrics_echo_return_loss_enhancement=aec3.cwrap("aec3_get_metrics_echo_return_loss_enhancement","number",[]);
  aec3Wrapper.get_metrics_delay_ms=aec3.cwrap("aec3_get_metrics_delay_ms","number",[]);
  aec3Wrapper.get_voice_probability=aec3.cwrap("aec3_get_voice_probability",[]);
  aec3Wrapper.notify_key_pressed=aec3.cwrap("aec3_notify_key_pressed",["number"]);
  aec3Wrapper.update_ref_frame=aec3.cwrap("aec3_update_ref_frame","void",["number","number"]);  
  aec3Wrapper.update_ref_frame_wrapped = function(i16ary) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }
    aec3.HEAP16.set(i16ary, this.workmem/Int16Array.BYTES_PER_ELEMENT);
    this.update_ref_frame(this.workmem,SAMPLES_PER_FRAME);
  }
  aec3Wrapper.update_rec_frame=aec3.cwrap("aec3_update_rec_frame","void",["number","number"]);  
  aec3Wrapper.update_rec_frame_wrapped = function(i16ary) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }    
    aec3.HEAP16.set(i16ary, this.workmem/2);
    this.update_rec_frame(this.workmem,SAMPLES_PER_FRAME);
  }
  aec3Wrapper.process=aec3.cwrap("aec3_process","void",["number","number","number","number"]);  
  aec3Wrapper.process_wrapped = function(ms,i16ary,ns) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }    
    aec3.HEAP16.set(i16ary, this.workmem/2);
    this.process(ms,this.workmem,SAMPLES_PER_FRAME,ns);
    const data=aec3.HEAP16.subarray(this.workmem/2,this.workmem/2+SAMPLES_PER_FRAME);
    for(let i=0;i<SAMPLES_PER_FRAME;i++)i16ary[i]=data[i];
  }
  
  aec3Wrapper.debug_print();
  aec3Wrapper.init(4,0,1); // NS level 4, no loopback, vad=on
  aec3Wrapper.initialized=true;  
}

// "******      " のような文字列を返す
function getVolumeBar(l16sample) {
  const vol=Math.abs(l16sample) || 0;
  const bar = vol / 512;
  const space = 64-bar;
  return "*".repeat(bar)+" ".repeat(space); 
}


function createJitterBuffer(jitter) {
  const b={};
  b.samples=[]; // i16le
  b.jitter=jitter;
  b.needJitter=true;
  b.push=function(sample) {
    this.samples.push(sample);
    if(this.needJitter && this.samples.length>this.jitter) {
      console.log("jitterbuffer: filled jitter:",this.jitter);
      this.needJitter=false;
    }
  }
  b.shift=function() {
    return this.samples.shift();
  }
  b.clear=function() {
    this.samples=[];
  }
  b.used=function(){return this.samples.length;}
  return b;
}

function getMaxValue(ary){
  let maxv=-9999999;
  for(let i in ary) {
    if(ary[i]>maxv) maxv=ary[i];
  }
  return maxv;
}

exports.getMaxValue=getMaxValue;
exports.createJitterBuffer=createJitterBuffer;
exports.FREQ = FREQ;
exports.SAMPLES_PER_FRAME = SAMPLES_PER_FRAME;
exports.aec3Wrapper = aec3Wrapper;
exports.getVolumeBar = getVolumeBar;
