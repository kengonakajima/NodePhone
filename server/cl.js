const WS=require("ws");

const cl = new WS.WebSocket('ws://localhost:13478/');

cl.on('open', function open() {
  cl.send('something');
});

cl.on('message', function message(data) {
  console.log('received: %s', data);
});

let g_counter=0;

setInterval(function(){
  cl.send("broadcast "+process.pid+" "+g_counter);
  g_counter++;
},25); 
