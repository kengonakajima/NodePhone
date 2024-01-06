const addon = require('./build/Release/NativeAudio.node');
const freq=48000; // aec3の必要条件
addon.initSampleBuffers(freq,freq);
addon.startMic();
addon.startSpeaker();

const {
  aec3Wrapper,
  getVolumeBar,
}=require("./util.js");


aec3Wrapper.setFrequency(freq);


///////////
// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
let g_recMaxSample=0, g_playMaxSample=0;
let g_enh=0;

setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=addon.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  addon.discardRecordedSamples(samples.length); // addonの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>g_recMaxSample) g_recMaxSample=sample;
    g_recSamples.push(sample); // 録音バッファに記録
  }
},25);

/////////////////////
// 再生

const g_refSamples=[]; // lpcm16 再生バッファ

setInterval(()=>{
  if(aec3Wrapper.initialized && g_recSamples.length>=aec3Wrapper.samples_per_frame ) {
    let frameNum=Math.floor(g_recSamples.length/aec3Wrapper.samples_per_frame);
    if(frameNum>10) frameNum=10;
    for(let j=0;j<frameNum;j++) {      
      const rec=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        rec[i]=g_recSamples.shift();
      }
      aec3Wrapper.update_rec_frame(rec);
      const ref=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        ref[i]=g_refSamples.shift();
      }
      aec3Wrapper.update_ref_frame(ref);
      const processed=new Int16Array(aec3Wrapper.samples_per_frame);
      aec3Wrapper.process(80,processed,1);
      g_playMaxSample=0;
      const play=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        const sample=processed[i];
        g_refSamples.push(sample);
        play[i]=sample;        
        if(sample>g_playMaxSample)g_playMaxSample=sample;
      }
      addon.pushSamplesForPlay(play);      
      g_enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement();
    }    

  } else {
/*    
    // サンプル数がjitterに満たない場合は、無音を再生する
    console.log("need more samples!"); 
    const sampleNum=n/2;
    const toplay = new Uint8Array(n);
    const dv=new DataView(toplay.buffer);
    for(let i=0;i<sampleNum;i++) {
      const sample=0; // すべてのサンプルを0にすれば無音になる
      dv.setInt16(i*2,sample,true);
      this.ref.push(sample);
    }
    this.push(toplay); // スピーカーに向けて出力
*/    
  }
},25);

setInterval(function() {
  process.stdout.write('\033c');  
  console.log("rec:",getVolumeBar(g_recMaxSample));
  console.log("play:",getVolumeBar(g_playMaxSample));
  console.log("recSamples:",g_recSamples.length);
  console.log("refSamples:",g_refSamples.length);  
  console.log("Enhance:",getVolumeBar(g_enh*2000));
  console.log("VoiceProb:",aec3Wrapper.get_voice_probability());
},50);
