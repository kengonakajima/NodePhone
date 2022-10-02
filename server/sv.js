/*
 NodePhone server

 cl * N ---ws--- sv.js

*/

const ws=require("ws");

const wsv = new ws.WebSocketServer({ port: 13478 }); // WebSocketサーバーを初期化する

const g_clients=[]; // すべてのクライアントを保持する配列
// 送信者以外のすべてのクライアントにデータを同報する関数
function othercast(sender,data) {
  for(let i in g_clients) {
    if(g_clients[i]!=sender) g_clients[i].send(data);
  }
}
let g_idgen=0; // クライアントのIDを生成するためのカウンタ

// 新しいWebSocket接続を受け入れたイベントのコールバック関数
wsv.on('connection', function connection(co) {
  g_idgen++;
  co.id=g_idgen;
  g_clients.push(co); // クライアントを登録する
  console.log("connection: clients:",g_clients.length);
  // WebSocket接続が切断したイベントのコールバック関数
  co.on('close', ()=>{
    const ind=g_clients.indexOf(co);
    if(ind>=0) {
      g_clients.splice(ind,1); // クライアントを配列から削除する
      console.log("removed. clients:",g_clients.length);
    }
  });
  // WebSocketでメッセージを受信したときのコールバック関数
  co.on('message',(data)=>{
    const s=data.toString();
    const tks=s.split(" ");
    console.log('received: %s',tks);
    const cmd=tks[0];
    if(cmd=="othercast" || cmd=="o") {
      othercast(co,co.id+" "+s); // 送信者以外の全員に送信
    } else if(cmd=="echoback" || cmd=="e") {
      co.send(co.id+" "+s); // 送信者自信に送信する
    }
  });
});

