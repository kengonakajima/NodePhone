/*
  NodePhone command line app

  Usage:

  node phone.js [server_ip]
  
*/

const fs=require("fs");
const ws=require("ws");
const {OpusEncoder}=require("./opus.node");
const {PortAudio} = require('./util.js');

const {
  aec3Wrapper,
  getVolumeBar,
  createJitterBuffer,
  getMaxValue
}=require("./util.js");


let g_destHost="172.105.239.246"; // default test server ip
let g_echoback=false;


let g_freq=48000;
for(let i=2;i<process.argv.length;i++) {
  const arg=process.argv[i];
  if(arg.indexOf("--")==0) {
    if(arg.indexOf("echoback")>0) g_echoback=true;
    else if(arg.indexOf("disable_aec")>0) g_enable_aec3=false;
    else if(arg.indexOf("freq=16")>0) g_freq=16000;
    else if(arg.indexOf("freq=32")>0) g_freq=32000; // Opusエンコーダーが非対応
    else if(arg.indexOf("freq=48")>0) g_freq=48000;
  } else {
    g_destHost=arg;
  }  
}

if(g_freq==16000) throw "opus dont support 16kHz";

aec3Wrapper.setFrequency(g_freq);

PortAudio.initSampleBuffers(g_freq,g_freq);
PortAudio.startMic();
PortAudio.startSpeaker();

const encoder=new OpusEncoder(g_freq,1); // 1 ch: monoral


// 録音
const g_recSamples=[]; // lpcm16。録音バッファ
const g_refSamples=[]; // lpcm16 再生バッファ

let g_recMaxSample=0, g_playMaxSample=0;

setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  PortAudio.discardRecordedSamples(samples.length); // PortAudioの内部バッファを破棄する

  // samplesに含まれる最大音量を調べる。  samplesの要素は -32768から32767の値を取る。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>g_recMaxSample) g_recMaxSample=sample;
    g_recSamples.push(sample); // 録音バッファに記録
  }
},25);

// 再生
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

      // 次のキャンセル処理のために、計算結果をrefSamplesに保存する
      for(let i=0;i<aec3Wrapper.samples_per_frame;i++) {
        g_refSamples.push(processed[i]);
      }

      // encode, 送信
      let maxVol=getMaxValue(processed);
      const encoded=encoder.encode(processed);
      g_cl.sendEncodedData(encoded,maxVol);

      // 受信バッファをミキシングして再生する
      const mixedFrame=new Int16Array(aec3Wrapper.samples_per_frame);
      for(let j in mixedFrame) mixedFrame[j]=0;
      g_playMaxSample=0;
      for(let i in g_recvbufs) {
        const rb=g_recvbufs[i];
        if(rb.needJitter) continue;
        for(let j=0;j<aec3Wrapper.samples_per_frame;j++) {
          mixedFrame[j]+=rb.shift();
          if(mixedFrame[j]>g_playMaxSample)g_playMaxSample=mixedFrame[j];
        }      
      }
      PortAudio.pushSamplesForPlay(mixedFrame);
    }
  }
},25);

setInterval(()=>{
  const enh=aec3Wrapper.get_metrics_echo_return_loss_enhancement();
  const lines=[
    "Recorded vol: "+getVolumeBar(g_recSamples[0]),
    "Received vol: "+getVolumeBar(g_cl.recv_volume),
    "Playing vol:  "+getVolumeBar(g_playMaxSample),
    "Reference vol:"+getVolumeBar(g_refSamples[0]),
    "",
    "g_recSamples.length: "+g_recSamples.length,
    "Enhanced:     "+Math.floor(enh*1000),
    "ws readyState:"+g_cl.readyState,
//    "process time: "+process_time,
//    "read count:   "+g_readCount,
//    "record count: "+g_recCount,
    "g_refSamples.length: "+g_refSamples.length,
//    "AEC3 enable:  "+g_enable_aec3,
    "Echoback:     "+g_echoback,
    "Voice:        "+aec3Wrapper.get_voice_probability(),
    "",
    "Recvbufs:"
  ];
  for(let i in g_recvbufs) {
    const rb=g_recvbufs[i];
    lines.push("["+i+"] user:"+rb.uid+" samples:"+rb.samples.length+" needJitter:"+rb.needJitter+" recvCount:"+rb.recvCount);
  }

  process.stdout.write('\033c');
  console.log(lines.join("\n"));
  
},25);


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
  nrb.recvCount=0;
  console.log("created jitter buffer for user:",uid);
  g_recvbufs.push(nrb);
  return nrb;
}
const g_cl = new ws.WebSocket(`ws://${g_destHost}:13478/`);

g_cl.on('open', function open() {
  this.msg_count=0;
  // cl.send('something');
  console.log("connection opened");
});

g_cl.on('message', function message(data) {
  this.msg_count++;
  const tks=data.toString().split(" ");
  const uid=tks[0], cmd=tks[1], arg0=tks[2],arg1=tks[3];
  // echoback or othercast
  if(cmd=="e"||cmd=="o") { 
    this.recv_volume=parseInt(arg0);
    const sd=new Uint8Array(arg1.split(",").map(v => parseInt(v, 16)))
    const decoded=encoder.decode(Buffer.from(sd));
    const dv=new DataView(decoded.buffer);
    const n=decoded.length/2;
    const rb=ensureRecvbuf(uid);
    for(let i=0;i<n;i++) rb.push(dv.getInt16(i*2,true));
    rb.recvCount++;    
  }
});
g_cl.sendEncodedData = function(data,vol) {
  if(this.readyState==1) {
    const u8a=new Uint8Array(data);
    const s=Array.from(data).map(v => v.toString(16)).join(',')
    const cmd = g_echoback ? "e" : "o";
    this.send(cmd+" "+vol+" "+s); // echoback    
  } else {
    console.log("ws not ready");
  }
}



