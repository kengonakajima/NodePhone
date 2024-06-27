/*
  cancel.jsはAEC3を使うが、 これはAEC3に依存せず独自にキャンセルする

  
  */
const {PortAudio} = require('./util.js');
const freq=16000; 
PortAudio.initSampleBuffers(freq,freq,256);
PortAudio.startMic();
PortAudio.startSpeaker();

const {
  getVolumeBar,
}=require("./util.js");



// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 再生バッファ

function createOrigEC(freq) {
  const ec={};
  ec.samples_per_frame= Math.floor(freq/100),

  ec.ref=[]; // 全部ため続ける(単純のため)
  ec.rec=[]; // processが終わったら削除する。
  // rec: i16ary
  ec.update_rec_frame = function(rec) {
    for(const sample of rec) ec.rec.push(sample);    
  }
  // ref: i16ary
  ec.update_ref_frame = function(ref) {
    for(const sample of ref) ec.ref.push(sample);
  }
  // ms: 遅延の外部からの推定値?
  // i16out : 出力
  // ns: 1ならノイズキャンセルが有効
  ec.process = function(i16out) {
    const version=0;

    if(version==0) {
      // 何もせず入力を出力とする。これで綺麗にハウリングする事を確認。ノイズなどは入らない
      if(ec.rec.length>=i16out.length) {
        for(let i=0;i<i16out.length;i++) {
          i16out[i]=ec.rec.shift();
        }
      }
    }
  }
  ec.get_metrics_echo_return_loss_enhancement = function() {
    return -12345;
  }
  return ec;
}

const ec=createOrigEC(freq);

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
  if(g_recSamples.length>=ec.samples_per_frame ) {
    let frameNum=Math.floor(g_recSamples.length/ec.samples_per_frame);
    if(frameNum>10) frameNum=10;
    for(let j=0;j<frameNum;j++) {      
      const rec=new Int16Array(ec.samples_per_frame);
      for(let i=0;i<ec.samples_per_frame;i++) {
        rec[i]=g_recSamples.shift();
      }
      ec.update_rec_frame(rec); // 録音サンプルをAECに渡す
      const ref=new Int16Array(ec.samples_per_frame);
      for(let i=0;i<ec.samples_per_frame;i++) {
        ref[i]=g_refSamples.shift();
      }
      ec.update_ref_frame(ref); // 前回記録した参照バッファをAECに渡す
      const processed=new Int16Array(ec.samples_per_frame);
      ec.process(processed); // AECの実際の処理を実行する
      playMax=0;
      const play=new Int16Array(ec.samples_per_frame);
      for(let i=0;i<ec.samples_per_frame;i++) {
        const sample=processed[i];
        g_refSamples.push(sample); // AEC処理された音を参照バッファに送る
        play[i]=sample;         // 同じ音を再生バッファに送る
        if(sample>playMax) playMax=sample;
      }
      PortAudio.pushSamplesForPlay(play);  // スピーカーに送る     
    }
    enh=ec.get_metrics_echo_return_loss_enhancement(); // 統計情報を取得
  }

  // デバッグ表示
//  process.stdout.write('\033c');  
  console.log("rec:",getVolumeBar(recMax));
  console.log("play:",getVolumeBar(playMax));
  console.log("playMax:",playMax);
  console.log("recSamples:",g_recSamples.length);
  console.log("refSamples:",g_refSamples.length);  
  console.log("Enhance:",enh);
},20);
