/*
 NodePhone server

 cl * N ---ws--- sv.js

*/

const WS=require("ws");

const wsv = new WS.WebSocketServer({ port: 13478 });

wsv.on('connection', function connection(ws) {
  ws.on('message', function message(data) {
    console.log('received: %s', data);
  });

  ws.send('something');
});

