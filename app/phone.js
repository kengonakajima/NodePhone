/*
  NodePhone command line app

  Usage:

  node phone.js [server_ip]
  
 */
const recorder = require('node-record-lpcm16'); // nodeモジュールを読み込む
const fs=require("fs");
const ws=require("ws");
const {OpusEncoder}=require("@discordjs/opus");

const {
  aec3Wrapper,
  getVolumeBar,
  FREQ,
  SAMPLES_PER_FRAME,
  createJitterBuffer
}=require("./util.js");


const dest_host=process.argv[2] || "172.105.239.246"; // default test server ip

const encoder=new OpusEncoder(FREQ,1); // 1 ch: monoral


///////////
// recording
let g_rec_count=0;
const g_rec=[]; // lpcm16
const g_ref=[]; 
recorder
  .record({
    sampleRate: FREQ, // マイクデバイスのサンプリングレートを指定
    channels: 1,  // チャンネル数を指定(モノラル)              
    recordProgram: 'rec', // 録音用のバックエンドプログラム名を指定
  })
  .stream()
  .on('error', console.error) // エラーが起きたときにログを出力する
  .on('data', function(data) { // マイクからデータを受信する無名コールバック関数
    g_rec_count++;
    const sampleNum=data.length/2;
    g_rec_max_sample=0;
    for(let i=0;i<sampleNum;i++) {
      const sample=data.readInt16LE(i*2);
      g_rec.push(sample);
      if(sample>g_rec_max_sample)g_rec_max_sample=sample;
    }
  });

/////////////////////
// playing

const Readable=require("stream").Readable; 
const Speaker=require("speaker");

const player=new Readable();

// Speakerモジュールで新しいサンプルデータが必要になったら呼び出されるコールバック関数 n:バイト数
// nは8192とか480で割り切れない長さだが、キャンセル処理が480単位でしかできないので、それに合わせる。
let g_read_count=0;
player._read = function(n) {
  g_read_count++;  
  if(g_playbuf.needJitter) {
    this.push(Buffer.from(new Uint8Array(n).buffer));
    for(let i=0;i<n/2;i++) g_ref.push(0);
  } else {
    let sampleNum=n/2;
    if(sampleNum>g_playbuf.used()) sampleNum=g_playbuf.used();
    const i16b=new Int16Array(sampleNum);

    g_play_max_sample=0;
    for(let i=0;i<sampleNum;i++) {
      i16b[i]=g_playbuf.shift();
      g_ref.push(i16b[i]);
      if(i16b[i]>g_play_max_sample)g_play_max_sample=i16b[i];
    }
    this.push(Buffer.from(i16b.buffer));    
  }
}

const spk=new Speaker({ 
  channels: 1, // チャンネル数は1(モノラル)
  bitDepth: 16, // サンプリングデータのビット数は16 (デフォルトはリトルエンディアン)
  sampleRate: FREQ, // サンプリングレート(Hz)
});

player.pipe(spk); 


/////////////////////
// processing

const g_playbuf=createJitterBuffer(48000*0.2);

function processAudio() {
  if(!aec3Wrapper.initialized) {    
    return;
  }

  let frameNum=Math.floor(g_rec.length/SAMPLES_PER_FRAME);
  const st=new Date().getTime();
  for(let fi=0;fi<frameNum;fi++) {

    // マイクから入力した音をキャンセラーに入れる
    const recFrame=new Int16Array(SAMPLES_PER_FRAME);
    for(let i=0;i<SAMPLES_PER_FRAME;i++) recFrame[i]=g_rec.shift();
    aec3Wrapper.update_rec_frame_wrapped(recFrame);

    // 以前再生した音をキャンセラーに入れる    
    const refFrame=new Int16Array(SAMPLES_PER_FRAME);
    for(let i=0;i<SAMPLES_PER_FRAME;i++) refFrame[i]=g_ref.shift();
    aec3Wrapper.update_ref_frame_wrapped(refFrame);
    
    // キャンセラーを実行
    const processedFrame=new Int16Array(SAMPLES_PER_FRAME);
    aec3Wrapper.process_wrapped(80,processedFrame,1); // 1: use NS
    
    // encode, 送信
    let maxProcessedVolume=0;
    for(let i in processedFrame) {
      if(processedFrame[i]>maxProcessedVolume)maxProcessedVolume=processedFrame[i];
    }
    const encoded=encoder.encode(processedFrame);
    g_cl.sendEncodedData(encoded,maxProcessedVolume);
    
    // ネットワークから受信した音をミキシングする
    const mixedFrame=new Int16Array(SAMPLES_PER_FRAME);
    for(let j=0;j<SAMPLES_PER_FRAME;j++) mixedFrame[j]=0;

    for(let i in g_recvbufs) {
      const rb=g_recvbufs[i];
      if(rb.needJitter) continue;
      for(let j=0;j<SAMPLES_PER_FRAME;j++) {
        mixedFrame[j]+=rb.shift();
      }      
    }
    // 再生
    for(let i in mixedFrame) {
      g_playbuf.push(mixedFrame[i]);
    }
  }
  enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement();      

  const et=new Date().getTime();
  const process_time=et-st;
  
  console.log("rec:",getVolumeBar(g_rec[0]),
              "msg:",getVolumeBar(g_cl.recv_volume),
              "play:",getVolumeBar(g_playbuf.samples[0]),
              "ref:",getVolumeBar(g_ref[0]),              
              "recL:",g_rec.length,
              "Enhance:",Math.floor(enh*1000),
              "ws:",g_cl.readyState,
              "frameNum:",frameNum,
              "t:",process_time,
              "read:",g_read_count,
              "rec:",g_rec_count,
              "refnum",g_ref.length
              );

}

setInterval(()=>{
  processAudio();
},20);

////////////////////
// network

const g_recvbufs=[]; // バッファの配列
function getRecvbufByUserId(uid) {
  for(let i in g_recvbufs){
    const rb=g_recvbufs[i];
    if(rb.uid==uid) return rb;
  }
  return null;
}
function ensureRecvbuf(uid) {
  const rb=getRecvbufByUserId(uid);
  if(rb) return rb;
  const nrb=createJitterBuffer(48000*0.2);
  nrb.uid=uid;
  console.log("created jitter buffer for user:",uid);
  g_recvbufs.push(nrb);
  return nrb;
}
const g_cl = new ws.WebSocket(`ws://${dest_host}:13478/`);

g_cl.on('open', function open() {
  this.msg_count=0;
  // cl.send('something');
  console.log("connection opened");
});

g_cl.on('message', function message(data) {
  this.msg_count++;
  const tks=data.toString().split(" ");
  const uid=tks[0], cmd=tks[1], arg0=tks[2],arg1=tks[3];
  if(cmd=="e") {
    this.recv_volume=parseInt(arg0);
    const sd=new Uint8Array(arg1.split(",").map(v => parseInt(v, 16)))
    const decoded=encoder.decode(Buffer.from(sd));
    const dv=new DataView(decoded.buffer);
    const n=decoded.length/2;
    const rb=ensureRecvbuf(uid);
    for(let i=0;i<n;i++) {
      rb.push(dv.getInt16(i*2,true));
    }
    //console.log("rb:",rb.uid,rb.samples.length);
  }
});
g_cl.sendEncodedData = function(data,vol) {
  if(this.readyState==1) {
    const u8a=new Uint8Array(data);
    const s=Array.from(data).map(v => v.toString(16)).join(',')
    this.send("e "+vol+" "+s); // echoback    
  } else {
    console.log("ws not ready");
  }
}



