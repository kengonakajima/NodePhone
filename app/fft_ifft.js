/*
  FFT,IFFTのテスト
*/

const {
  loadWAVFileSync,
  firFilter,
  firFilterFFT,
  to_f_array,
  to_s_array,
  calcAveragePower,
  findMax,
  save_f,
  plotArrayToImage,
  fft_f,
  ifft_f
}=require("./util.js");


const sampleRate=24000;
const chunk=loadWAVFileSync("counting24k.wav");  // 元のデータ。これが再生用データ

const unit=2048;
const start=47000; //「さん」の途中のところ

const to_fft_i=new Int16Array(unit);
for(let i=0;i<unit;i++) to_fft_i[i]=chunk[start+i];
const to_fft_f=to_f_array(to_fft_i);

const X=fft_f(to_fft_f);
const x=ifft_f(X);

save_f(x,"fft_ifft_rect.wav",sampleRate);
save_f(to_fft_f,"fft_ifft_orig.wav",sampleRate);
console.log("x:",x);
console.log("orig:",to_fft_f);

// ほぼ同じ結果になる。
