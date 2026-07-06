# QuickCal

サッと予定をGoogleカレンダーに登録できる1枚HTMLアプリ。

- 日本語かんたん入力（例:「明日15時から16時 打ち合わせ @押上」）→ 自動でフォームに振り分け
- Googleカレンダーの登録画面をワンタップで開く（保存は本人が確定）
- クイックメモ → Obsidian（obsidian:// URL連携）
- Google Calendar API（読み取り専用）で今日・明日の予定表示／ダブルブッキング警告／確認済みチェック
- PWA対応（スマホのホーム画面に追加してアプリとして使える）

## 使い方

https://hirachan-glitch.github.io/quickcal/ を開くだけ。
予定確認機能はGoogle CloudでOAuthクライアントIDを作成し、アプリ内の⚙から設定（アプリ内に手順あり）。
