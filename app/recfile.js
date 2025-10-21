const {PortAudio, getVolumeBar, saveWAVFileSync} = require('./util.js');

// PortAudioの内部バッファを初期化する
PortAudio.initSampleBuffers(48000,48000,512); 
// マイクを開始する
PortAudio.startMic(); 

const outputPath="recorded.wav";
const sampleRate=48000;
const recordedChunks=[]; // Int16Arrayの配列

// 25ミリ秒に1回繰り返す
setInterval(()=>{
  // マイクからのサンプルを読み込む
  const samples=PortAudio.getRecordedSamples();
  // サンプルがないときは何もせず、無名関数を終了
  if(samples.length<=0) return;
  // PortAudioの内部バッファを破棄する
  PortAudio.discardRecordedSamples(samples.length); 

  // samplesに含まれる最大音量を調べる。
  let maxVol=0;
  for(const sample of samples) {
    if(sample>maxVol) maxVol=sample;
  }
  // 最大音量を表示する
  const bar = getVolumeBar(maxVol);
  console.log("mic volume:", bar, "len:",samples.length);

  // 録音した音をファイルに保存する
  const chunk=new Int16Array(samples.length);
  chunk.set(samples);
  recordedChunks.push(chunk);
},25);

process.on('SIGINT',()=>{
  const totalLength=recordedChunks.reduce((sum,chunk)=>sum+chunk.length,0);
  const merged=new Int16Array(totalLength);
  let offset=0;
  for(const chunk of recordedChunks) {
    merged.set(chunk,offset);
    offset+=chunk.length;
  }
  saveWAVFileSync(outputPath,merged,sampleRate);
  process.exit(0);
});
