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
| valuation | PASS | 2026-08-21終値3132円とFY2026の調整後EPS・BPS・配当からFinancial Metrics EngineがPER、PBR、配当利回りを算出 |
| growth | PASS | FY2021〜FY2026の売上高からFinancial Metrics Engineが5期間CAGRを算出 |
| peer | PASS | 各metricを独立screenして24社のsame-sector unionを作成。Peer Engineがmetric単位で無効・欠損値を除外し、10 peersを選定 |
| stock OHLCV | PASS | 279営業日。最新日は2026-08-21 |
| margin | PASS | 57週。最新日は2026-08-14 |
| TOPIX | PASS | 279営業日。最新日は2026-08-21 |
| technical | PASS | SMA20、ATR14、平均出来高、Swing High/Low、Trendを全履歴から計算 |
| supply-demand | PASS | 信用倍率、前週比、13/52週平均、52週乖離・Percentile、信用消化日数を計算 |
| correlation | PASS | TOPIXとの60日・250日統計を日付のinner joinで計算 |
| strategy | PASS | Swing Highのstrictly-above triggerを返した。sourced tickSizeがないためexact Entry/Stop/Targetと2Rを生成しないことを確認 |
| data dates | PASS | 財務、株価、信用、TOPIXごとの基準日を保持 |
| missing-data behavior | PASS | 履歴不足やtickSize欠損時に値を補完せず、利用不可理由を返すことを確認 |
| final report | PASS | 6 iterationsで全MVP分析ツールを呼び出し、指定された全見出しを含む最終レポートを生成 |

### 主要な実測結果

- 財務source値: 売上高50兆6,849億円、営業利益3兆7,662億円、純利益3兆8,481億円、ROE 10.1%
- Financial Metrics Engine（株価2026-08-21、財務2026-06-10）:
  - PER: 10.6079593565倍
  - PBR: 1.0225870276倍
  - 配当利回り: 3.0332056194%
  - 売上高CAGR（FY2021〜FY2026、5期間）: 13.2440612442%
- Peer Engine（source data 2026-08-23）: PER中央値12.0倍、PBR中央値0.95倍、ROE中央値8.22%、ROIC中央値8.21%、営業利益率中央値4.47%、配当利回り中央値3.44%
- Technical（2026-08-21）: 終値3132円、SMA20 3010.35円、ATR14 80.68円、Swing High 3233円、Swing Low 2869.5円、Range / Transition
- Supply & Demand（2026-08-14）: 信用倍率13.12倍、52週平均比+49.7%、52週Percentile 82.4%、信用消化日数0.53日
- TOPIX相関（2026-08-21）: 60日相関0.37・β0.58、250日相関0.61・β0.92
- Strategy: 3233円を厳密に上回ることをEntry triggerとして返した。tickSizeのsourceがないため、exact Entry/Stop/TargetおよびRisk/Rewardは利用不可

Peer候補の時価総額が取得できなかったため、時価総額0.3〜3倍優先は適用せずデータ制約として明示した。

## 指標の出所

| 指標 | 出所 | LLMの役割 |
| --- | --- | --- |
| 財務諸表値・EPS・BPS・配当 | EDINET DB source tool | 取得値の説明のみ |
| 株価 | J-Quants source tool | 取得値の説明のみ |
| PER・PBR・配当利回り | `analyze_financial_metrics`の決定論的コード | 計算結果の解釈のみ |
| 売上高CAGR | `analyze_financial_metrics`の決定論的コード | 計算結果の解釈のみ |
| Peer各社のmetric | EDINET DB `company_screener` source値 | sourced fieldのmappingのみ |
| Peer中央値・順位・Percentile | `analyze_peer_comparison`の決定論的コード | 比較結果の解釈のみ |

PER、PBR、配当利回り、CAGRをLLM単独では計算していない。Valuation欄はFinancial Metrics Engineの値を使用する。Peer欄の対象会社metricは比較日現在のscreener source値であるため、基準日と算出系統を分けて記録する。

## レビュー修正で確認した事項

- direct ticker unit testは`JQUANTS_API_KEY`をテスト内でダミー値に差し替え、`finally`で元の値へ復元する。GitHub Actionsに実キーは不要。
- tickSize未指定時はSwing Highをtrigger priceとして保持するが、実行価格をnullとし、exact 2R候補を生成しない。
- tickSize指定時はEntryをSwing Highより上の最初のtick、Swing/ATR Stopを元水準以下のtick、2R Targetを2R以上のtick、Resistance Targetを元水準以下のtickへ整合する。tickSizeはsourced inputだけを受け付け、推測しない。
- Peer候補はrevenue、PER、PBR、ROE、ROIC、営業利益率、売上高成長率、配当利回りを8件の独立条件で取得し、securities codeでunion結合する。複数metricのAND条件は使わない。
- PER/PBRの非正値と配当利回りの負値はPeer Engine内で該当metricだけ利用不可とする。ROE、ROIC、利益率、成長率の負値は意味のある値として維持する。
- ModelSelection、標準Agent、LLM helper、Gateway、Cronの未設定時defaultを`gpt-5.6-terra`へ統一した。保存済みまたは明示指定されたモデルは上書きしない。

## 欠損データ検証

- OHLCVを10本に制限すると、SMA20、ATR14、平均出来高、Swing、Trendが利用不可になる。
- 信用履歴を1週に制限すると、前週比、13/52週統計、信用消化日数が`insufficient_history`になる。
- 株価とTOPIXを30日に制限すると、60日・250日統計が`insufficient_history`になる。
- 財務履歴が1期だけの場合、CAGRを生成せず`insufficient_financial_history`を返す。
- EPS/BPS/売上高の分母がゼロまたは非正の場合、該当ratio/CAGRを生成しない。
- Swing Highを欠損させるとEntry triggerを生成しない。
- Swing HighがあってもtickSizeが欠損している場合、exact Entry/Stop/Targetを生成しない。
- Peerの特定metricが欠損または無効でも、その会社を他metricの比較から除外しない。

## `7203を分析して` の再現手順

1. `.env`に`OPENAI_API_KEY`、`EDINETDB_API_KEY`、`JQUANTS_API_KEY`を設定する。
2. `bun run start`でDexter JPを起動する。
3. 保存済みのモデル指定がなければ、OpenAI／Agentともに`GPT 5.6 Terra`が既定で選択される。
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

実API検証は45.287秒、main Agent loopで観測された入力271,485 tokens、出力4,411 tokens、合計275,896 tokensで完了した。この値は`get_financials`や`company_screener`内部のnested LLM callを含む総API token量ではない。呼び出された主要ツールは`get_financials`、`company_screener`、J-Quants 3 tools、6 deterministic analysis tools、`read_filings`、`skill`で、必須フェーズの欠落やtool errorはなかった。

## 検証コマンド

```text
bun test
bun run typecheck
git diff --check
bun run start
```
