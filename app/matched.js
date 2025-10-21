/*
  matched filterの実信号でのテスト
  
  */
const {
  loadWAVFileSync,
  getMaxValue,
  to_f,
  plotArrayToImage
 
} = require('./util.js');




const played48k=loadWAVFileSync("counting48k.wav");  // 元のデータ。これが再生用データ
const recorded48k=loadWAVFileSync("playRecCounting48k.wav");  // counting48k.wavをplayrec.jsで録音した48KHzのデータ

// ダウンサンプリングする
const downSamplingFactor=8;

const N=4096;

/*
   played     [-------------***---] 
   recorded   [------***----------]

   このようにずれている。どちらも長さはN
   recordedを左からずらしながら評価する

   played     [-------------***---] 
   recorded   <- d ->[------***----------]

   ずれをdとする
   dは負にもなって -Nからはじめる

   この単純なループだと、線形観測モデルのスケールについて推定できない。
   ノイズ成分についてはエラー率で排除できるがスケールに対応できないのでダメ。
   
  */
const played=new Float32Array(N);
for(let i=0;i<N;i++) played[i]=to_f(played48k[i*downSamplingFactor]||0);
const recorded=new Float32Array(N);
for(let i=0;i<N;i++) recorded[i]=to_f(recorded48k[i*downSamplingFactor]||0);


// recordedをテンプレとして動かす方とする。
const output=new Float32Array(N*2);

let maxIndex=null;
let maxSum=0;

for(let d=-N;d<N;d++) {
  let sum=0;
  for(let j=0;j<N;j++) {
    const mul=Math.abs(recorded[j] * (played[d+j]||0));
    sum+=mul;
  }
  output[N+d]=sum;
  if(sum>maxSum) {
    maxIndex=d;
    maxSum=sum;
  }
}

console.log("maxIndex:",maxIndex,maxSum);

plotArrayToImage([output],1024,512,"plots/matched_output.png",0.1);
plotArrayToImage([played],1024,512,"plots/matched_played.png",1);
plotArrayToImage([recorded],1024,512,"plots/matched_recorded.png",1);
