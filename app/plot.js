const fs = require('fs');
const path = require('path');

const {
  loadLPCMFileSync,
  getMaxValue,
  save_f,
  to_f,
  plotArrayToImage
 
} = require('./util.js');


const filePath = path.join(__dirname, process.argv[2]);
const scale = process.argv[3] || 1;

fs.readFile(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error('ファイルの読み込み中にエラーが発生しました:', err);
    return;
  }
  const lines=data.split('\n');
  let loatArray = null;
  if(lines.length<10) { // 閾値は適当。行数が少なかったら
    const line=lines[0];
    floatArray = lines[0].split(',').map(Number);    
  } else {
    floatArray = lines.filter(line => line.trim() !== '').map(Number);    
  }
  console.log("loaded data:",floatArray);
  plotArrayToImage([floatArray],1024,512,"plots/plot.js.out.png",scale);
});


