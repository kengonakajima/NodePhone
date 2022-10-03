// sv.jsのテストをするための簡単なクライアントプログラム

const ws=require("ws");

const dest_host=process.argv[2];  // 接続先のサーバーのIPアドレス
if(!dest_host) {
  console.log("need ip address of server");
  process.exit(1);
}
const cl = new ws.WebSocket(`ws://${dest_host}:13478/`); // ポート番号は固定

// サーバーへの接続に成功したときのコールバック関数
cl.on('open', function open() {
  cl.send("echoback hello"); // echobackを試しに送ってみる
});

// メッセージを受信したときのコールバック関数
cl.on('message', function message(data) {
  console.log('received: %s', data); // 画面にログするだけ
});

// 約25ミリ秒に1回 othercast命令を送る. 通話するときの音声の送信頻度と同じ。(正確に25ミリ秒ではない)
let g_counter=0;
setInterval(function(){
  if(cl.readyState==1) cl.send("othercast "+process.pid+" "+g_counter);
  g_counter++;
},25); 
