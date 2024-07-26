/*
  cancel.jsはAEC3を使うが、 これはAEC3に依存せず独自にキャンセルする

  
  */
const {
  spectrumBar,
  energyBar,  
  getVolumeBar,
  findMaxSquare,
  findMax,
  plotArrayToImage,
  save_fs,
  getMaxValue,
  decimateFloat32Array,
  loadLPCMFileSync,
  to_f,
  save_f
} = require('./util.js');
const freq=16000; 



function maxSquarePeakIndex(ary) {
  let maxEstimate=0;
  let maxElement=ary[0];
  for(let i=1;i<ary.length;i++) {
    const v=ary[i]*ary[i];
    if(v>maxElement) {
      maxEstimate=i;
      maxElement=v;
    }
  }
  return maxEstimate;
}
// xStartIndex: xの開始位置
// x2SumThreshold,smoothing: 設定値、定数
// x: 参照信号
// y: rec(16サンプル) low rate
// h: ふぃるた係数の配列512個。
let g_mfcore_cnt=0;
function matchedFilterCore(xStartIndex,x2SumThreshold,smoothing,x,y,h) {
  console.log("Matchedfiltercore called ", g_mfcore_cnt,":","xStartIndex:",xStartIndex,x.length,y.length,h.length);
  g_mfcore_cnt++;

  console.log("y",g_mfcore_cnt,":\n",y.join(","));
  console.log("x",g_mfcore_cnt,":");
  let xIndex=xStartIndex;
  const xa=[];
  for(let i=0;i<x.length;i++) {
    xa.push(x[xIndex]);
    xIndex = xIndex < (x.length - 1) ? xIndex + 1 : 0;
  }
  console.log(xa.join(","));
  let maxH=0;
  let maxHInd=-1;
  console.log("h",g_mfcore_cnt,":\n",h.join(","));
  for(let i=0;i<h.length;i++) {
    const ah=Math.abs(h[i]);
    if(ah>maxH) { maxH=ah; maxHInd=i; }
  }
  console.log("maxH:",maxH,"maxHInd:",maxHInd,"g_mfcore_cnt:",g_mfcore_cnt);

  // 計算
  let filterUpdated=false;
  let errorSum=0;
  for(let i=0;i<y.length;i++) {
    let x2Sum=0;
    let s=0;
    let xIndex=xStartIndex;
    for(let k=0;k<h.length;k++) {
      x2Sum += x[xIndex] * x[xIndex];
      s += h[k] * x[xIndex];
      xIndex = xIndex < (x.length -1) ? xIndex + 1 : 0;
    }
    // 誤差信号を計算
    const e = y[i] - s;
    errorSum+=e*e;
    const saturation = y[i] >= 32000 || y[i] <= -32000;
    if(x2Sum > x2SumThreshold && !saturation) {
      const alpha = smoothing * e / x2Sum;
      let xIndex=xStartIndex;
      for(let k=0;k<h.length;k++) {
        h[k] += alpha * x[xIndex];
        xIndex = xIndex < (x.length -1) ? xIndex + 1 : 0;
      }
      // 更新されたhを表示
      console.log("looph'",i,g_mfcore_cnt,":",h.join(","));
      let maxH=0;
      let maxHInd=-1;
      for(let i=0;i<h.length;i++) {
        const ah=Math.abs(h[i]);
        if(ah>maxH) { maxH=ah; maxHInd=i; }
      }
      console.log("maxH':",maxH,"maxHInd':",maxHInd);
      filterUpdated=true;
    }
    xStartIndex = xStartIndex > 0 ? xStartIndex - 1 : x.length - 1; // 逆順なので一周したら末尾に戻す。
  }
  return {errorSum,filterUpdated};
}

function createSampleBuffer(n,readInit,writeInit) {
  const out={
    buf: new Float32Array(n),
    read: readInit,
    write: writeInit,
    dump: function() {
      console.log("SampleBuffer dump: read:",this.read,"write:",this.write,"size:",this.buf.length);
      console.log(this.buf.join(","));
    },
  };
  return out;
}
function createOrigEC(freq) {
  const ec={};
  ec.samples_per_frame= Math.floor(freq/100);
  // AEC3では[512]x5
  const filterSize=512;
  const filterNum=5;
  ec.filters=new Array(5);
  for(let i=0;i<filterNum;i++) ec.filters[i]=new Float32Array(filterSize); 
  ec.xStartOfs=0; //ec.refのどの位置から読むか

  ec.cnt=0;
  
  ec.ref=[]; // 全部ため続ける(単純のため)
  ec.rec=[]; // processが終わったら削除する。
  ec.recAccum=[]; // recをshiftせずにぜんぶためておく、デバッグ用
  ec.out=[]; // 出力用

  ec.renderBuffer={
    // 2448=19*128+16, aec3. decimateされた信号を逆順に格納するリングバッファ. MatchedFilter用
    // write: 2448-16 aec3.
    // read: 最初に書いたときに writeが2416になり、そのときに同じ値になるようにしておく。    
    bufferLowReversed: createSampleBuffer(2448,2432,2432),
    // decimateしない元の信号用. Adaptive FIR Filter用。 正順
    bufferHigh: createSampleBuffer(2448*4,2432*4,2432*4),
    copyBlockLowReversed: function(sbReversed) {
      if(sbReversed.length!=16) throw "invalid_size";
      for(let i=0;i<16;i++) this.bufferLowReversed.buf[this.bufferLowReversed.write+i]=sbReversed[i];
      this.bufferLowReversed.write-=16;  // 逆順リングバッファなので前に移動させていく。
      if(this.bufferLowReversed.write==-16) this.bufferLowReversed.write=2432; // 一周する
    },
    incrementReadIndexLowReversed: function() {
      this.bufferLowReversed.read-=16;
      if(this.bufferLowReversed.read==-16) this.bufferLowReversed.read=2432; // 一周
    },
    copyBlockHigh: function(sb) {
      if(sb.length!=64) throw "invalid_size";
      for(let i=0;i<64;i++) this.bufferHigh.buf[this.bufferHigh.write+i]=sb[i];
      this.bufferHigh.write+=64;
      if(this.bufferHigh.write==this.bufferHigh.buf.length) this.bufferHigh.write=0;
    },
    incrementReadIndexHigh: function() {
      this.bufferHigh.read+=64;
      if(this.bufferHigh.read==this.bufferHigh.buf.length) this.bufferHigh.read=0; // 1周
    }
  };

  
  // rec: i16ary
  ec.update_rec_frame = function(rec) {
    if(rec.length%4>0) throw "invalid_rec_len";
    for(const sample of rec) {
      ec.rec.push(sample);
      ec.recAccum.push(sample);
    }
  }
  // ref: i16ary
  ec.update_ref_frame = function(ref) {
    if(ref.length%4>0) throw "invalid_ref_len";    
    for(let i=0;i<ref.length;i++) ec.ref.push(ref[i]);
  }

  ec.filters=[];
  for(let i=0;i<5;i++) ec.filters[i]=new Float32Array(512); 

  ec.histogramData=new Int16Array(250); // aec3 MatchedFilterの推定値の単純な履歴
  ec.histogram=new Int16Array(19*128+1); // aec3 renderBufferのサイズが 19*128+16。対応できる最大の遅延。
  ec.histogramDataIndex=0;
  

  ec.debugLowRef=[];
  ec.debugLowRec=[];

  ec.maxCoreOutErrorSum=0;
  ec.totalCoreOutErrorSum=0;

  ec.totalLatencyBlocks=0;
  
  // ms: 遅延の外部からの推定値?
  // i16out : 出力
  // ns: 1ならノイズキャンセルが有効
  ec.process = function(i16out) {
    ec.cnt+=1;
    
    const version=1;

    if(version==0) {
      // Version 1. 何もせず入力を出力とする。これで綺麗にハウリングする事を確認。ノイズなどは入らない
      if(ec.rec.length>=i16out.length) {
        for(let i=0;i<i16out.length;i++) {
          i16out[i]=ec.rec.shift();
        }
      }
    } else if(version==1) {
      // recに来ている信号で駆動する。つまりrecに1ブロックきたらrefも1ブロック進める。
      const blockSize=64; // aec3の内部処理単位
      const subBlockSize=16; // aec3 遅延推定用
      const blockNum=Math.floor(ec.rec.length/blockSize);
      for(let bi=0;bi<blockNum;bi++) {
        const recBlock=new Float32Array(blockSize);
        for(let i=0;i<blockSize;i++) recBlock[i]=ec.rec.shift();
        const refBlock=new Float32Array(blockSize);
        for(let i=0;i<blockSize;i++) refBlock[i]=ec.ref.shift();
        console.log("bi:",bi,"recBlock:",recBlock,"refBlock:",refBlock);

        //　以下、MatchedFilterを利用した遅延推定
        
        // ダウンサンプリングしたバッファを作成
        const recLowBlock=decimateFloat32Array(recBlock,4);
        const refLowBlockReversed=decimateFloat32Array(refBlock,4).reverse();
        if(refLowBlockReversed.length!=subBlockSize) throw "invalid_size";
        // renderBufferに1ブロックをコピーする
        ec.renderBuffer.copyBlockLowReversed(refLowBlockReversed);
        //ec.renderBuffer.dumpBuffer();
        ec.renderBuffer.incrementReadIndexLowReversed();
        // デバッグ用の記録
        for(let i=0;i<subBlockSize;i++) {
          ec.debugLowRec.push(recLowBlock[i]);
          ec.debugLowRef.push(refLowBlockReversed[subBlockSize-1-i]);
        }

        let errorSumAnchor = 0.0;
        for(let k=0;k<recLowBlock.length;++k) errorSumAnchor += recLowBlock[k] * recLowBlock[k];
        
        // フィルタの計算
        let winnerErrorSum=errorSumAnchor; // 最も誤差の小さいやつを探す。
        let winnerIndex=-1;
        let winnerLag=-1;
        let alignmentShift=0;
        for(let n=0;n<ec.filters.length;n++) {
          const x2SumThreshold=512 * 150 * 150; // aec3. 512はフィルタサイズで　150は音量
          // xStartIndexは2431から始まる
          let xStartIndex = (ec.renderBuffer.bufferLowReversed.read + alignmentShift + subBlockSize - 1 ) % ec.renderBuffer.bufferLowReversed.buf.length;
          console.log("calling matchedFilterCore xStartIndex:",xStartIndex,"n:",n);
          const smoothing=0.7;
          const y=recLowBlock;
          const coreOut=matchedFilterCore(xStartIndex,x2SumThreshold,smoothing,ec.renderBuffer.bufferLowReversed.buf,y,ec.filters[n]);

          // フィルタのピークを監視して、遅延を推定する
          const matchingFilterThreshold=0.2; //aec3
          let lagEstimate = maxSquarePeakIndex(ec.filters[n]);
          let reliable = lagEstimate > 2 && lagEstimate < (ec.filters[n].length - 10) &&
              coreOut.errorSum < matchingFilterThreshold * errorSumAnchor;
          const lag=lagEstimate + alignmentShift;
          
          console.log("lagEstimate:",lagEstimate,"reliable:",reliable,"lag:",lag);
          if(reliable) {
            plotArrayToImage([ec.filters[n]],1024,512,`plots/origcancel_reliable_${ec.cnt}_${n}.png`,1);
          }
          // ここまででフィルタのピークの位置を特定できている。勝者を選択する
          if(coreOut.filterUpdated && reliable && coreOut.errorSum < winnerErrorSum) {
            winnerLag=lag;
            winnerIndex=n;
            winnerErrorSum=coreOut.errorSum;
            if(coreOut.errorSum>ec.maxCoreOutErrorSum) ec.maxCoreOutErrorSum=coreOut.errorSum;
            ec.totalCoreOutErrorSum+=coreOut.errorSum;
            console.log("winner updated. n:",n,"lag:",lag,"errorSum:",coreOut.errorSum,"maxCoreOutErrorSum:",ec.maxCoreOutErrorSum,"totalCoreOutErrorSum:",ec.totalCoreOutErrorSum,"lagEstimate:",lagEstimate,"alignmentShift:",alignmentShift);
          }
          alignmentShift+=24*16; // aec3
        }
        // MatchedFilterがだいたいの遅れを検出した。
        if(winnerIndex!=-1) {
          const reportedLagEstimate=winnerLag;
          console.log("reportedLagEstimate:",reportedLagEstimate,"histogramDataIndex:",ec.histogramDataIndex);
          // この結果をhistogramで安定化する HighestPeakAggregator::Aggregate相当
          ec.histogram[ec.histogramData[ec.histogramDataIndex]]--;
          ec.histogramData[ec.histogramDataIndex]=reportedLagEstimate;
          ec.histogram[ec.histogramData[ec.histogramDataIndex]]++;
          ec.histogramDataIndex = (ec.histogramDataIndex+1) % ec.histogramData.length;
          const candidate=findMax(ec.histogram);
          console.log("candidate:",candidate);
          console.log("histogram:",ec.histogram.join(","));
          console.log("histogram_data:",ec.histogramData.join(","));
          // 4KHzサンプルでの遅延がわかったので、次にブロック数にする (render_delay_buffer)
          
          const renderBufferLatencySamples = (ec.renderBuffer.bufferLowReversed.buf.length + ec.renderBuffer.bufferLowReversed.read - ec.renderBuffer.bufferLowReversed.write) % ec.renderBuffer.bufferLowReversed.buf.length;
          const renderBufferLatencyBlocks = renderBufferLatencySamples / subBlockSize;
          const candidateLatencyBlocks = Math.floor(candidate.index/subBlockSize); // TODO:ゆらぐこともあるよね
          ec.totalLatencyBlocks = candidateLatencyBlocks+renderBufferLatencyBlocks;
          console.log("renderBufferLatencySamples:",renderBufferLatencySamples);
          console.log("renderBufferLatencyBlocks:",renderBufferLatencyBlocks);
          console.log("candidateLatencyBlocks:",candidateLatencyBlocks);
          console.log("ec.totalLatencyBlocks:",ec.totalLatencyBlocks,"subBlockSize:",subBlockSize);
        }
        if(ec.totalLatencyBlocks) {
          // renderBufferは逆順
          console.log("RRRR:",ec.renderBuffer.bufferLowReversed.read);
        }

        
        for(let i=0;i<blockSize;i++) ec.out.push(recBlock[i]);
      } // version 1

      // 出力
      if(ec.out.length>=i16out.length) {
        for(let i=0;i<i16out.length;i++) {
          i16out[i]=ec.out.shift();
        }
      }      
    }
  }
  ec.get_metrics_echo_return_loss_enhancement = function() {
    return -12345;
  }
  return ec;
}

const ec=createOrigEC(freq);


const played=loadLPCMFileSync("counting48k.lpcm").slice(0,50000);  // 元のデータ。これが再生用データ
const recorded=loadLPCMFileSync("playRecCounting48k.lpcm16").slice(0,50000);  // counting48k.lpcmをplayrec.jsで録音した48KHzのデータ

for(let i=0;i<160;i++) recorded[i]=0; // aec3では最初のちゃんくについてなぜかすべて0になっている。

const chunkSize=160;

const finalOut=new Float32Array(recorded.length*2);

console.log("played:",played.length,"recorded:",recorded.length,"chunkSize:",chunkSize);

for(let l=0;;l++) {
  const startIndex=l*chunkSize;
  if(startIndex>played.length)break;
  const recChunk=new Int16Array(chunkSize);
  for(let i=0;i<chunkSize;i++) recChunk[i]=recorded[startIndex+i]||0;
  const refChunk=new Int16Array(chunkSize);
  for(let i=0;i<chunkSize;i++) refChunk[i]=played[startIndex+i]||0;

  ec.update_rec_frame(recChunk); // 録音サンプルをAECに渡す
  ec.update_ref_frame(refChunk); // 前回記録した参照バッファをAECに渡す
  const processed=new Int16Array(chunkSize);
  console.log("Starting chunk process:",l);
  ec.process(80,processed,0); // AECの実際の処理を実行する

  for(let i=0;i<processed.length;i++) {
    finalOut[startIndex+i]=to_f(processed[i]);
  }
  const enh=ec.get_metrics_echo_return_loss_enhancement(); // 統計情報を取得

  // デバッグ表示
  console.log("chunk:",l,
              "rec:",getMaxValue(recChunk),
              "ref:",getMaxValue(refChunk),
              "out:",getMaxValue(processed),
              "enh:",enh
             );
}

console.log("done");
save_f(finalOut,"origStatic.lpcm16");

save_fs(ec.debugLowRef,"debugLowRef.lpcm16");
save_fs(ec.debugLowRec,"debugLowRec.lpcm16");

