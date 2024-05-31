/*
  FFT,IFFTのテスト
*/

const {
  loadLPCMFileSync,
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


const chunk=loadLPCMFileSync("counting24k.lpcm");  // 元のデータ。これが再生用データ

const unit=2048;
const start=47000; //「さん」の途中のところ

const to_fft_i=new Int16Array(unit);
for(let i=0;i<unit;i++) to_fft_i[i]=chunk[start+i];
const to_fft_f=to_f_array(to_fft_i);

const X=fft_f(to_fft_f);
const x=ifft_f(X);

save_f(x,"fft_ifft_rect.lpcm");
save_f(to_fft_f,"fft_ifft_orig.lpcm");
console.log("x:",x);
console.log("orig:",to_fft_f);

// ほぼ同じ結果になる。
