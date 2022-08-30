/*
 NodePhone server

 cl * N ---ws--- sv.js

*/

const WS=require("ws");

const wsv = new WS.WebSocketServer({ port: 13478 });

const g_clients=[];
function othercast(sender,data) {
  for(let i in g_clients) {
    if(g_clients[i]!=sender) g_clients[i].send(data);
  }
}
wsv.on('connection', function connection(ws) {
  g_clients.push(ws);
  console.log("connection: clients:",g_clients.length);
  ws.on('close', ()=>{
    const ind=g_clients.indexOf(ws);
    if(ind>=0) {
      g_clients.splice(ind,1);
      console.log("removed. clients:",g_clients.length);
    }
  });
  ws.on('message',(data)=>{
    const s=data.toString();
    const tks=s.split(" ");
    console.log('received: %s',tks);
    const cmd=tks[0];
    if(cmd=="broadcast") {
      othercast(ws,data);
    }    
  });
  ws.send('something');
});

