/*
 NodePhone server

 cl * N ---ws--- sv.js

*/

const ws=require("ws");

const wsv = new ws.WebSocketServer({ port: 13478 });

const g_clients=[];
function othercast(sender,data) {
  for(let i in g_clients) {
    if(g_clients[i]!=sender) g_clients[i].send(data);
  }
}
let g_idgen=0;
wsv.on('connection', function connection(co) {
  g_idgen++;
  co.id=g_idgen;
  g_clients.push(co);
  console.log("connection: clients:",g_clients.length);
  co.on('close', ()=>{
    const ind=g_clients.indexOf(co);
    if(ind>=0) {
      g_clients.splice(ind,1);
      console.log("removed. clients:",g_clients.length);
    }
  });
  co.on('message',(data)=>{
    const s=data.toString();
    const tks=s.split(" ");
    console.log('received: %s',tks);
    const cmd=tks[0];
    if(cmd=="othercast" || cmd=="o") {
      othercast(co,co.id+" "+s);
    } else if(cmd=="echoback" || cmd=="e") {
      co.send(co.id+" "+s);
    }
  });
  co.send('something');
});

