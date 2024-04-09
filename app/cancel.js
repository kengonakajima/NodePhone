const {PortAudio} = require('./util.js');
const freq=48000; // aec3の必要条件
PortAudio.initSampleBuffers(freq,freq,512);
PortAudio.startMic();
PortAudio.startSpeaker();

const {
  aec3Wrapper,
  getVolumeBar,
}=require("./util.js");

aec3Wrapper.setFrequency(freq);

// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 再生バッファ

setInterval(()=>{
  let recMax=0, playMax=0;
  let enh=0;
  
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  PortAudio.discardRecordedSamples(samples.length); // PortAudioの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>recMax) recMax=sample;
    g_recSamples.push(sample); // 録音バッファに記録
  }

  // 録音バッファに音が来ていたらエコーキャンセラを呼び出す
  if(aec3Wrapper.initialized && g_recSamples.length>=aec3Wrapper.samples_per_frame ) {
    let frameNum=Math.floor(g_recSamples.length/aec3Wrapper.samples_per_frame);
    if(frameNum>10) frameNum=10;
    for(let j=0;j<frameNum;j++) {      
      const rec=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        rec[i]=g_recSamples.shift();
      }
      aec3Wrapper.update_rec_frame(rec); // 録音サンプルをAECに渡す
      const ref=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        ref[i]=g_refSamples.shift();
      }
      aec3Wrapper.update_ref_frame(ref); // 前回記録した参照バッファをAECに渡す
      const processed=new Int16Array(aec3Wrapper.samples_per_frame);
      aec3Wrapper.process(80,processed,1); // AECの実際の処理を実行する
      playMax=0;
      const play=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        const sample=processed[i];
        g_refSamples.push(sample); // AEC処理された音を参照バッファに送る
        play[i]=sample;         // 同じ音を再生バッファに送る
        if(sample>playMax) playMax=sample;
      }
      PortAudio.pushSamplesForPlay(play);  // スピーカーに送る     
    }
    enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement(); // 統計情報を取得
  }

  // デバッグ表示
  process.stdout.write('\033c');  
  console.log("rec:",getVolumeBar(recMax));
  console.log("play:",getVolumeBar(playMax));
  console.log("recSamples:",g_recSamples.length);
  console.log("refSamples:",g_refSamples.length);  
  console.log("Enhance:",getVolumeBar(enh*2000));
  console.log("VoiceProb:",aec3Wrapper.get_voice_probability());
},50);
