const assert = require("assert");
const fs = require('fs');
const { createCanvas } = require('canvas');


// AEC3 
const aec3 = require('./aec3.js');
let aec3Wrapper={ initialized: false, freq: 32000 };
aec3.onRuntimeInitialized = () => {
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
    this.workmem = aec3._aec3_malloc(this.samples_per_frame*2);
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
//  aec3Wrapper.debug_print();
  assert(aec3Wrapper.freq==16000 || aec3Wrapper.freq==32000 || aec3Wrapper.freq==48000);
  aec3Wrapper.init(/*ns*/0,/*loopback*/0,/*vad*/0,aec3Wrapper.freq); 
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
  let space = 32-bar;
  if(space<0) space=0;
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
  if(ary.length==0) return 0;
  let maxv=0;
  for(let i=0;i<ary.length;i++) {
    if(ary[i]>Math.abs(maxv)) maxv=Math.abs(ary[i]);
  }
  return maxv;
}

function appendBinaryToFile(fileName, array) {
  const buffer = Buffer.from(array.buffer);
  fs.appendFileSync(fileName, buffer);
}
function writeBinaryToFile(fileName, array) {
  const buffer = Buffer.from(array.buffer);
  fs.writeFileSync(fileName, buffer);
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

// aec3形式の、-32768~32768までのfloat値の配列をlpcmで保存する
function save_fs(buf,path) {
  const n = buf.length;
  const sb = new Int16Array(n);

  for (let i = 0; i < n; i++) {
    sb[i] = Math.floor(buf[i]);
  }
  fs.writeFileSync(path, Buffer.from(sb.buffer));
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
function calcAveragePowerComplex(fftResult) {
  const sum = fftResult.reduce((acc, { re, im }) => acc + re ** 2 + im ** 2, 0);
  const averagePower = sum / fftResult.length;
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

  return fftResult;
}
function ifft_f(x) {
  const o=ifft(x);
  // 結果を実数部のみにして、大きさをn倍する
  const result = o.map(({ re }) => re / x.length);
  return result;
}

function fft_f(floats) {
  const n=floats.length;
  const g=to_c_array(floats);
  const G=fft(g);
  return G;
}

// C[65]を C[128]に変換する。
function fromFftData(fftData) {
  const out=createComplexArray(128);
  for(let i=0;i<65;i++) out[i]=fftData[i];
  for(let i=0;i<63;i++) out[64+i]={re: fftData[63-i].re, im: fftData[63-i].im * -1 };
  return out;  
}

// C[128]を C[65]に変換する
function toFftData(fftResult) {
  if(fftResult.length!=128) throw "invalid_size_toFftData";
  return fftResult.slice(0,65);
}
// 時間領域64個(floats)を2つ受け取って128のFFTをし、先頭の65個を返す
function paddedFft(x,x_old) {
  if(!(x instanceof Float32Array)) throw "invalid_type_x_paddedFft";
  if(!(x_old instanceof Float32Array)) throw "invalid_type_x_old_paddedFft";  
  if(x.length!=64) throw "invalid_size_x_paddedFft";
  if(x_old.length!=64) throw "invalid_size_x_old_paddedFft";
  const x_=f2cArray(x);
  const x_old_=f2cArray(x_old);
  const data=[];
  for(let i=0;i<64;i++) {
    data[i]=x_old_[i];
    data[i+64]=x_[i];
  }
  return toFftData(fft(data));
}
// x: float[64] 前半は0,後半はxを入れるが、ハニング窓[64]をかける。
function zeroPaddedHanningFft(x) {
  if(!(x instanceof Float32Array)) throw "invalid_type_zeroPaddedHanningFft";  
  if(x.length!=64) throw "invalid_size_zeroPaddedHanningFft";  
  const data=createComplexArray(128);
  for(let i=0;i<64;i++) {
    data[i].re=0;
    data[i+64].re=x[i] * kHanning64[i];
  }
  //console.log("data:",data.join(","),kHanning64);
  return toFftData(fft(data));
}
// X: C[N]
function calcSpectrum(X) {
  const out=new Float32Array(X.length);
  for(let i=0;i<X.length;i++) {
    out[i]= X[i].re * X[i].re + X[i].im * X[i].im;
  }
  return out;
}
function fft_to_s(fft) {
  const a=[];
  for(const c of fft) a.push(`(${c.re},${c.im})`);
  return a.join(",");
}

// float to {re,im}
function to_c_array(floats) {
  const out=new Array(floats.length);
  for(let i=0;i<floats.length;i++) out[i]={ re: floats[i], im:0 };
  return out;
}

function energyBar(s,num,scale=1) {
  const out=[];
  for(let i=0;i<num;i++) out[i]=' ';
  const step=s.length/num;  
  for(let i=0;i<s.length;i++) {
    const outi=parseInt(i/step);
    let e=s[i] * scale;
    if(e<0)e*=-1;
    if(e>out[outi])out[outi]=e;
  }
  for(let i=0;i<num;i++) {
    if(out[i]>1) out[i]='*';
    else if(out[i]>0.5) out[i]='+';
    else if(out[i]>0.2) out[i]='-';
    else if(out[i]>0.05) out[i]='.';
    else out[i]=' ';
  }
  
  return out.join("");
  
}
function spectrumBar(s,num,scale=1) {
  const out=[];
  for(let i=0;i<num;i++) out[i]=' ';
  const step=s.length/num;  
  for(let i=0;i<s.length;i++) {
    const outi=parseInt(i/step);
    let e=s[i].re * scale;
    if(e<0)e*=-1;
    if(e>out[outi])out[outi]=e;
  }
  for(let i=0;i<num;i++) {
    if(out[i]>1) out[i]='*';
    else if(out[i]>0.5) out[i]='+';
    else if(out[i]>0.2) out[i]='-';
    else if(out[i]>0.05) out[i]='.';
    else out[i]=' ';
  }
  
  return out.join("");
}

// 複素数の足し算
function addComplex(a, b) {
  return {
    re: a.re + b.re,
    im: a.im + b.im
  };
}

// 複素数の掛け算
function multiplyComplex(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re
  };
}

function multiplyComplexArray(a, b) {
  const result = [];
  for (let i = 0; i < a.length; i++) {
    const re = a[i].re * b[i].re - a[i].im * b[i].im;
    const im = a[i].re * b[i].im + a[i].im * b[i].re;
    result.push({re,im});
  }
  return result;
}


// 複素数の指数関数
function expComplex(c) {
  const expReal = Math.exp(c.re);
  return {
    re: expReal * Math.cos(c.im),
    im: expReal * Math.sin(c.im)
  };
}

function conjugate(complexArray) {
  for(let i=0;i<complexArray.length;i++) complexArray[i]={re: complexArray[i].re, im: complexArray[i].im*-1} ;
  return complexArray;
}


// x軸:時間 y軸:要素 
function drawSpectrogram(data_list,outputFilename,scale=1) {

  const pxSz=4;

  const outDataList=[];
  for(const data of data_list) {
    const outData=new Float32Array(data.length);
    for(let i=0;i<data.length;i++) outData[i]=data[i]*scale;
    outDataList.push(outData);
  }
  const height=data_list[0].length*pxSz;
  const width=data_list.length*pxSz;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle='black';
  ctx.fillRect(0,0,width,height);

  for(let x=0;x<outDataList.length;x++) {
    for(let y=0;y<outDataList[0].length;y++) {
      const data=outDataList[x][y];
      let val=Math.floor(data*256);
      if(val>255) val=255;
      const hex=val<16 ? "0"+val.toString(16) : val.toString(16);
      ctx.fillStyle=`#${hex}${hex}${hex}`;
      ctx.fillRect(x*pxSz,y*pxSz,pxSz,pxSz);
    }
  }
  // 画像をファイルに保存
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputFilename, buffer);
  
  
}
function plotArrayToImage(data_list, width, height, outputFilename,scale=1) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const outDataList=[];
  for(const data of data_list) {
    const outData=new Float32Array(data.length);
    for(let i=0;i<data.length;i++) outData[i]=data[i]*scale;
    outDataList.push(outData);
  }

  
  // 背景を白で塗りつぶす
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // グラフの軸を描画
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(50, 0);
  ctx.lineTo(50, height/2);
  ctx.lineTo(width - 20, height/2);
  ctx.stroke();

  const colors=['red','green','blue','orange','purple','black','gray'];
  // データをプロット
  const l=outDataList[0].length;  
  for(let di=0;di<outDataList.length;di++) {
    const data=outDataList[di];
    ctx.strokeStyle = colors[di];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(50, height/2 - (data[0] * (height/2)));
    for (let i = 1; i < l; i++) {
      const d=data[i]||0;
      const x = 50 + (i * (width - 70) / (l - 1));
      const y = height/2 - (d * (height/2));
      if(y>=0 && y<=height && x>=0 && x<=width) ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  
  // 画像をファイルに保存
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputFilename, buffer);
}


function loadLPCMFileSync(path,chunkSize) {
  const fileData = fs.readFileSync(path);
  if(!chunkSize) {
    return new Int16Array(fileData.buffer);
  } else { 
    const numSamples = fileData.length / 2; 
    const numChunks = Math.ceil(numSamples / chunkSize);
    const out=[];
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize * 2;
      const end = Math.min(start + chunkSize * 2, fileData.length);
      const chunkData = fileData.slice(start, end);
      const audioData = new Int16Array(chunkData.buffer, chunkData.byteOffset, chunkData.length / 2);
      out.push(audioData);
    }
    return out;
  }
}


// FIRフィルタの処理関数
function firFilterSingle(inputSignal,startIndex,coefs) {
  let output = 0;
  // 畳み込み演算
  for (let i = 0; i < coefs.length; i++) {
    const signalIndex = startIndex - i;
    if (signalIndex >= 0) {
      output += coefs[i] * inputSignal[signalIndex];
    }
  }
  return output;
}
function firFilter(inputSignal,coefs,N) {
  if(inputSignal.length<N || coefs.length!=N){
    console.log("invalid len:",inputSignal.length,coefs.length);
    throw "invalid_arg";
  }
  const filtered=new Float32Array(N);
  const n=coefs.length;
  for(let i=0;i<N;i++) filtered[i]=firFilterSingle(inputSignal,i,coefs);
  return filtered;
}

function firFilterFFT(inputSignal, filterCoefficients, N) {
  if(inputSignal.length!=N || filterCoefficients.length!=N ) throw "input_length_error";

  let filteredSignal = new Array(inputSignal.length + N - 1).fill(0);

  const filterFFT = fft_f(filterCoefficients);

  const segmentStart = 0;
  const segmentEnd = Math.min(segmentStart + N, inputSignal.length);
  const segment = inputSignal.slice(segmentStart, segmentEnd);
  const paddedSegment = [...segment, ...new Array(N - segment.length).fill(0)];

  const segmentFFT = fft_f(paddedSegment);
  const filteredSegmentFFT = multiplyComplexArray(segmentFFT, filterFFT);
  const filteredSegment = ifft_f(filteredSegmentFFT);

  for (let j = 0; j < N; j++) {
    filteredSignal[segmentStart + j] += filteredSegment[j];
  }

  return filteredSignal.slice(0, inputSignal.length);
}
function findMax(array,skipTop=0) {
  let max=-999999;
  let out_ind=-1;
  for(let i=skipTop;i<array.length;i++) {
    if(array[i]>max) {
      out_ind=i;
      max=array[i];
    }
  }
  return {index: out_ind, value: max};
}

function findMaxSquare(array,skipTop=0) {
  let max=0;
  let out_ind=-1;
  for(let i=skipTop;i<array.length;i++) {
    const v=array[i]*array[i];
    if(v>max) {
      out_ind=i;
      max=v;
    }
  }
  return {index: out_ind, value: max};
}

function f2cArray(fa) {
  const ca=createComplexArray(fa.length);
  for(let i=0;i<fa.length;i++) ca[i].re=fa[i];
  return ca;
}
function createComplexArray(n) {
  const out=new Array(n);
  for(let i=0;i<n;i++) out[i]={re:0, im:0};
  return out;
}

function findMaxComplex(ary) {
  let max=-999999999;
  for(let i=0;i<ary.length;i++) {
    const v=ary[i].re * ary[i].re + ary[i].im * ary[i].im;
    if(v>max) max=v;
  }
  return max;
}

function calcPowerSpectrum(complexArray) {
  const out=new Float32Array(complexArray.length);
  for(let i=0;i<complexArray.length;i++) {
    out[i]=complexArray[i].re * complexArray[i].re + complexArray[i].im * complexArray[i].im;
  }
  return out;
}

function padNumber(number, width, paddingChar = ' ') {
  return number.toString().padStart(width, paddingChar);
}

function applyHannWindow(data) {
  const length = data.length;
  const hannWindow = new Float32Array(length);
  const out=new Float32Array(data.length);
  for(let i=0;i<data.length;i++) out[i]=data[i];

  // ハン窓の計算
  for (let i = 0; i < length; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1)));
  }

  // ハン窓をデータにかける
  for (let i = 0; i < length; i++) {
    out[i] *= hannWindow[i];
  }

  return out;
}

function highpassFilter(inputSignal, sampleRate, cutoffFrequency) {
  const RC = 1.0 / (2 * Math.PI * cutoffFrequency);
  const dt = 1.0 / sampleRate;
  const alpha = RC / (RC + dt);

  const outputSignal = new Float32Array(inputSignal.length);
  outputSignal[0] = inputSignal[0];

  for (let i = 1; i < inputSignal.length; i++) {
    outputSignal[i] = alpha * (outputSignal[i - 1] + inputSignal[i] - inputSignal[i - 1]);
  }

  return outputSignal;
}

// 整数個単位でのdecimate専用
function decimateFloat32Array(ary,factor) {
  const n=Math.floor(ary.length/factor);
  const out=new Float32Array(n);
  for(let i=0;i<n;i++)out[i]=ary[i*factor];
  return out;
}


// from aec3
const kHanning64 = [
  0,         0.00248461, 0.00991376, 0.0222136,  0.03926189,
  0.06088921, 0.08688061, 0.11697778, 0.15088159, 0.1882551,
  0.22872687, 0.27189467, 0.31732949, 0.36457977, 0.41317591,
  0.46263495, 0.51246535, 0.56217185, 0.61126047, 0.65924333,
  0.70564355, 0.75,       0.79187184, 0.83084292, 0.86652594,
  0.89856625, 0.92664544, 0.95048443, 0.96984631, 0.98453864,
  0.99441541, 0.99937846, 0.99937846, 0.99441541, 0.98453864,
  0.96984631, 0.95048443, 0.92664544, 0.89856625, 0.86652594,
  0.83084292, 0.79187184, 0.75,       0.70564355, 0.65924333,
  0.61126047, 0.56217185, 0.51246535, 0.46263495, 0.41317591,
  0.36457977, 0.31732949, 0.27189467, 0.22872687, 0.1882551,
  0.15088159, 0.11697778, 0.08688061, 0.06088921, 0.03926189,
  0.0222136,  0.00991376, 0.00248461, 0
];




exports.getMaxValue=getMaxValue;
exports.createJitterBuffer=createJitterBuffer;
exports.aec3Wrapper = aec3Wrapper;
exports.getVolumeBar = getVolumeBar;
exports.PortAudio = PortAudio;
exports.OpusEncoder = OpusEncoder;
exports.appendBinaryToFile = appendBinaryToFile;
exports.writeBinaryToFile = writeBinaryToFile;
exports.to_f=to_f;
exports.to_s=to_s;
exports.to_f_array=to_f_array;
exports.to_s_array=to_s_array;
exports.save_f = save_f;
exports.save_fs = save_fs;
exports.append_f = append_f;
exports.rm=rm;
exports.calcERLE = calcERLE;
exports.calcAveragePower = calcAveragePower;
exports.calcAveragePowerComplex = calcAveragePowerComplex;
exports.padNumber=padNumber;
exports.totMag=totMag;
exports.fft=fft;
exports.ifft=ifft;
exports.ifft_f=ifft_f;
exports.paddedFft=paddedFft;
exports.fft_to_s=fft_to_s;
exports.to_c_array=to_c_array;
exports.fft_f=fft_f;
exports.energyBar=energyBar;
exports.spectrumBar=spectrumBar;
exports.multiplyComplex=multiplyComplex;
exports.multiplyComplexArray=multiplyComplexArray;
exports.addComplex=addComplex;
exports.expComplex=expComplex;
exports.conjugate=conjugate;
exports.plotArrayToImage=plotArrayToImage;
exports.loadLPCMFileSync=loadLPCMFileSync;
exports.firFilter=firFilter;
exports.firFilterFFT=firFilterFFT;
exports.findMax=findMax;
exports.findMaxSquare=findMaxSquare;
exports.findMaxComplex=findMaxComplex;
exports.createComplexArray=createComplexArray;
exports.f2cArray=f2cArray;
exports.calcPowerSpectrum=calcPowerSpectrum;
exports.padNumber=padNumber;
exports.applyHannWindow=applyHannWindow;
exports.highpassFilter=highpassFilter;
exports.decimateFloat32Array=decimateFloat32Array;
exports.drawSpectrogram=drawSpectrogram;
exports.kHanning64=kHanning64
exports.zeroPaddedHanningFft=zeroPaddedHanningFft;
exports.calcSpectrum=calcSpectrum;
exports.fromFftData=fromFftData;
exports.toFftData=toFftData;
