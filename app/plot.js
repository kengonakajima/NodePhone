const fs = require('fs');
const path = require('path');

const {
  loadLPCMFileSync,
  getMaxValue,
  save_f,
  to_f,
  plotArrayToImage
 
} = require('./util.js');


if(!process.argv[4]) {
  console.log("args: filePath prefix scale");
  process.exit(1);
}
  
const filePath = path.join(__dirname, process.argv[2]);
const prefix = process.argv[3];
const scale = parseFloat(process.argv[4]);



fs.readFile(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error('ファイルの読み込み中にエラーが発生しました:', err);
    return;
  }
  const lines=data.split('\n');
  let cnt=0;
  for(const line of lines) {
    const array = line.split(',').map(Number);
    plotArrayToImage([array],1024,512,`plots/${prefix}_${cnt}.png`,scale);
    cnt+=1;
  }
});


