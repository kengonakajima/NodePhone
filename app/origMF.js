/*
  matched filterを counting48kで4倍にダウンサンプリングし、
  パーティショニングせずに1049という遅延を推定できるか確認する。
  */
const {
  spectrumBar,
  energyBar,  
  getVolumeBar,
  findMaxSquare,
  findMax,
  plotArrayToImage,
  save_fs,
  getMaxValue,
  decimateFloat32Array,
  createComplexArray,
  loadLPCMFileSync,
  to_f,
  save_f,
  paddedFft,
  ifft,
  fft_f,
  ifft_f,
  f2cArray,
  fft_to_s,
  zeroPaddedHanningFft,
  calcSpectrum,
  fromFftData,
  toFftData,
  sumOfSquares,
  toIntArray
} = require('./util.js');

const freq=16000; 
const sampleNum=50000;
const downSampleRate=4;
const downSampleNum=Math.floor(sampleNum/4);
const filterSize=2048;

const played=loadLPCMFileSync("counting48k.lpcm").slice(0,sampleNum);  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("playRecCounting48k.lpcm16").slice(0,sampleNum);  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ


const played16k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) played16k[i]=played[i*downSampleRate];
const recorded16k=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) recorded16k[i]=recorded[i*downSampleRate];


// フィルタを使う必要があるのは、テンプレート信号がわかっていないからである。
// しかし元の情報は playedにあるはずなので、playedをそのままテンプレートとしたらどうなるのか?

function convolve_full(a, b) {
    // 理由: fullモードでは長さが len(a) + len(b) - 1 になる
    const c = new Array(a.length + b.length - 1).fill(0);
    // 理由: 定義上、全てのシフト位置で積和をとる必要がある
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            c[i + j] += a[i] * b[j];
        }
    }
    return c;
}


function smooth(data, windowSize = 30) {
  // 理由: 信号をなめらかにして主ピークを検出するために移動平均で平滑化する
  const smoothed = new Array(data.length).fill(0);
  const halfWin = Math.floor(windowSize/2);
  // 理由: ウィンドウ内の平均化でなめらかにする
  for(let i=0; i<data.length; i++){
    let sum=0;
    let count=0;
    for(let w=-halfWin; w<=halfWin; w++){
      const idx=i+w;
      if(idx>=0 && idx<data.length){
        sum += data[idx];
        count++;
      }
    }
    smoothed[i]=sum/count;
  }
  return smoothed;
}


const played16k_rev=new Float32Array(played16k.length);
for(let i=0;i<played16k.length;i++) played16k_rev[played16k.length-1-i]=played16k[i];

const result=convolve_full(played16k_rev,recorded16k);
for(let i=0;i<result.length;i++) result[i]=Math.abs(result[i]); // 絶対値にする

plotArrayToImage([result],8000,512,`plots/origmf_conv.png`,1/32768.0/32768.0/20);


let maxVal=0;
let maxInd=-1;
for(let i=0;i<result.length;i++) {
  if(result[i]>maxVal) {
    maxVal=result[i];
    maxInd=i;
  }
}


console.log("maxInd:",maxInd,"result.length:",result.length,"maxVal:",maxVal,"center:",result.length/2,"diff:",result.length/2 - maxInd);

const smoothed=smooth(result,50);
plotArrayToImage([smoothed],8000,512,`plots/origmf_conv_smoothed.png`,1/32768.0/32768.0/20);

maxVal=0;
maxInd=-1;

for(let i=0;i<result.length;i++) {
  if(smoothed[i]>maxVal) {
    maxVal=smoothed[i];
    maxInd=i;
  }
}

console.log("maxInd:",maxInd,"maxVal:",maxVal,"diff:",result.length/2 - maxInd);

process.exit(0);











// 信号はすべて s16
// x: 逆順のplayed信号[2048]
// y: 正順のrec信号 1サンプル
// h: フィルタ係数[2048] これがテンプレート信号
function processMF(x,y,h) {
  if(h.length!=filterSize) throw "invalid_h_len";
  if(x.length!=filterSize) throw "invalid_x_len";

  // 計算
  let errorSum=0; // 誤差信号のエネルギー
  let x2Sum=0; // xの信号の2乗和。xのエネルギー
  let s=0; // フィルタが推定した信号
  for(let i=0;i<h.length;i++) {
    x2Sum += x[i] * x[i];
    s += h[i] * x[i];
  }

  
  // 誤差信号を計算
  const smoothing=0.7;
  const x2SumThreshold=512 * 150 * 150; // 150は音量
  const e = y - s;
  errorSum+=e*e;
  let filterUpdated=false;
  const saturation = y >= 32000 || y <= -32000;
  if(x2Sum > x2SumThreshold && !saturation) {
    filterUpdated=true;
    const alpha = smoothing * e / x2Sum;
    for(let i=0;i<h.length;i++) {
      h[i] += alpha * x[i];
    }
  }
  return {errorSum,filterUpdated};
}


const H=new Float32Array(filterSize);

for(let i=0;i<downSampleNum-filterSize;i++) {
  const x=new Float32Array(filterSize);
  for(let j=0;j<filterSize;j++) x[j]=played16k[i+filterSize-j]; // playedから逆順にとってくる
  const y=recorded16k[i];
  const {errorSum,filterUpdated}=processMF(x,y,H);
  console.log("i:",i,"errorSum:",errorSum,"filterUpdated:",filterUpdated);
  if(i%200==0) {
    plotArrayToImage([H],2048,512,`plots/origmf_h_${i}.png`,1);
  }
}



