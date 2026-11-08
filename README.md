# BMSG-PJ

BMSG Universe Apps Script source.

Song / Lyrics / Guest writes are centralized in BMSG-DB via the pinned Apps Script library. Image management remains owned by BMSG-PJ. Runtime spreadsheet Config counters are no longer used by the new management paths.

Server側の共通利用ユーザーID／表示名は `Config.gs` の `UNIVERSE_CONFIG.USER_IDS`／`USER_DISPLAY_NAMES` を唯一の定義元とする。各Serviceへ同じ値を再定義しない。Client側の初期選択UIは現行構成を維持する。
BMSG-DB更新時は同Repositoryのworkflow summaryで作成版を確認し、`appsscript.json`のBMSGDB固定versionを更新してBMSG-PJをdeployする。Library作成だけでは本番PJへの反映完了と扱わない。
deploy前に `node scripts/validate-gas-sources.mjs` と `node --test tests/*.test.mjs` を実行し、GAS／Client script構文・Runtime関数名重複・BMSGDB固定参照・利用ユーザー定義重複を確認する。

このRepositoryは BMSG Universe サイト本体の現行実装を管理する。

【現行Authority】
- 実装正本: GitHub `kotori118/BMSG-PJ` main
- DB管理GAS正本: GitHub `kotori118/BMSG-DB` main
- 仕様正本: Google Drive の最新「BMSG Universe 現行仕様書」
- デザイン正本: Google Drive の最新「BMSG Universe PHASE3 デザイン仕様書」
- 変更履歴: Google Drive の最新「BMSG Universe 変更履歴」
- GAS構成・実装方針: Google Drive の最新「GAS一括実装仕様書」

【開発原則】
- コード変更前に必ずDriveの最新仕様書・指示書を確認する。
- 変更があった場合は新規文書を作らず、既存の最新正本へ追記し、変更履歴を残す。
- 現行機能・UI・文言・Motion・保存挙動を壊さない非破壊変更を原則とする。
- Runtimeには最終版だけを残し、Fixes / Polish / V2 / V3 / Final等の一時的Override層は、Source Ownerへ最終挙動を吸収・検証後に削除する。
- 現行の責務分割を構成の基準とし、個別変更の都合だけでOwnerやService境界を混在・統合しない。
- 各Runtime関数の正本は1つのSource Ownerに限定する。実装前にRepository全体を検索し、同名関数・同等責務・後勝ち再代入・Wrapper Overrideを残さず、Owner本体を直接変更する。
- 新規ファイルは、独立した責務・規模・拡張性から分離が妥当な場合に追加してよい。その際はIndexのinclude順、READMEの責務、Drive正本と変更履歴を同時に更新する。
- Shared LoadingはStateUI、Typographyの基礎はStyles、共通Button／46px NavigationはButtonSystemを正式Ownerとする。
- 動的DOMは生成元が最初から正しい文言・class・styleを出力し、完成形でMutationObserverによる表示後補正に依存しない。
- 修正履歴はGitに残す。
- GAS変更はGitHub main反映後、Deploy to GAS workflowの成功まで確認する。

【現行構成方針】
1. APP CORE
   - Entry / Config
   - Repository
   - Router / Shared UI
   - Shared Component
2. SERVICE SERVER
   - Profile
   - Lyrics / Karaoke
   - Analysis
   - Card
   - Poker
   - Quiz
   - Cover
   - Performance Timer
3. SERVICE CLIENT
   - Page / Styles / Scripts
4. FEATURE-SPECIFIC MODULE
   - 責務分割が必要な大規模機能のみ

【非破壊リファクタリング】
成功条件は、現行の機能・UI・操作・文言・Motion・保存挙動に意図しない差がないこと。
旧Override層を削除する前に、最終挙動をSource Ownerへ吸収し、依存・Load Order・CSS specificity・media query・Safari対策・reduced-motionを含めて同値確認する。
実機確認が必要なClient変更は、Desktop / iPhoneの確認を通過するまで旧Runtime Authorityを削除しない。

【共通デザインAuthority】
- 常設共通UIに星モチーフを使用しない。
- 星・Orbit・流星等はSONG GACHA / TRADING CARD Reveal等の一時的ゲーム演出に限定する。
- 日本語は Zen Kaku Gothic New。
- 英字Role Fontは Orbitron / Exo 2 / Roboto。
- 共通Motionと機能固有Effectを分離し、prefers-reduced-motionを尊重する。

※ 過去のPrototype ZIP名・個別Fix手順はGit履歴およびDrive変更履歴を参照し、このREADMEを現行実装Authorityの代替にはしない。


## 映像出演分析（実装済み・未デプロイ）

- 閲覧入口：ANALYSIS の「映像出演」。管理入口：SETTINGS → ツール → 映像出演計測。
- Server owners：AppearanceRepository.gs（2シート読取・列名対応・ロック・原子的書込）、AppearanceApi.gs（動画CRUD・YouTube情報取得・保存）、AppearanceStats.gs（純粋集計）。既存Song/Lyrics/GuestのBMSGDB Writer責務は変更しない。
- Client owners：AppearancePage / AppearanceStyles / AppearanceScripts（管理・計測）、AppearanceAnalysis（分析表示）。Router / Settings / AnalysisScriptsの既存Ownerへ入口・離脱保護を統合する。
- データ正本：Core DB既存12_Videos（9列）／13_VideoSegments（4列）。追加シート・ID・ログテーブル・端末永続下書きは作らない。
- 区間は半開区間。NONEを分母に含み、ALLは個人へ加算、ペアから除外。作業中の保存済み区間も集計対象。0秒はデータなし、未計測残ありは暫定。
- 保存・動画情報変更・削除はScriptLock＋Revision照合。区間置換と動画更新はSheets REST APIの単一batchUpdateで行う。保存結果不明の場合は編集中データを保持し、再取得で照合してから再試行する。
- YouTube情報はサーバーからvideos.listで取得。ライブ配信中／配信予定・埋め込み不可は計測を停止。自動取得失敗時は手入力可能。既存動画のタイトル／公開日は自動上書きしない。

### 公開前の設定・確認

1. Google Cloudの対象プロジェクトでYouTube Data API v3を有効にし、APIキーを作成する。API制限はYouTube Data API v3に限定する。
2. BMSG-PJ側Apps Scriptの「プロジェクトの設定 → スクリプト プロパティ」に `YOUTUBE_API_KEY` を設定する。キーをGit、HTML、チャット、スプレッドシートへ記載しない。GASのサーバー呼出しのためブラウザー向けHTTPリファラー制限は使用しない。
3. Sheets REST APIで書込できるよう対象CloudプロジェクトのGoogle Sheets APIを確認し、GASの外部通信／スプレッドシート権限を再承認する。Advanced Sheets Serviceの追加は不要。
4. `node scripts/validate-gas-sources.mjs` と `node --test tests/*.test.mjs` を実行する。
5. 利用者のデプロイ許可後にのみmainへmergeする。現行workflowはmain／メインpushでGAS転送・deployを自動実行するため、許可前のmerge、main push、workflow_dispatchは禁止。
6. 許可後の検証環境でYouTube自動情報取得、iPhoneのinline再生・シーク・動画終了、埋め込み不可、実スプシ保存・競合・削除を確認する。ローカルテストはこれらの実機確認の代替ではない。

設計書： https://docs.google.com/document/d/1CrqluzGyTAqVhLxduTmyJN4EvFyOaZNGVU9nQ32Y8Sw/edit

### 2026-11-08 追加監査（未デプロイ）

- 更新・保存・削除APIは期待Revisionを必須とし、省略による競合検出の迂回を拒否する。
- 結果不明の保存を照合する間は区間の追加・変更・削除・取り消し・選択解除を停止。buffering中の選択を拒否し、再生位置取得に失敗した場合は選択状態を変更しない。
- 既存分析Bootstrapの遅延応答で映像出演分析の期間指定をリセットしない。共通グラフ破棄時はTooltipの遅延タイマーも解除する。
- 計測済み動画のURL訂正は、同じ動画であることの明示確認後、既存区間を保持して許可する。動画長以内・ID重複・Revision検証は維持する。
- 管理カード・入力・エラーはManagementSystem、ボタンのサイズ・選択・危険操作の外観はButtonSystem、分析表・グラフは既存AnalysisScriptsを再利用。機能側の独自表ラッパー、未使用状態、未使用API戻り値とCSSを削除した。
- 静的検査はasync functionの重複も検出する。実Indexの67 include／44 script blockは結合してコンパイル確認済み。
- Node26テスト成功。現在のスプレッドシートの読み取りスナップショットをローカル再生し、83動画／URL未登録29／6メンバーの読込を確認。実スプレッドシートへの書込・外部API実通信・実機Visual QAは未実施。
