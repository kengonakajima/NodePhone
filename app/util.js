const assert = require("assert");
const fs = require('fs');

// AEC3 
const aec3 = require('./aec3.js');
let aec3Wrapper={ initialized: false, freq: 32000 };
aec3.onRuntimeInitialized = () => {
  console.log("aec3.onRuntimeInitialized called");
  aec3Wrapper.init=aec3.cwrap("aec3_init","void",["number","number","number"]);
  aec3Wrapper.debug_print=aec3.cwrap("aec3_debug_print","void",[]);
  aec3Wrapper.get_metrics_echo_return_loss_enhancement=aec3.cwrap("aec3_get_metrics_echo_return_loss_enhancement","number",[]);
  aec3Wrapper.get_metrics_delay_ms=aec3.cwrap("aec3_get_metrics_delay_ms","number",[]);
  aec3Wrapper.get_voice_probability=aec3.cwrap("aec3_get_voice_probability",[]);
  aec3Wrapper.notify_key_pressed=aec3.cwrap("aec3_notify_key_pressed",["number"]);
  aec3Wrapper._update_ref_frame=aec3.cwrap("aec3_update_ref_frame","void",["number","number"]);
  aec3Wrapper.ensureWorkmem = function() {
    if(this.workmem)return;
    assert(this.freq>0);
    assert(this.samples_per_frame>0);    
    this.workmem = aec3._malloc(this.samples_per_frame*2);
    return this.workmem;
  }
  aec3Wrapper.update_ref_frame = function(i16ary) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }
    this.ensureWorkmem();
    aec3.HEAP16.set(i16ary, this.workmem/Int16Array.BYTES_PER_ELEMENT);
    this._update_ref_frame(this.workmem,this.samples_per_frame);
  }
  aec3Wrapper._update_rec_frame=aec3.cwrap("aec3_update_rec_frame","void",["number","number"]);  
  aec3Wrapper.update_rec_frame = function(i16ary) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }    
    aec3.HEAP16.set(i16ary, this.workmem/2);
    this._update_rec_frame(this.workmem,this.samples_per_frame);
  }
  aec3Wrapper._process=aec3.cwrap("aec3_process","void",["number","number","number","number"]);  
  aec3Wrapper.process = function(ms,i16ary,ns) {
    if(!this.initialized) {
      console.log("aec3 not init");
      return;
    }    
    aec3.HEAP16.set(i16ary, this.workmem/2);
    this._process(ms,this.workmem,this.samples_per_frame,ns);
    const data=aec3.HEAP16.subarray(this.workmem/2,this.workmem/2+this.samples_per_frame);
    for(let i=0;i<this.samples_per_frame;i++)i16ary[i]=data[i];
  }
  aec3Wrapper.debug_print();
  assert(aec3Wrapper.freq==16000 || aec3Wrapper.freq==32000 || aec3Wrapper.freq==48000);
  aec3Wrapper.init(4,0,1,aec3Wrapper.freq); // NS level 4, no loopback, vad=on
  aec3Wrapper.initialized=true;  
  
}
aec3Wrapper.setFrequency = function(freq) {
  this.freq=freq;
  this.samples_per_frame=Math.floor(freq/100);
  console.log("aec3Wrapper.setFrequency:",freq);
}

// PortAudio
const majorVersion = parseInt(process.version.split('.')[0].substring(1), 10);
assert(majorVersion>=21); // 添付のモジュールはnode 21でコンパイルされている
let PortAudio=null;
if(process.platform=='darwin') {
    PortAudio = require('./PAmac.node');
} else if(process.platform=='win32') {
    PortAudio = require('./PAwin.node');
} else {
  console.log("TODO");
  assert(false);
}

// Opus
let opusPath=null;
if(process.platform=='darwin') {
  opusPath='./opusmac.node';
} else if(process.platform=='win32') {
  opusPath='./opuswin.node';
} else {
  console.log("TODO: not implemented yet");
  process.exit(1);
}

const {OpusEncoder} = require(opusPath);

// "******      " のような文字列を返す
function getVolumeBar(l16sample) {
  const vol=Math.abs(l16sample) || 0;
  const bar = vol / 1024;
  const space = 32-bar;
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

function appendBinaryToFile(fileName, array) {
  // 配列をバッファに変換
  const buffer = Buffer.from(array.buffer);

  // ファイルにバッファを追記
  fs.appendFileSync(fileName, buffer);
}

function to_f(s) {
  return s/32767.0;
}
function to_s(f) {
  return Math.round(f * 32767);
}

function to_f_array(s_ary) {
  const out=new Float32Array(s_ary.length);
  for(let i=0;i<s_ary.length;i++) {
    out[i]=to_f(s_ary[i]);
  }
  return out;
}
function to_s_array(f_ary) {
  const out=new Int16Array(f_ary.length);
  for(let i=0;i<f_ary.length;i++) {
    out[i]=to_s(f_ary[i]);
  }
  return out;  
}
function calcMse(signal) {
  let sumSquared = 0;
  for (let i = 0; i < signal.length; i++) {
    sumSquared += signal[i] * signal[i];
  }
  return sumSquared / signal.length;
}

function save_f(buf, path) {
  const n = buf.length;
  const sb = new Int16Array(n);

  for (let i = 0; i < n; i++) {
    sb[i] = to_s(buf[i]);
  }

  fs.writeFileSync(path, Buffer.from(sb.buffer));
}
function append_f(buf,path) {
  const n = buf.length;
  const sb = new Int16Array(n);

  for (let i = 0; i < n; i++) {
    sb[i] = to_s(buf[i]);
  }

  appendBinaryToFile(path,sb);
}

function rm(path) {
  try {
   fs.unlinkSync(path); 
  }catch(e) {
    
  }
}

function calcERLE(inputSignal, outputSignal) {
  const inputPower = calcAveragePower(inputSignal);
  const residualEchoPower = calcAveragePower(outputSignal);
  
  const erle = 10 * Math.log10(inputPower / residualEchoPower);
  return erle;
}

function calcAveragePower(signal) {
  const sum = signal.reduce((acc, sample) => acc + sample ** 2, 0);
  const averagePower = sum / signal.length;
  return averagePower;
}

function padNumber(number, width, paddingChar = ' ') {
  return number.toString().padStart(width, paddingChar);
}
function totMag(a,b) {
  let tot=0;
  for(let i=0;i<a.length;i++) {
    const d=a[i]-b[i];
    tot+=d*d;
  }
  return tot;
}

// {re,im}
function fft(x) {
  const n = x.length;

  if (n === 1) {
    return x;
  }

  const even = [];
  const odd = [];

  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) {
      even.push(x[i]);
    } else {
      odd.push(x[i]);
    }
  }

  const evenFFT = fft(even);
  const oddFFT = fft(odd);

  const result = new Array(n);

  for (let k = 0; k < n / 2; k++) {
    const angle = -2 * Math.PI * k / n;
    const twiddle = {
      re: Math.cos(angle),
      im: Math.sin(angle)
    };

    const t = {
      re: twiddle.re * oddFFT[k].re - twiddle.im * oddFFT[k].im,
      im: twiddle.re * oddFFT[k].im + twiddle.im * oddFFT[k].re
    };

    result[k] = {
      re: evenFFT[k].re + t.re,
      im: evenFFT[k].im + t.im
    };

    result[k + n / 2] = {
      re: evenFFT[k].re - t.re,
      im: evenFFT[k].im - t.im
    };
  }

  return result;
}

// {re,im}
function ifft(x) {
  const n = x.length;

  // FFTの結果を複素共役にする
  const conjugate = x.map(({ re, im }) => ({ re, im: -im }));

  // 複素共役に対してFFTを適用する
  const fftResult = fft(conjugate);

  // 結果を実数部のみにして、大きさをn倍する
  const result = fftResult.map(({ re }) => re / n);

  return result;
}

function fft_f(floats) {
  const n=floats.length;
  const g=to_c_array(floats);
  console.log("g:",g);
  const G=fft(g);
  return G;
}

// float to {re,im}
function to_c_array(floats) {
  const out=new Array(floats.length);
  for(let i=0;i<floats.length;i++) out[i]={ re: floats[i], im:0 };
  return out;
}

exports.getMaxValue=getMaxValue;
exports.createJitterBuffer=createJitterBuffer;
exports.aec3Wrapper = aec3Wrapper;
exports.getVolumeBar = getVolumeBar;
exports.PortAudio = PortAudio;
exports.OpusEncoder = OpusEncoder;
exports.appendBinaryToFile = appendBinaryToFile;
exports.to_f=to_f;
exports.to_s=to_s;
exports.to_f_array=to_f_array;
exports.to_s_array=to_s_array;
exports.calcMse = calcMse;
exports.save_f = save_f;
exports.append_f = append_f;
exports.rm=rm;
exports.calcERLE = calcERLE;
exports.calcAveragePower = calcAveragePower;
exports.padNumber=padNumber;
exports.totMag=totMag;
exports.fft=fft;
exports.ifft=ifft;
exports.to_c_array=to_c_array;
exports.fft_f=fft_f;
