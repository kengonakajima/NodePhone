const freq=48000;
const {PortAudio,OpusEncoder} = require('./util.js');
PortAudio.initSampleBuffers(freq,freq);
PortAudio.startMic(); // マイクを開始する

const encoder=new OpusEncoder(48000,1); // 32KHz, monoral
const g_recorded=[]; // 録音用バッファ
const enable_dump=true;

setInterval(()=>{
  const samples=PortAudio.getRecordedSamples(); 
  if(samples.length<=0) return; // サンプルがないときは何もせず、無名関数を終了
  PortAudio.discardRecordedSamples(samples.length); // PortAudioの内部バッファを破棄する
  for(let i=0;i<samples.length;i++) g_recorded.push(samples[i]); // いったん録音用バッファに蓄積

  let encoded_len=0;
  while(true) {
    const unit=480; // Opusは120の倍数のサンプル数でエンコードする必要がある。
    if(g_recorded.length>=unit) {
      const array=new Int16Array(unit);
      for(let i=0;i<unit;i++)array[i]=g_recorded.shift();
      const encoded=encoder.encode(array);
      console.log("encoded:",encoded.length);
      const decoded=encoder.decode(encoded);
      console.log("decoded:",decoded);
      encoded_len+=encoded.length;
      if(enable_dump) {
        let s_ary=[];
        for(let i=0;i<unit;i++) s_ary[i]=(array[i]&0xffff).toString(16);
        console.log("raw samples:",s_ary.join(" "),"samples:",s_ary.length);
        s_ary=[];
        for(let i=0;i<encoded.length;i++) s_ary[i]=encoded[i].toString(16);
        console.log("encoded:",s_ary.join(" "),"bytes:",s_ary.length);          
      }
    } else {
      // エンコードできるサンプルがなくなったらやめる
      break; 
    }
  }
  var vol=Math.abs(samples[0]);  // 配列の先頭のサンプリングデータをひとつ読み込み、音量を得る
  var ntimes=vol/512; // 音量が0~32767の値で得られるので512で割る(0~63)
  var bar="*".repeat(ntimes); // アスタリスク文字を、音量に応じて0~63回繰り返す
  console.log("mic volume:", bar,"encoded_len:",encoded_len);
},25);


console.log('Listening, press Ctrl+C to stop.');

