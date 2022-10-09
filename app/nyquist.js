const Readable=require("stream").Readable; 
const Speaker=require("speaker");

const sine=new Readable(); //
sine.dt=Math.PI/8.0; // サンプルあたりtの増分
sine.t=0;    // 音波を生成する際の時刻カウンター
sine._read = function(n) { // Speakerモジュールで新しいサンプルデータが必要になったら呼び出されるコールバック関数 n:バイト数
  this.dt+=Math.PI/15; // tの増分を増やす(音の周波数を少し高くする)
  const hz=this.dt*12000/Math.PI/2.0; // 周波数を計算する
  const nyquist=12000/2; // 再生周波数が12000なので、その半分の6000Hzがナイキスト周波数
  const over=(hz>=nyquist); 
  console.log("dt:",this.fdt,"hz:",hz,"over_nyquist:",over);
  
  const sampleNum = n/2; // サンプルデータの数を計算する。16ビットPCMなのでnを2バイトで割る
  const u8ary = new Uint8Array(n); // 出力用データの配列
  const dv=new DataView(u8ary.buffer); // 16ビットリトルエンディアン整数の出力用
  for(var i=0;i<sampleNum;i++) { // 必要なサンプリングデータの数だけループさせる
    this.t += this.dt; // 1サンプルごとに時間を進める(2PI=3.14*2=6.28進めると1周期)
    const y=Math.sin(this.t); // sinの値を求める
    const sample=y*20000; // 振幅を掛ける    
    const isample=Math.floor(sample); // 整数にする
    dv.setInt16(i*2,isample,true); // バッファに書き込む
  }
  this.push(u8ary); // 最終的な値を出力
}

const spk=new Speaker({ 
    channels: 1, // チャンネル数は1(モノラル)
    bitDepth: 16, // サンプリングデータのビット数は16 (デフォルトはリトルエンディアン)
    sampleRate: 12000, // サンプリングレート(Hz)
});

sine.pipe(spk); 

