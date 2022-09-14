const recorder = require('node-record-lpcm16'); // nodeモジュールを読み込む
const fs=require("fs");



const {
  aec3Wrapper,
  getVolumeBar,
  FREQ,
  SAMPLES_PER_FRAME,
}=require("./util.js");



///////////
// recording
const g_samples=[]; // lpcm16
let g_rec_max_sample=0, g_play_max_sample=0;
let g_enh=0;

recorder
  .record({
    sampleRate: FREQ, // マイクデバイスのサンプリングレートを指定
    channels: 1,  // チャンネル数を指定(モノラル)              
    recordProgram: 'rec', // 録音用のバックエンドプログラム名を指定
  })
  .stream()
  .on('error', console.error) // エラーが起きたときにログを出力する
  .on('data', function(data) { // マイクからデータを受信する無名コールバック関数
    const sampleNum=data.length/2;
    g_rec_max_sample=0;
    for(let i=0;i<sampleNum;i++) {
      const sample=data.readInt16LE(i*2);
      g_samples.push(sample);
      if(sample>g_rec_max_sample)g_rec_max_sample=sample;
    }
//    console.log("rec:",g_samples.length,"[0]:",g_samples[0]);
  });

/////////////////////
// playing

const Readable=require("stream").Readable; 
const Speaker=require("speaker");

const player=new Readable();
player.ref=[];
player._read = function(n) { // Speakerモジュールで新しいサンプルデータが必要になったら呼び出されるコールバック関数 n:バイト数
  if(g_samples.length>=9600) {
    let loopNum=Math.floor(g_samples.length/SAMPLES_PER_FRAME);
    if(loopNum>10) loopNum=10;
    const toplay = new Uint8Array(SAMPLES_PER_FRAME*2*loopNum);
    const dv=new DataView(toplay.buffer);
    const rec=new Int16Array(SAMPLES_PER_FRAME);
    const st=new Date().getTime();
    for(let j=0;j<loopNum;j++) {      
      for(let i=0;i<SAMPLES_PER_FRAME;i++) {
        rec[i]=g_samples.shift();
      }
      if(aec3Wrapper.initialized) {
        aec3Wrapper.update_rec_frame_wrapped(rec);
        const ref=new Int16Array(SAMPLES_PER_FRAME);
        for(let i=0;i<SAMPLES_PER_FRAME;i++) {
          ref[i]=this.ref.shift();
        }
        aec3Wrapper.update_ref_frame_wrapped(ref);
        const processed=new Int16Array(SAMPLES_PER_FRAME);
        for(let i=0;i<SAMPLES_PER_FRAME;i++) processed[i]=123;
        aec3Wrapper.process_wrapped(80,processed,1);
        g_play_max_sample=0;
        for(let i=0;i<SAMPLES_PER_FRAME;i++) {
          const sample=processed[i];
          dv.setInt16((j*SAMPLES_PER_FRAME+i)*2,sample,true);
          this.ref.push(sample);
          if(sample>g_play_max_sample)g_play_max_sample=sample;
        }
      } else {
        console.log("aec3 is not initialized yet");
      }
    }
    const et=new Date().getTime();
    g_enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement();
    this.push(toplay);
  } else {
    console.log("need more samples!");
    const sampleNum=n/2;
    const toplay = new Uint8Array(n);
    const dv=new DataView(toplay.buffer);
    for(let i=0;i<sampleNum;i++) {
      const sample=0;
      dv.setInt16(i*2,sample,true);
      this.ref.push(sample);
    }
    this.push(toplay);
  }
}

const spk=new Speaker({ 
  channels: 1, // チャンネル数は1(モノラル)
  bitDepth: 16, // サンプリングデータのビット数は16 (デフォルトはリトルエンディアン)
  sampleRate: FREQ, // サンプリングレート(Hz)
});

player.pipe(spk); 

setInterval(function() {
  process.stdout.write('\033c');  
  console.log("rec:",getVolumeBar(g_rec_max_sample));
  console.log("play:",getVolumeBar(g_play_max_sample));
  console.log("buffer:",g_samples.length);
  console.log("Enhance:",getVolumeBar(g_enh*2000));
  console.log("Voice:",aec3Wrapper.get_voice_probability());
},50);
