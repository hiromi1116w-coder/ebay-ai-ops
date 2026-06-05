# PC移行ハンドオフ（発送ラベル自動化）

**作成日**: 2026-06-02  
**次の作業**: **B → A**（郵便局 Step3 セレクタ → eBay パイプライン）  
**新PC到着後**: このファイルを Cursor に渡して「HANDOFF.md を見て B→A を再開」と伝える。

---

## 旧PCで今すぐ実行（1コマンド）

PowerShell を **管理者不要** で開き、リポジトリルートで:

```powershell
cd C:\Users\admin\Desktop\eBay-AI-Ops
.\prepare_pc_migration.ps1
```

これで行うこと:

1. デスクトップに `eBay-AI-Ops-Migration-Backup` を作成（注文JSON・ログ等をコピー）
2. `secrets_TEMPLATE.txt` を出力（秘密情報は自分で記入）
3. `sample_order.json` / `label_input.json` を Git の追跡から外す（ファイルは残す）
4. 移行用ドキュメントとコードを `git commit` → `git push`

完了後:

- バックアップフォルダを **USB または暗号化クラウド** にコピー
- `docs/SECRETS_BACKUP_CHECKLIST.md` のチェックを埋める

---

## リポジトリ

| 項目 | 値 |
|------|-----|
| GitHub | https://github.com/hiromi1116w-coder/ebay-ai-ops.git |
| 作業フォルダ（旧PC） | `C:\Users\admin\Desktop\eBay-AI-Ops` |
| 推奨 clone 先（新PC） | `%USERPROFILE%\Desktop\eBay-AI-Ops` |

---

## 現在の進捗

### 完了していること

- eBay OAuth（Production）で User Access Token 取得済み（再取得が必要になる場合あり）
- `build_label_input.ps1` … 注文 JSON → `label_input.json`（ASCII化、`NO battery`、文字数制限）
- `run_label_demo_pipeline.ps1` … eBay 注文取得 → label_input → HTML プレビュー
- 郵便局 Playwright 自動入力（`npm run jp`）… **宛先（Step1〜2）は一部成功**
- `playwright_selectors_japanpost.sample.json` … 宛先欄のセレクタは一部設定済み
- `jp_form_fields_snapshot.json` … dump 結果（format 2）をコミット対象に含める
- 仕様 … `05_発送ラベル作成/運用手順.md` に完成系ルール確定

### いま止まっているところ（B の対象）

**Step3（内容品入力）以降**でセレクタが空または不一致。ログ上の典型:

```
ok: 6〜10 / total: 32
miss: itemTitle, itemOriginCountry, unitPriceJpy, sizeCmL/W/H, hsCode, weightGrams など
```

参照: `05_発送ラベル作成/jp_autofill_run_log.jsonl`（ローカルのみ・gitignore）

### 次にやること（B）

1. `label_input.json` に実測の `weightGrams` / `sizeCm` を入れる
2. ブラウザで日本郵便にログインし、**Step3（内容品）画面**まで手動で進める
3. その状態で:

```powershell
cd 05_発送ラベル作成
npm run jp:dump
npm run jp:hint
```

4. ヒントを `playwright_selectors_japanpost.sample.json` の `fields` / `clicks` に反映
5. `npm run jp` で再試行 → 改善したら `git commit` + `git push`

詳細手順: `05_発送ラベル作成/STEPS_4_5_6.txt`

### その次（A）

```powershell
# EBAY_ACCESS_TOKEN をユーザー環境変数に設定済みなら
.\run_label_demo_pipeline.ps1
```

トークン期限切れ時は `oauth_callback_server.py` + ngrok で OAuth 再実行。

---

## 新PCセットアップ（初日チェックリスト）

```powershell
# 1. クローン
cd $env:USERPROFILE\Desktop
git clone https://github.com/hiromi1116w-coder/ebay-ai-ops.git
cd eBay-AI-Ops\05_発送ラベル作成

# 2. 依存関係
npm install
npx playwright install chromium

# 3. トークン（バックアップから復元）
[System.Environment]::SetEnvironmentVariable("EBAY_ACCESS_TOKEN", "（ここにトークン）", "User")
# 新しい PowerShell を開き直す

# 4. 動作確認
node -v
npm run jp:hint
```

旧PCバックアップからコピー（任意）:

- `Migration-Backup/` フォルダ一式（`prepare_pc_migration.ps1` で作成）
- 特に `sample_order.json`（実注文・個人情報あり）

---

## 秘密情報（Git に入れない）

`docs/SECRETS_BACKUP_CHECKLIST.md` を参照。パスワード管理アプリ等に保存すること。

- eBay Client ID / Client Secret
- User Access Token / Refresh Token（あれば）
- ngrok の URL（OAuth リダイレクト用）
- eBay Developer: RuName、リダイレクト URL 設定
- 日本郵便ログイン（自動ログイン予定時）

---

## 主要コマンド早見

| 目的 | コマンド |
|------|----------|
| 郵便局自動入力 | `npm run jp` または `.\run_japanpost_through.ps1` |
| DOM dump | `npm run jp:dump` |
| セレクタヒント | `npm run jp:hint` |
| eBay→label | `.\run_label_demo_pipeline.ps1` |
| OAuth コールバック待受 | `python oauth_callback_server.py`（ルート） |

---

## 注意

- `sample_order.json` は **実バイヤー情報を含む**ため Git 対象外（`.gitignore`）
- 既に GitHub に上がっている場合は `git rm --cached` で履歴から外す（`prepare_pc_migration.ps1` 参照）
- ngrok URL が変わると eBay Developer のリダイレクト URL 更新が必要
