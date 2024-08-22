const {
  drawSpectrogram
} = require("./util.js");

const fs = require('fs');

function readCSV(filePath,toShift) {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n').map(line => {
    const out=line.split(',').map(value => value.trim())
    out.shift();
    return out;
  });
}

// 使用例
const inFile = process.argv[2];
const outFile = process.argv[3];
const scale = parseFloat(process.argv[4]||1);
const rows = readCSV(inFile);

drawSpectrogram(rows,outFile,scale);


