/*
物理的に再生して録音するだけ。
  
  */


const {
  PortAudio,
  getVolumeBar,
  getMaxValue,
  loadWAVFileSync,
  fft_f,
  ifft_f ,
  spectrumBar,
  createComplexArray,
  calcAveragePower,
  calcPowerSpectrum,
  findMax,
  to_f,
  to_s,
  applyHannWindow,
  saveWAVFileSync,
  plotArrayToImage,
  to_f_array
} = require('./util.js');
const freq=48000;
const paUnit=256;
PortAudio.initSampleBuffers(freq,freq,paUnit);
PortAudio.startMic();
PortAudio.startSpeaker();

const orig=loadWAVFileSync("counting48k.wav");  // 元のデータ。これが再生用データ

let g_playOfs=0;


let g_cnt=0;

const g_refinedRec=[];

const chunkNum=Math.ceil(orig.length/paUnit);

setInterval(()=>{
  const st=new Date().getTime();
  const recordedSamples=PortAudio.getRecordedSamples(); // 1回の録音。 paUnitのn倍の量が到着する
  if(recordedSamples.length==0)return;
  if(recordedSamples.length % paUnit > 0) throw "invalid_buf_size";
  // ここで、入力はpaUnitの倍数。キャンセル処理を毎回paUnitサイズごとに実行することを保証する。
  const numChunk=recordedSamples.length / paUnit;
  let inputOfs=0;
  for(let j=0;j<numChunk;j++) {
    g_cnt++;
    for(let i=0;i<paUnit;i++) g_refinedRec.push(recordedSamples[inputOfs+i]); // refined用の元信号
    inputOfs+=paUnit;

    // refined用の信号をそのまま再生する。
    const toPlay=new Int16Array(paUnit);
    for(let i=0;i<paUnit;i++) {
      const sample=orig[g_playOfs]||0;
      g_playOfs++;
      toPlay[i]=sample;
    }
    PortAudio.discardRecordedSamples(paUnit);
    PortAudio.pushSamplesForPlay(toPlay);
    if(g_cnt==chunkNum) {
      // 音を保存して終了
      const hoge=new Int16Array(g_refinedRec.length);
      for(let i=0;i<g_refinedRec.length;i++) hoge[i]=g_refinedRec[i];
      saveWAVFileSync("playRec.wav",hoge,freq);
      process.exit(0);
    }
  }
},20);
