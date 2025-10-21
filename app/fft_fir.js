/*
  FFTベースのFIRフィルタのテスト
  完璧に期待通りに動く。
  
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
  ifft_f,
  createComplexArray
}=require("./util.js");


const sampleRate=24000;
const chunk=loadWAVFileSync("counting24k.wav");  // 元のデータ。これが再生用データ

const unit=2048;
const start=47000; //「さん」の途中のところ

const to_fft_i=new Int16Array(unit);
for(let i=0;i<unit;i++) to_fft_i[i]=chunk[start+i]; // 矩形窓
const to_fft_f=to_f_array(to_fft_i);

const X=fft_f(to_fft_f);

const H=createComplexArray(unit); // フィルタ係数,最初はぜんぶゼロ

// Hの値がすべて re:0, im:0　だったら、出力は0

//H[0]={re:1, im:0};
if(false) for(let i=0;i<unit;i++) H[i]={re:1, im:0}; // 全部このようにすると、完全に同じ音が再生される
if(false) for(let i=0;i<unit;i++) H[i]={re:1, im:-1}; //これでも完全に同じ値になる。
if(false) for(let i=0;i<unit;i++) H[i]={re:-1, im:0}; // これだと、振幅がさかさまになる。

if(false) H[unit/2]={re:1, im:0}; // これだと、データが全部0
if(false) H[1024]={re:2000, im:0}; // 12KHzのとこにピーク
if(false) H[512]={re:2000, im:0}; // 6KHzのとこにピーク
if(false) H[256]={re:2000, im:0}; // 3KHzのとこにピーク
if(false) H[128]={re:2000, im:0}; // 1.5KHzのとこにピーク。　完全にサイン波になる。


// このように2つのところに係数を入れると、2つのsin波が混じった音になる
if(true) {
  H[512]={re:1024, im:0};
  H[128]={re:1024, im:1000};
}






// FIRフィルタ
const S = X.map((x, i) => {
  const re = x.re * H[i].re - x.im * H[i].im;
  const im = x.re * H[i].im + x.im * H[i].re;
  return { re, im };
});


const s=ifft_f(S);

save_f(to_fft_f,"fft_ifft_orig.wav",sampleRate);

save_f(s,"fft_fir_out.wav",sampleRate);

console.log("orig:",to_fft_f);
console.log("s:",s);

const diff=new Float32Array(unit);
for(let i=0;i<unit;i++) diff[i]=s[i]-to_fft_f[i];
save_f(diff,"fir_filter_diff.wav",sampleRate);
