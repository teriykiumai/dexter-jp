# 日本株AI分析システム — ユーザー準備手順

**対象:** プロジェクト利用者

**目的:** ローカルでの利用と開発に必要な人間側の準備を確認する。

**前提:** 完全な個人利用・ローカル実行。

## 1. このファイルの役割

このファイルには **ユーザー自身が行う作業だけ** を記載する。

- Codexの実装作業 → 対象phaseの`docs/*_PLAN.md`
- 開発ルール → `AGENTS.md`
- 仕様 → `SPEC.md`

## 2. 必須アカウント

### 2.1 EDINET DB

用途:
- 財務データ
- 有価証券報告書
- 財務指標
- スクリーニング
- 株主関連データ

作業:
- [ ] EDINET DBのアカウントを作成する
- [ ] APIキーを取得する
- [ ] APIキーを安全な場所へ保存する

初期方針:
- 開発開始時はFreeプランから始める

完了条件:
```text
EDINETDB_API_KEY
```
として使用できるAPIキーを取得済み。

### 2.2 J-Quants

用途:
- 株価OHLCV
- TOPIX
- 信用取引データ
- 過去のEntry / Stop / TargetのStrategy validation
- 将来的な指数 / 需給関連データ

作業:
- [ ] J-Quantsアカウントを作成する
- [ ] APIキーを取得する
- [ ] APIキーを安全な場所へ保存する

プラン方針:
- 最初はFreeでもよい
- MVPでは信用残を利用するため、実APIテスト段階で必要なプランへ変更する可能性がある
- Strategy validationでは、基準日の前251 official sessionsと最大t79までの
  calendar / historical master / raw daily barsを取得できる履歴範囲が必要
- プラン変更は、実装時点の公式仕様を確認して判断する

完了条件:
```text
JQUANTS_API_KEY
```
として使用できるAPIキーを取得済み。

## 3. GitHub

### 3.1 GitHubアカウント
- [ ] GitHubへログインできる

### 3.2 Dexter JPをFork

本家:
```text
edinetdb/dexter-jp
```

を自分のGitHubアカウントへForkする。

- [ ] Fork完了

## 4. ローカル開発環境

### 4.1 Git

確認:
```bash
git --version
```

バージョンが表示されればOK。

- [ ] Git確認済み

### 4.2 Bun

Dexter JPのTypeScript実行環境。

確認:
```bash
bun --version
```

バージョンが表示されればOK。

- [ ] Bun確認済み

注意:
- `bun install` や `bun test` まで事前に実行する必要はない
- プロジェクト依存関係のインストール・テストはCodexのStep 0で行う

## 5. Codex

以下のいずれかでローカルrepoを扱える状態にする。

- Codex app
- VS Code等のCodex対応環境
- Codex CLI

完了条件:
- [ ] Codexからローカルrepoを開ける
- [ ] ファイルを読める
- [ ] 必要に応じターミナルコマンドを実行できる

## 6. Dexter JPをclone

Forkした自分のrepositoryをcloneする。

```bash
git clone <YOUR_FORK_URL>
cd dexter-jp
```

本家をupstreamとして登録する。

```bash
git remote add upstream https://github.com/edinetdb/dexter-jp.git
git remote -v
```

想定:
```text
origin   -> 自分のFork
upstream -> edinetdb/dexter-jp
```

- [ ] clone完了
- [ ] upstream登録完了

## 7. プロジェクト文書を配置

repo内に以下を置く。

```text
AGENTS.md

docs/
├── SPEC.md
├── USER_SETUP.md
└── MVP_IMPLEMENTATION_PLAN.md
```

- [ ] 配置完了

## 8. `.env`

APIキーはGit管理しない。

既存の `env.example` / READMEに従い、ローカル `.env` を作成する。

概念例:
```bash
EDINETDB_API_KEY=...
JQUANTS_API_KEY=...
# 任意。未設定時は5。1〜500の整数で契約上限以下に設定する。
JQUANTS_REQUESTS_PER_MINUTE=5
```

Dexter JP本体で利用するLLMに応じて、必要なLLM資格情報を追加する。

重要:
- `.env` をGitHubへcommitしない
- APIキーをREADME / issue / chat log等へ貼らない
- APIキーをソースコードへ直接書かない
- Strategy validationのCLI / Dashboardが表示する外部送信、最少request数、
  rateとsubscription quotaのwarningを、実行ごとに確認する
- `JQUANTS_REQUESTS_PER_MINUTE`は契約上限を自動取得しないため、契約値より
  高い設定にしない

- [ ] `.env`作成済み
- [ ] APIキー設定済み

### 8.1 Strategy validationを使用する場合

- [ ] 対象基準日とoutcome horizonがJ-Quants契約プランの履歴範囲内
- [ ] `JQUANTS_REQUESTS_PER_MINUTE`が契約のrequest上限以下
- [ ] 外部送信とsubscription quota消費の可能性を実行ごとに確認できる
- [ ] runを公開するPCがWindows

Phase 4のdefault repositoryは、directoryのatomic no-replace publishを保証できる
Windowsでのみrunを公開します。それ以外のplatformは`publish_unsupported`で
fail closedし、partial runを代替公開しません。Python、Docker、別databaseは不要です。

## 9. Dexter JP自身が使用するLLM

Codexは「開発するAI」。

Dexter JP内で分析を実行するLLMは別途必要になる場合がある。

使用するproviderは既存Dexter JPの対応範囲から選ぶ。

MVP実装開始時点で固定する必要はないが、E2Eテストまでには1つ動作するproviderを準備する。

- [ ] E2Eテスト前までにLLMを1つ準備

## 10. 今回不要なもの

個人・ローカル用途のため、MVP開始前に以下を準備しない。

- Python / uv / pandas
- PostgreSQL / Redis
- Docker / Kubernetes
- AWS / GCP / Azure / Vercel
- 独自ドメイン / SSL
- OAuth
- Stripe
- 公開Webサーバー

将来、本当に必要になった時点で検討する。

## 11. Step 0開始前チェック

以下がすべてYESならCodexのStep 0へ進める。

```text
[ ] EDINET DB APIキーを取得した
[ ] J-Quants APIキーを取得した
[ ] Dexter JPをForkした
[ ] Gitが使える
[ ] Bunが使える
[ ] Forkをcloneした
[ ] upstreamを登録した
[ ] Codexからrepoを開ける
[ ] AGENTS.md / docs/*.md をrepoへ配置した
[ ] .envを作成した
```

## 12. Step 0開始時にCodexへ伝えること

```text
AGENTS.md、docs/SPEC.md、docs/MVP_IMPLEMENTATION_PLAN.md を読んで、
Step 0を実施してください。
```

以降の実装作業は `MVP_IMPLEMENTATION_PLAN.md` に従う。
