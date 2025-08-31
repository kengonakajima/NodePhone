/*
  NodePhone local echoback app (no ws)

  Usage:
    node echoback.js [--freq=48|32] [--latency_ms=200]

  - 完全ローカルで、マイク入力を一定遅延後に再生（おうむ返し）し、
    AEC3 に ref を与えてエコーを抑圧します。
*/

const {
  PortAudio,
  aec3Wrapper,
  getVolumeBar,
  createJitterBuffer,
  getMaxValue,
} = require('./util.js');

// 設定
let g_freq = 48000;          // 32k or 48k を推奨（16kはOpus未対応だが本ファイルでは未使用）
let g_latency_ms = 200;      // 再生側のジッタバッファ充填遅延（見かけの往復遅延）

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    if (arg.includes('freq=32')) g_freq = 32000;
    else if (arg.includes('freq=48')) g_freq = 48000;
    else if (arg.startsWith('--latency_ms=')) {
      const v = parseInt(arg.split('=')[1], 10);
      if (!isNaN(v) && v > 0) g_latency_ms = v;
    }
  }
}

// AEC3 初期化
aec3Wrapper.setFrequency(g_freq);

// PortAudio 準備
PortAudio.initSampleBuffers(g_freq, g_freq, 512);
PortAudio.startMic();
PortAudio.startSpeaker();

// バッファ
const g_recSamples = []; // mic からの生サンプル Int16
const g_refSamples = []; // AEC3 に与える参照（再生される音に相当）Int16

let g_recMaxSample = 0;
let g_playMaxSample = 0;

// ローカル受信（=サーバーから返ってくる音に相当）
const g_recvbufs = [];
const localRb = createJitterBuffer(Math.floor((g_freq * g_latency_ms) / 1000));
localRb.uid = 'local';
localRb.recvCount = 0;
g_recvbufs.push(localRb);

// マイク取り込み: 25ms 周期でポーリング
setInterval(() => {
  const samples = PortAudio.getRecordedSamples();
  if (samples.length <= 0) return;
  PortAudio.discardRecordedSamples(samples.length);

  for (const s of samples) {
    if (s > g_recMaxSample) g_recMaxSample = s;
    g_recSamples.push(s);
  }
}, 25);

// フレーム処理 + ローカルエコーバック + 再生
setInterval(() => {
  if (!aec3Wrapper.initialized) return;
  if (g_recSamples.length < aec3Wrapper.samples_per_frame) return;

  let frameNum = Math.floor(g_recSamples.length / aec3Wrapper.samples_per_frame);
  if (frameNum > 10) frameNum = 10; // 過負荷防止

  for (let f = 0; f < frameNum; f++) {
    // 入力（rec）
    const rec = new Int16Array(aec3Wrapper.samples_per_frame);
    for (let i = 0; i < aec3Wrapper.samples_per_frame; i++) rec[i] = g_recSamples.shift();
    aec3Wrapper.update_rec_frame(rec);

    // 参照（ref）: 直前までに push されたものを使用。足りない分は undefined -> 0 で埋まる
    const ref = new Int16Array(aec3Wrapper.samples_per_frame);
    for (let i = 0; i < aec3Wrapper.samples_per_frame; i++) ref[i] = g_refSamples.shift();
    aec3Wrapper.update_ref_frame(ref);

    // AEC3 処理
    const processed = new Int16Array(aec3Wrapper.samples_per_frame);
    aec3Wrapper.process(80, processed, 1);

    // 次フレーム以降の ref（再生される音の元）として保存
    for (let i = 0; i < aec3Wrapper.samples_per_frame; i++) g_refSamples.push(processed[i]);

    // ネットワークの代わりにローカル受信バッファへ積む（エコーバック）
    for (let i = 0; i < aec3Wrapper.samples_per_frame; i++) localRb.push(processed[i]);
    localRb.recvCount++;

    // 受信（＝ローカル蓄積）を混ぜて再生
    const mixedFrame = new Int16Array(aec3Wrapper.samples_per_frame);
    for (let j = 0; j < mixedFrame.length; j++) mixedFrame[j] = 0;

    g_playMaxSample = 0;
    for (const rb of g_recvbufs) {
      if (rb.needJitter) continue; // ジッタ分たまるまで待つ
      for (let j = 0; j < aec3Wrapper.samples_per_frame; j++) {
        const v = rb.shift();
        mixedFrame[j] += v;
        if (mixedFrame[j] > g_playMaxSample) g_playMaxSample = mixedFrame[j];
      }
    }

    PortAudio.pushSamplesForPlay(mixedFrame);
  }
}, 25);

// ステータス表示
setInterval(() => {
  const enh = aec3Wrapper.get_metrics_echo_return_loss_enhancement();
  const lines = [
    'Recorded vol: ' + getVolumeBar(g_recSamples[0]),
    'Playing vol:  ' + getVolumeBar(g_playMaxSample),
    'Reference vol:' + getVolumeBar(g_refSamples[0]),
    '',
    'g_recSamples.length: ' + g_recSamples.length,
    'Enhanced:            ' + Math.floor(enh * 1000),
    'g_refSamples.length: ' + g_refSamples.length,
    'LocalEcho:           true',
    'Voice:               ' + aec3Wrapper.get_voice_probability(),
    '',
    'Recvbufs:'
  ];
  for (let i in g_recvbufs) {
    const rb = g_recvbufs[i];
    lines.push('[' + i + '] user:' + rb.uid + ' samples:' + rb.samples.length + ' needJitter:' + rb.needJitter + ' recvCount:' + rb.recvCount);
  }

  process.stdout.write('\x1Bc'); // clear screen
  console.log(lines.join('\n'));
}, 25);

