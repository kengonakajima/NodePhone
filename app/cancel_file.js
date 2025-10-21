const {
  loadWAVFileSync,
  getMaxValue,
  saveWAVFileSync,
  to_f,
  to_s_array
 
} = require('./util.js');
const freq=16000; // aec3の必要条件


const {
  aec3Wrapper,
  getVolumeBar,
}=require("./util.js");

aec3Wrapper.setFrequency(freq);
console.log("aec3Wrapper:",aec3Wrapper);



const sourceSampleRate=48000;
const sampleNum=sourceSampleRate;
const downSampleRate=4;
const processedSampleRate=Math.floor(sourceSampleRate/downSampleRate);
const downSampleNum=Math.floor(sampleNum/downSampleRate);

//const played48k=loadWAVFileSync("glassPlay48k.wav").slice(0,sampleNum);  // 元のデータ。これが再生用データ
//const recorded48k=loadWAVFileSync("glassRec48k.wav").slice(0,sampleNum);  // counting48k.wavをplayrec.jsで録音した48KHzのデータ

const played48k=loadWAVFileSync("counting48k.wav").slice(0,sampleNum);  // 元のデータ。これが再生用データ. 48k samplesで「いち」
const recorded48k=loadWAVFileSync("playRecCounting48k.wav").slice(0,sampleNum);  // counting48k.wavをplayrec.jsで録音した48KHzのデータ


// 48K>12K にdownsample
const played=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) played[i]=played48k[i*downSampleRate];
const recorded=new Float32Array(downSampleNum);
for(let i=0;i<downSampleNum;i++) recorded[i]=recorded48k[i*downSampleRate]; 


// デバッグ用に、 olayed12kに750Hzのサイン波を生成する。
//for(let i=0;i<downSampleNum;i++) {
//  const t=i/12000.0;
//  played[i]=Math.floor(Math.sin(2*Math.PI*750*t)*2000);
//}
console.log("original wave:",played);

const chunkSize=aec3Wrapper.samples_per_frame;

const finalOut=new Float32Array(recorded.length);

console.log("played:",played.length,"recorded:",recorded.length,"chunkSize:",chunkSize);

setInterval(function() {
  if(aec3Wrapper.initialized) {
    console.log("aec3 ready, process!");
    for(let l=0;;l++) {
      const startIndex=l*chunkSize;
      if(startIndex>played.length)break;
      const recChunk=new Int16Array(chunkSize);
      for(let i=0;i<chunkSize;i++) recChunk[i]=recorded[startIndex+i]||0;
      const refChunk=new Int16Array(chunkSize);
      for(let i=0;i<chunkSize;i++) refChunk[i]=played[startIndex+i]||0;

      aec3Wrapper.update_rec_frame(recChunk); // 録音サンプルをAECに渡す
      aec3Wrapper.update_ref_frame(refChunk); // 前回記録した参照バッファをAECに渡す
      const processed=new Int16Array(chunkSize);
      console.log("Starting chunk process:",l);
      aec3Wrapper.process(80,processed,0); // AECの実際の処理を実行する
      console.log("processed: ",processed.join(","),"len:",processed.length);

      for(let i=0;i<processed.length;i++) {
        finalOut[startIndex+i]=to_f(processed[i]);
      }
      const enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement(); // 統計情報を取得

      // デバッグ表示
      console.log("chunk:",l,
                  "rec:",getMaxValue(recChunk),
                  "ref:",getMaxValue(refChunk),
                  "out:",getMaxValue(processed),
                  "enh:",enh,
                  "voice:", aec3Wrapper.get_voice_probability(),
                  "finalOut.length:",finalOut.length
                 );
    }
    console.log("done");
    saveWAVFileSync("aec3static.wav",to_s_array(finalOut),processedSampleRate);
    process.exit(0);    
  } else {
    console.log("waiting for aec3 gets ready");
  }
  },100);
