const WS=require("ws");

const dest_host=process.argv[2];
if(!dest_host) {
  console.log("need ip address of server");
  process.exit(1);
}
const cl = new WS.WebSocket(`ws://${dest_host}:13478/`);

cl.on('open', function open() {
  cl.send('something');
});

cl.on('message', function message(data) {
  console.log('received: %s', data);
});

let g_counter=0;

setInterval(function(){
  if(cl.readyState==1) cl.send("othercast "+process.pid+" "+g_counter);
  g_counter++;
},25); 
