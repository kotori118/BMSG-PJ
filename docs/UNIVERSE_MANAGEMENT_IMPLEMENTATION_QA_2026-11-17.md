# MANAGEMENT 実装・検証記録（2026-11-17）

状態：開発ブランチの実装。**本番未反映／Apps Script統合・実機Visual未検証**。
対象ブランチ：`feature/universe-catalog-site-only-20261117`。
開始点：PJ `557e9e8cd16ae8aaa9e6daa5e110364ad3153583`、DB `c3685468b68c56eeba393818661a8cd0186b328f`。

## 1. 最終画面構成

SETTINGSの「管理ページを開く」から `page=manage`。カテゴリ／操作は `section`／`action` をURL履歴へ保持する。

| カテゴリ | 実装した操作 | 権限 |
|---|---|---|
| 楽曲・歌詞 | 楽曲を追加、楽曲を編集 | 既存3ユーザー。歌詞なし・ソロ分類・削除は既存カタログ管理者ゲート |
| メンバー・プロフィール | メンバーを追加、メンバー情報を編集、プロフィールを編集、プロフィール項目を管理 | 値編集は既存ユーザー、その他は既存管理者ゲート |
| グループ・ユニット | 追加、編集、ユニットのメンバーを管理 | 既存管理者ゲート |
| メンバー画像 | 画像を登録・差し替え、既存の欠落画像修復 | 既存3ユーザーによる操作を維持 |
| データ点検・保守 | データを点検（読取専用） | 管理者のみ、管理トップ下段 |

未実装・非表示：ゲスト訂正／削除、画像表示設定、Audit履歴専用画面、バックアップ・移行UI、グループの表示順変更／削除、プロフィール項目名・分類・順番変更。既存の歌詞解析時ゲスト登録は残す。スキーマ移行APIは既存ゲート付きで保持するが通常画面の移行ボタンを撤去。

メンバーの新規表示順は既存Writerどおり末尾に自動追加し、登録後は初期プロフィール入力へ進む（登録とプロフィール保存は別操作）。既存メンバーの順番は既存の上下移動を使用。グループの初期順も既存自動採番・末尾追加を維持。

## 2. 機能統合

- 歌詞あり／なしは同じ楽曲登録フォーム内の選択。曲情報・BE:FIRSTの制作クレジット・歌詞解析・ゲスト登録・歌割りを既存SLMから再利用。
- ソロ曲＋歌詞ありも、既存Catalogエンドポイントから既存 `createSongWithPartsCore_` の1回のトランザクションへ渡す。曲登録後に別処理で分類する方式は使わない。旧歌詞なし呼出しは互換維持。
- 楽曲検索・選択→基本情報／クレジット／歌詞・歌唱者・ハモリ／ソロ分類→最下部の削除確認。削除は選択済みSongIDだけを対象にし、依存プレビュー・ID入力・外部参照確認・バックアップ・feature flagを維持。
- 部分保存後はサーバーから再取得し、他セクションの未保存クレジット・歌詞を保持する。
- メンバーの基本情報、主所属、並べ替え、削除は1つの選択対象へ同期。削除は選択するまで表示しない。
- ユニット参加・解除・上下移動は既存API・expectedOrder検証を再利用。主所属・本体・プロフィール・他ユニットを変更しない。
- Profile／Image管理の候補はCoreの所属名も反映。新グループ所属のメンバーが固定5カテゴリ制限で編集できなくなる問題を解消。旧5xxのPOSSE fallbackは明示GroupIDがない場合のみ維持。
- 新しい認証方式は導入しない。入口表示と管理者認証を分離。Profile／Image書込も既存3ユーザーIDをサーバー側で検証する。UserID自体をGoogle本人確認と見なさない。

## 3. 変更ファイルと責務

| ファイル | 変更 |
|---|---|
| ManagementPage.html / ManagementPageApi.gs | 管理トップ・階層・権限別メニュー・Editor mount／park・非同期応答の世代／利用者チェック・離脱／unload保護 |
| AppCore / Router / Settings / AppOverlays / Index | manageルート、URL・履歴・ユーザー切替の保護、SETTINGS入口1つ、include整理 |
| ManagementSystem.html | ページ配置・1列／2列・パンくず・44px・16px入力・safe-area。既存ButtonSystem／Styles／StateUIを利用 |
| CatalogManagement.html / SongLyricsManagement.html | 旧管理ホーム／タブ・重複曲登録UI撤去。既存操作をページ内に配置、入力保持とbusyを統合 |
| ProfileManagement.html / ImageManagement.html | 既存フォームをページへ移し、二重送信抑止・保存後再取得を追加 |
| SongLyricsManagementApi / ProfileManagementApi / ImageManagementApi | 既存Writerの再利用、ソロ情報読取、ユーザー検証、候補グループ対応 |
| BMSG-DB CatalogManagement.gs | 歌詞付きソロ登録を既存共通Writerへ原子的に渡す |
| tests、package.json / lock、PR検証workflow | VM／DOM統合試験を追加。jsdomは開発検証専用。deploy workflowは変更なし |
| .claspignore / .gitignore | 検証依存物・検証資料をGAS転送対象外にする |

## 4. 旧コード・重複監査

- `ImageManagementEntry.html`、`ProfileManagementEntry.html`、`SongLyricsManagementEntry.html`、`CatalogManagementEntry.html`を削除。Index／SETTINGSからの参照を先に置換し、実装ソースの旧入口参照0件を確認。
- 旧管理モーダルの外枠と閉じる／背景クリック関数を撤去。確認ダイアログ（ゲスト登録／画像差し替え）は残す。
- Catalogの5タブ・通常画面の移行ボタン・独立した歌詞なし曲登録フォーム・旧SLMホームを撤去。曲分類／削除はSLMの選択対象に統合。
- データ書込ロジックのコピーや新しい採番形式は追加しない。既存Core Writer、ライブラリ、キャッシュ無効化、ロックを利用。
- GAS／HTML構文・Runtime関数名重複検査に合格。既存の未リリースメンバー・項目・ユニット・クイズ撤去変更は維持。

## 5. 検証結果

- PJ：GAS27／HTML63の構文・重複・固定ライブラリ契約検査に合格。
- PJ：Node試験44件合格（うち実DOM統合8件）。11操作のマウント、権限別メニュー、不正URL、二重保存、カラー重複、保存失敗時の入力保持、楽曲登録の両経路、部分保存時の他欄保持、プロフィール再取得、削除対象同期、履歴キャンセルを検証。
- DB：GAS13の静的検査、Node49件合格。新規の歌詞付きソロ原子登録・不正解析拒否・従来歌詞なし互換を含む。既存のユニット・項目値保持・rollback等の試験も合格。
- `git diff --check` 合格。
- GitHub Actionsの実行結果はPRの最新checkを参照（本書ローカル結果と区別）。
- **未実施**：実Apps Script Web AppでのGoogle権限・ライブラリ接続・実DB保存、Safari/iPhone、Dark/Lightの描画比較、実画面スクロール・safe-area・キーボード、PROFILE/KARAOKE/QUIZ/COVER/ANALYSISの実機一巡。
- Chromiumは起動時に `socket() failed: Operation not permitted` で終了。jsdomでのDOM試験はレイアウト／Safariの保証ではない。

## 6. デザイン・DBへの影響

HOMEと同じ既存のカテゴリ見出し、共通u-btn、管理フォーム／カード、StateUI loading、Soft Cyan、Dark/Light変数を再利用。新規CSSは共通ManagementSystem内のページ配置と必要な管理テーマ状態に限定。実画面の視覚一致は未確認。

HOME／DATA／LAB下部ナビ、metrics独立ツール、LYRICS直接編集の保存処理・3ユーザー権限を維持。`10_PerformanceMetrics`を維持。動画UI・12／13再作成・11物理削除は実施しない。

本番Core／Log、テストCore／Log、既存バックアップへ書込なし。シート・列・ID・保存形式・共有設定は未変更。旧入力3シートを削除していない。ライブラリ固定版14を変更せず、GAS push／version作成／deploy／main mergeなし。

## 7. 別途承認後の公開手順と切り戻し

1. まず独立した検証GASと複製Core／Logを使い、両開発ブランチを接続して上記未実施項目を完了する。本番への接続は禁止したまま検証する。
2. Core／Logのバックアップ・既存スキーマ／管理者allowlist・feature flagを確認。既存移行条件を満たすまで新カタログ操作はfail-closed。
3. **改めて公開承認を受けた別作業でのみ**、DBの確定版発行→PJライブラリ固定版更新→PJ公開版更新を行う。現ブランチをそのまま本番へpushしない。
4. ロールバックは直前のPJ deployment／BMSGDB固定版に戻し、追加管理flagをOFFにする。今回のUI変更自体にはDB移行なし。将来移行・データ書込を行った場合は、その別作業のバックアップと復旧手順で扱う。
5. Draft PR #64／#3は未mergeのまま保持する。
