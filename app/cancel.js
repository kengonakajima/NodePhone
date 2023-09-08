const recorder = require('node-record-lpcm16'); // nodeモジュールを読み込む
const fs=require("fs");



const {
  aec3Wrapper,
  getVolumeBar,
}=require("./util.js");

let g_freq=48000;
if(process.argv[2]) g_freq=parseInt(process.argv[2]); // 起動時の引数で周波数を与える
aec3Wrapper.setFrequency(g_freq);


///////////
// recording
const g_samples=[]; // lpcm16
let g_rec_max_sample=0, g_play_max_sample=0;
let g_enh=0;

recorder
  .record({
    sampleRate: g_freq, // マイクデバイスのサンプリングレートを指定
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
player.ref=[]; // 再生バッファ
player._read = function(n) { // Speakerモジュールで新しいサンプルデータが必要になったら呼び出されるコールバック関数 n:バイト数
  if(aec3Wrapper.initialized && g_samples.length>=aec3Wrapper.samples_per_frame ) {
    let frameNum=Math.floor(g_samples.length/aec3Wrapper.samples_per_frame);
    if(frameNum>10) frameNum=10;
    const toplay = new Uint8Array(aec3Wrapper.samples_per_frame*2*frameNum);
    const dv=new DataView(toplay.buffer);
    const rec=new Int16Array(aec3Wrapper.samples_per_frame);
    const st=new Date().getTime();
    for(let j=0;j<frameNum;j++) {      
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        rec[i]=g_samples.shift();
      }
      aec3Wrapper.update_rec_frame_wrapped(rec);
      const ref=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        ref[i]=this.ref.shift();
      }
      aec3Wrapper.update_ref_frame_wrapped(ref);
      const processed=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) processed[i]=123;
      aec3Wrapper.process_wrapped(80,processed,1);
      g_play_max_sample=0;
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        const sample=processed[i];
        dv.setInt16((j*aec3Wrapper.samples_per_frame+i)*2,sample,true);
        this.ref.push(sample);
        if(sample>g_play_max_sample)g_play_max_sample=sample;
      }
      const et=new Date().getTime();
      g_enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement();
    }    
    this.push(toplay); // スピーカーに向けて出力
  } else {
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
  }
}

const spk=new Speaker({ 
  channels: 1, // チャンネル数は1(モノラル)
  bitDepth: 16, // サンプリングデータのビット数は16 (デフォルトはリトルエンディアン)
  sampleRate: g_freq, // サンプリングレート(Hz)
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
