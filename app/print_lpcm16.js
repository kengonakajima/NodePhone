const fs = require('fs');

// コマンドライン引数からファイル名を取得
const fileName = process.argv[2];
const unit = parseInt(process.argv[3])||1;

if (!fileName) {
    console.error('使用方法: node script.js <ファイル名>');
    process.exit(1);
}

// ファイルを読み込む
fs.readFile(fileName, (err, data) => {
  if (err) {
    console.error('ファイルの読み込みエラー:', err);
    process.exit(1);
  }

  // データを16ビット整数の配列に変換
  const samples = [];
  for (let i = 0; i < data.length; i += 2) {
    // リトルエンディアンで16ビット整数を読み取る
    const sample = data.readInt16LE(i);
    samples.push(sample);
  }

  // 各サンプルを1行ずつ出力    
  console.log("exports.refds=[\n");
  for (let i = 0; i < samples.length; i += unit) {
    const group = samples.slice(i, i + unit);
    console.log(group.join(', ') + `, // chunk ${i/unit}`);
  }
  console.log("];\n");  
});
