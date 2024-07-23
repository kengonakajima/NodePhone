const {
  writeBinaryToFile
} = require("./util.js");

const fs = require('fs');

function readCSV(filePath,toShift) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').map(line => {
    const out=line.split(',').map(value => value.trim())
    out.shift(); // 先頭のトークンだけ捨てる
    if(out[out.length-1]=="") out.pop(); // 末尾が空っぽだったら捨てる
    return out;
  });
}

// 使用例
const inFile = process.argv[2];
const outFile = process.argv[3];
const rows = readCSV(inFile);
const samples=[];
for(const row of rows) {
  for(let i=0;i<row.length;i++) samples.push(row[i]);
}
const iary=new Int16Array(samples.length);
for(let i=0;i<samples.length;i++) iary[i]=samples[i];

writeBinaryToFile(inFile+".lpcm16",iary);


