const aec3 = require('./aec3.js');

const FREQ=48000;
const SAMPLES_PER_FRAME=FREQ/100;


let aec3Wrapper={ initialized: false};
aec3.onRuntimeInitialized = () => {
  aec3Wrapper.workmem=aec3._malloc(2*SAMPLES_PER_FRAME);
  aec3Wrapper.init=aec3.cwrap("aec3_init","void",["number","number"]);
  aec3Wrapper.debug_print=aec3.cwrap("aec3_debug_print","void",[]);
  aec3Wrapper.get_metrics_echo_return_loss_enhancement=aec3.cwrap("aec3_get_metrics_echo_return_loss_enhancement","number",[]);
  aec3Wrapper.get_metrics_delay_ms=aec3.cwrap("aec3_get_metrics_delay_ms","number",[]);
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
  aec3Wrapper.init(4,0);
  aec3Wrapper.initialized=true;  
}

// "******      " のような文字列を返す
function getVolumeBar(l16sample) {
  const vol=Math.abs(l16sample);
  const bar = vol / 1024;
  const space = 32-bar;
  return "*".repeat(bar)+" ".repeat(space); 
}

exports.FREQ = FREQ;
exports.SAMPLES_PER_FRAME = SAMPLES_PER_FRAME;
exports.aec3Wrapper = aec3Wrapper;
exports.getVolumeBar = getVolumeBar;
