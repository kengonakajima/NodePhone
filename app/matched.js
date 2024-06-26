/*
  matched filterの実信号でのテスト
  
  */
const {
  loadLPCMFileSync,
  getMaxValue,
  save_f,
  to_f,
  plotArrayToImage
 
} = require('./util.js');




const played48k=loadLPCMFileSync("counting48k.lpcm");  // 元のデータ。これが再生用データ
const recorded48k=loadLPCMFileSync("playRecCounting48k.lpcm16");  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ

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

