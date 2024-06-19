const {
  loadLPCMFileSync,
  getMaxValue,
  save_f,
  to_f
 
} = require('./util.js');
const freq=48000; // aec3の必要条件


const {
  aec3Wrapper,
  getVolumeBar,
}=require("./util.js");

aec3Wrapper.setFrequency(freq);
console.log("aec3Wrapper:",aec3Wrapper);

const played=loadLPCMFileSync("counting48k.lpcm");  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("playRecCounting48k.lpcm16");  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ

const chunkSize=aec3Wrapper.samples_per_frame;

const finalOut=new Float32Array(recorded.length*2);

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
      aec3Wrapper.process(80,processed,1); // AECの実際の処理を実行する

      for(let i=0;i<processed.length;i++) {
        finalOut[startIndex+i]=to_f(processed[i]);
      }
      const enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement(); // 統計情報を取得

      // デバッグ表示
      console.log("rec:",getVolumeBar(getMaxValue(recChunk)),
                  "ref:",getVolumeBar(getMaxValue(refChunk)),
                  "out:",getVolumeBar(getMaxValue(processed)),
                  "enh:",enh,
                  "voice:", aec3Wrapper.get_voice_probability());
    }
    console.log("done");
    save_f(finalOut,"aec3static.lpcm16");
    process.exit(0);    
  } else {
    console.log("waiting for aec3 gets ready");
  }
  },100);


