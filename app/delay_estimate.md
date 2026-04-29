# 遅延推定アルゴリズムの比較

同じ wav ペア (`counting48k.wav` / `playRecCounting48k.wav`、ループバック録音) を 48kHz → 6kHz にダウンサンプル (factor 8) して、5 方式で遅延を推定した。

- 目視 (Audacity): 4499 サンプル @ 48kHz ≒ **562 サンプル @ 6kHz**

## 方式

| 方式 | 数式 | 探す方向 | 実装 |
|---|---|---|---|
| AMDF | $\sum_j \lvert x_j - y_{d+j}\rvert$ | 谷 (min) | `amdf.js` |
| matched (envelope) | $\sum_j \lvert x_j \cdot y_{d+j}\rvert$ | 山 (max) | `matched.js` |
| xcorr (signed) | $\sum_j x_j \cdot y_{d+j}$ | $\lvert\cdot\rvert$ 最大 | `xcorr.js` |
| NLMS matched filter | $h$ を NLMS で学習 → ピーク位置 | 山 (max) | `matched_xcorr.js` |
| hamming valley (AECM) | FFT → バンドごと適応閾値で 2値化 → popcount(XOR) | 谷 (min) | `hamming_valley.js` |

## グローバル推定 (1本のwav全体)

| 方式 | 推定遅延 (samples @ 6kHz) | 目視との差 |
|---|---|---|
| 目視 (Audacity) | 562 | — |
| AMDF | 555 | −7 |
| matched (Σ\|x·y\|) | 565 | +3 |
| xcorr (Σ x·y) | 608 | +46 |
| NLMS h-peak | 524 | −38 |
| hamming valley | 512 | −50 |

NLMS と hamming valley はどちらも **約 1 ピッチ周期 (この声の主成分は ~38 サンプル) 早めにロック** している。これは符号付き相関が周期的局所最大を持つことに起因する pitch ambiguity。

## 揺れの統計 (sliding window, W=1024, STRIDE=256)

`stability_compare.js` で同じ wav を短い窓で sliding して per-window 推定値を集めた。エネルギー閾値で無音窓を除外、有効窓 72 個。

| 方式 | median | mean | std | IQR | range |
|---|---|---|---|---|---|
| AMDF Σ\|x-y\| | 541 | 315.6 | **464.7** | [162, 574] | [−794, 772] |
| matched Σ\|x·y\| | 574 | 593.0 | 165.8 | [536, 767] | [−8, 800] |
| xcorr Σ x·y | 565 | 573.6 | 89.9 | [539, 601] | [216, 798] |
| **NLMS h-peak** | 523 | 523.0 | **0.3** | [523, 523] | [522, 524] |
| hamming valley | 528 | 426.0 | 338.7 | **[520, 552]** | [−800, 632] |

## 観察

**精度 (目視に近いか)**
- ブルートフォース相関系 (AMDF, matched, xcorr) は目視中央 540–608 に収まり、特に matched は 565 で最も近い。
- 学習系 (NLMS) と AECM の hamming valley は揃って 1 ピッチ周期 (約 38 サンプル) 早めにロックし、520 付近に収束。

**安定性 (揺れなさ)**
- **NLMS が圧倒的に安定** (std=0.3, IQR 1点に固まる)。streaming 学習なので各窓で過去の推定が継続する効果。
- ブルートフォース系は窓ごとに独立に最適化するので、母音と子音や、無音直後など窓の中身次第で大きく振れる。
- hamming valley は **IQR が狭い (520–552) のに std が大きい (338.7)** という特徴。大半の窓では非常に安定だが、稀に探索範囲の端 (−800 など) に張り付く破滅的失敗がある。低エネルギー区間で 32bit シグネチャがノイズ化していると思われる。

**std と IQR の両方を見る意義**
- std と range は外れ値 1 つで膨らむ。
- IQR は両端 25% を捨てるので「大多数の窓ではどこに収まっているか」が見える。
- hamming valley のように「普段は超安定だが時々大外し」というプロファイルは、IQR を見て初めて見抜ける。

## AEC 文脈での解釈

AEC では遅延推定の出力は固定遅延ラインの粗い位置合わせに使われ、残りの細かい遅延は線形フィルタ係数 $h[k]$ が吸収する。よって:

- **目視との絶対誤差 38 サンプル (1 ピッチ周期) は実用上ほぼ無問題** — フィルタが吸収できる範囲内。
- **重要なのは揺れない (フィルタ係数の意味が安定する) こと** — この観点で NLMS が最良。
- AECM の hamming valley も「普段は安定」だが破滅的失敗があるので、ヒストグラム集約や outlier 除去が併用される (実際の AECM はそうしている)。

## 実装ファイル

- `amdf.js` — 時間領域 AMDF (1本実行)
- `matched.js` — 時間領域 envelope correlation (1本実行)
- `xcorr.js` — 時間領域 signed cross-correlation (1本実行)
- `matched_xcorr.js` — NLMS matched filter (1本実行)
- `hamming_valley.js` — AECM 方式 binary spectrum + Hamming distance (1本実行)
- `stability_compare.js` — 上記5方式を sliding window で比較
