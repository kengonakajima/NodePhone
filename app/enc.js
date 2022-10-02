const recorder = require('node-record-lpcm16'); // nodeモジュールを読み込む
const {OpusEncoder}=require("@discordjs/opus");

const encoder=new OpusEncoder(48000,1); // 48KHz, monoral
const g_recorded=[]; // 録音用バッファ
const enable_dump=true;

recorder
  .record({
    sampleRate: 48000, // マイクデバイスのサンプリングレートを指定
    channels: 1,  // チャンネル数を指定(モノラル)              
    recordProgram: 'rec', // 録音用のバックエンドプログラム名を指定
  })
  .stream()
  .on('error', console.error) // エラーが起きたときにログを出力する
  .on('data', function(data) { // マイクからデータを受信する無名コールバック関数. 長さは2048とか120で割り切れないサイズになる
    let sampleNum=data.length/2; // 2バイトで1サンプル
    for(let i=0;i<sampleNum;i++) g_recorded.push(data.readInt16LE(i*2)); // いったん録音用バッファに蓄積
    let encoded_len=0;
    while(true) {
      const unit=480;
      if(g_recorded.length>=unit) {
        // Opusは120の倍数のサンプル数でエンコードする必要がある。48KHzでは、480サンプルで10ms
        const array=new Int16Array(unit);
        for(let i=0;i<unit;i++)array[i]=g_recorded.shift();
        const encoded=encoder.encode(array);
//        console.log("encoded:",encoded.length);
        encoded_len+=encoded.length;
        if(enable_dump) {
          let s_ary=[];
          for(let i=0;i<unit;i++) s_ary[i]=(array[i]&0xffff).toString(16);
          console.log("raw samples:",s_ary.join(" "));
          s_ary=[];
          for(let i=0;i<encoded.length;i++) s_ary[i]=encoded[i].toString(16);
          console.log("encoded:",s_ary.join(" "));          
        }
      } else {
        // エンコードできるサンプルがなくなったらやめる
        break; 
      }
    }
    var vol = Math.abs(data.readInt16LE());  // 配列の先頭のサンプリングデータをひとつ読み込み、音量を得る
    var ntimes = vol / 512; // 音量が0~32767の値で得られるので512で割る(0~63)
    var bar = "*".repeat(ntimes); // アスタリスク文字を、音量に応じて0~63回繰り返す
    console.log("mic volume:", bar,"encoded_len:",encoded_len);
    

  });
console.log('Listening, press Ctrl+C to stop.');

