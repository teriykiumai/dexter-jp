# MVP E2E Validation

## 検証条件

- 実施日: 2026-08-23
- 対象銘柄: 7203（トヨタ自動車）
- 入力: `7203を分析して`
- LLM: OpenAI `gpt-5.6-terra`（Responses API）
- 財務データ: EDINET DB
- 市場データ: J-Quants V2（Standardプラン）
- 市場データ期間: 2025-06-01〜2026-08-21

APIキーや認証情報は記録しない。

## 結果

実データ取得、決定論的な各分析エンジン、LLMによる最終レポート生成までを通し、以下を確認した。

| 項目 | 結果 | 確認内容 |
| --- | --- | --- |
| financials | PASS | FY2021〜FY2026の6期。最新提出日時は2026-06-10 15:33 |
| valuation | PASS | 株価3132円（2026-08-21）とFY2026のEPS・BPS・配当からPER 10.7倍、PBR 1.03倍、配当利回り3.01%を算出 |
| peer | PASS | 18件の候補データから同業10社を比較。PER、PBR、ROE、営業利益率、売上高成長率、配当利回りの中央値・順位を算出 |
| stock OHLCV | PASS | 279営業日。最新日は2026-08-21 |
| margin | PASS | 57週。最新日は2026-08-14 |
| TOPIX | PASS | 279営業日。最新日は2026-08-21 |
| technical | PASS | SMA20、ATR14、平均出来高、Swing High/Low、Trendを全履歴から計算 |
| supply-demand | PASS | 信用倍率、前週比、13/52週平均、52週乖離・Percentile、信用消化日数を計算 |
| correlation | PASS | TOPIXとの60日・250日統計を日付のinner joinで計算 |
| strategy | PASS | Swing High突破、Swing/ATR Stop、2R Target、Risk/Rewardを決定論的に計算 |
| data dates | PASS | 財務、株価、信用、TOPIXごとの基準日を保持 |
| missing-data behavior | PASS | 履歴不足時に値を補完せず、`insufficient_history`または利用不可項目を返すことを確認 |
| final report | PASS | 5 iterationで全分析ツールを呼び出し、指定された全見出しを含む最終レポートを生成 |

### 主要な計算結果

- 財務: 売上高50兆6,849億円、営業利益3兆7,662億円、純利益3兆8,481億円、ROE 10.1%
- 売上高CAGR（FY2021〜FY2026）: 13.24%
- Peer: PER中央値10.7倍、PBR中央値0.76倍、ROE中央値8.48%、営業利益率中央値5.53%、売上高成長率中央値5.28%、配当利回り中央値3.74%
- Technical（2026-08-21）: 終値3132円、SMA20 3010.35円、ATR14 80.68円、Swing High 3233円、Swing Low 2869.5円、Range / Transition
- Supply & Demand（2026-08-14）: 信用倍率13.12倍、52週平均買残13,153,184.62株、52週乖離+49.7%、52週Percentile 82.35%、信用消化日数0.53日
- TOPIX相関（2026-08-21）: 60日相関0.3745・β0.581、250日相関0.6074・β0.923
- Strategy: 3233円を厳密に上回るブレイクをEntry条件とする。Swing Stop 2869.5円の2R Targetは3960円、ATR Stop約3112円の2R Targetは約3475円

価格tickはこの検証で根拠データを取得していないため適用していない。Entryは3233円での約定を意味せず、3233円を厳密に上回ることを条件とする。

Peer候補の時価総額が取得できなかったため、時価総額優先の選定は適用せず最終レポートでデータ制約として明示した。欠損ROICも推測せず利用不可として扱った。

## 実データ検証で修正した問題

- 赤字企業の負のPERが「低いほど良い」値としてPeer順位に入る問題を修正した。PERとPBRは正の有限値だけを順位・中央値・Percentileの対象とする。
- GPT-5.6でFunction toolsとreasoningをChat Completions APIに送ると失敗するため、GPT-5.6モデルだけ既存のOpenAI実装でResponses APIを使用するようにした。
- Responses APIのStructured Outputsで省略可能フィールドが拒否される問題を、必須かつnullableなLLM出力スキーマと既存入力への正規化で解消した。
- LLMが大きな時系列をツール引数へ転記する際に履歴を切り詰める問題を防ぐため、既存のJ-Quants取得処理を再利用するticker直接指定モードを分析ツールへ追加した。計算自体は従来の決定論的エンジンを再利用する。

## 欠損データ検証

- OHLCVを10本に制限すると、SMA20、ATR14、平均出来高、Swing、Trendが利用不可になる。
- 信用履歴を1週に制限すると、前週比、13/52週統計、信用消化日数が`insufficient_history`になる。
- 株価とTOPIXを30日に制限すると、60日・250日統計が`insufficient_history`になる。
- Swing Highを欠損させると、Entry / Stop / Targetを生成せず理由を返す。
- PeerのROICが取得できない場合、推測せず`missing_target_metric`を返す。

## `7203を分析して` の再現手順

1. `.env`に`OPENAI_API_KEY`、`EDINETDB_API_KEY`、`JQUANTS_API_KEY`を設定する。
2. `bun run start`でDexter JPを起動する。
3. `/model`でOpenAIの`GPT 5.6 Terra`を選ぶ。保存済みのモデル設定がない場合は、OpenAI一覧の先頭にあるTerraが選択される。
4. `7203を分析して`と入力する。
5. 最終出力に次の見出しがあり、各重要値に基準日があることを確認する。

```text
# Summary
# Data Dates
# Fundamental
# Valuation
# Peer Comparison
# Technical
# Supply & Demand
# Market Correlation
# Entry / Stop / Target
# Bull / Base / Bear
# Risks
# Conclusion
```

実API検証は41.4秒、入力243,267 tokens、出力4,689 tokens、合計247,956 tokensで完了した。すべての必須フェーズが呼び出され、最終レポートに欠落はなかった。

## 検証コマンド

```text
bun test
bun run typecheck
bun run start
```
