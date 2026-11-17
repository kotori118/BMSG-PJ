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

## 8. デプロイ直前の全体監査（2026-11-17・公開停止）

**判定：現段階ではデプロイ不可。管理画面だけで全ての日常マスター管理を完結する状態には達していない。**

対象HEAD：PJ `92d3eed808348726d07e6e55bd8a86270f4d7f80`／DB `149d3dc1e222fbbe4b087eb2b145699bb09d8c31`。両リポジトリをfetchし最新HEADが一致することを確認した。旧節の「実装済み」は各記載範囲の実装状態であり、公開可・全操作網羅を意味しない。本節の公開停止判定を優先する。

### 8.1 再現した問題

追加した `audit/management-predeploy.test.mjs` は期待する正常動作を検証する試験。**7件中1件成功・6件失敗**。失敗は既知の公開阻害事項として残し、PR検証workflowに監査試験を追加した。実装の修正は本監査では行っていない。

| ID | 問題・再現手順 | 影響・該当箇所 |
|---|---|---|
| A1 | メンバー編集でAを選択→名前を編集→Bへ切替。破棄確認が呼ばれず入力がBの値に置換される | 未保存内容の消失。CatalogManagement.html `cmRender_` の対象変更処理。グループ切替も同様の保護がない |
| A2 | 既存曲を開いた後、曲の選択画面へ直接戻るボタンがない | 一度カテゴリへ戻り編集操作へ入り直す必要がある。`backSlmExistingSelect` は定義のみでUI参照がない |
| A3 | 楽曲追加で歌詞なしを選択し最終工程へ進むと、楽曲情報へ戻って訂正する操作がない | カテゴリに戻ると未保存フォーム破棄を伴う。SongLyricsManagement.html `slmLyricsInputHtml_` |
| A4 | 未登録Guestの確認で登録を2回押すと `registerSongLyricsGuest` 要求が2回送られる | 確認ボタンがbusy制御の対象外かつhandlerにbusy guardなし。DBの共有Writer・同名確認は維持されており、実DBで2行できるとまでは断定しない |
| A5 | 管理用schema未準備でメンバー編集を描画すると、存在しないselectのvalue参照でTypeError | 移行案内を安全に表示できない。CatalogManagement.html `cmRender_`。グループ編集にも同じ未準備時のイベント設定問題がある |
| A6 | 合成データで新規GROUPを追加してCard／Coverの実ビルダーへ渡しても選択肢に出ない | CardApi.gsのCARD_GROUP_NAMES_、CoverApi.gsのCOVER_DESTINATION_GROUPS_が固定。PROFILEもProfileApi.gsの主要4グループとProfileScripts.htmlの固定タブに依存。ALL表示で一部データが見えてもグループ別管理が完成したことにはならない |

成功した追加試験：ソロ分類の未保存入力は、基本情報の保存・再読込後にも保持されることを確認。

### 8.2 本番の読取専用確認と公開前準備

Google Sheets connectorでCore／Logのmetadataと必要なヘッダー行だけを読み取った。**書込なし**。

- Core `01_Groups`：現在は GroupID / GroupName / ColorHex / DisplayOrder。必要なGroupKind／RecordStatusがない。
- Core `02_Members`：現在は MemberID / GroupID / DisplayName / ColorHex / DisplayOrder。必要なRecordStatusがない。
- Core `06_Songs`：現在は SongID / Title / Artist / ReleaseDate / Form / CDTitle / IsTitleTrack。SongType／SoloMemberIDがない。
- Logの現存22タブに `CATALOG_Audit` がない。`catalogSchemaStatus_`／`catalogRequireReady_` により新管理の書込は拒否される。
- PJのBMSGDB参照は固定version14のまま。新Writer版の発行・固定版接続・schema移行・管理者／操作別flagの実設定確認が必要。単にPJをdeployしても新機能は完成しない。
- **schema不足の確認は、今回の監査でschemaを変更する許可とは扱わない。** 本番の列追加・シート追加・flag変更・version発行・deploy・mergeは行っていない。
- `10_PerformanceMetrics`、旧入力3シート、`11_PartTransfers`の存在をmetadataで確認。12／13は現存一覧にない。削除は行っていない。

### 8.3 スプレッドシートを開かずにできる範囲／残る操作

ここでいう「直接操作不要」は利用者がSheetsを開いて手入力しないこと。保存先のSheetsそのものを廃止する話ではない。以下はコード上の導線であり、実Apps Scriptでの成功は未保証。

| 対象 | 画面の既存操作 | 完結していない点 |
|---|---|---|
| 楽曲・歌詞 | 登録、タイトル等、歌詞・歌割り・歌唱者・ハモリ、BE:FIRSTの制作クレジット、ソロ分類、依存確認付き削除 | 登録後Artistの訂正はUI／Writerとも禁止。Artist誤登録の修正経路がない。BE:FIRST以外の制作クレジットは現行仕様上の対象外 |
| メンバー | 登録、名前・色、主所属変更、同じ主所属内の上下移動、参照ゼロ時の削除、プロフィール値編集 | 初期順は末尾自動のみ。Member.DisplayOrderと所属内DisplayOrderは別。メンバー並べ替えWriterは02_Membersのみ更新し、PROFILEのグループ別一覧は04_GroupMembers順を優先するため表示順の整合を追加検証する必要あり |
| グループ・ユニット | 登録、名前・色、ユニットの所属追加・除外・上下移動 | 表示順変更、GROUP／UNIT種別訂正、安全な削除なし。曲Artistに使用中のグループ名変更は拒否。新グループの既存画面反映にA6あり |
| プロフィール項目 | 追加、非表示、再表示。非表示値を保持 | 項目名・分類・順番の修正なし。型変更は元の設計どおり対象外 |
| ゲスト | 新曲の歌詞解析中に新規登録 | 名前訂正、統合、未使用ゲスト削除、単独管理画面なし。既存曲編集内で新Guestを作る専用導線もない |
| メンバー画像 | レアリティ別登録・差し替え・欠落画像修復 | メイン画像指定、表示順変更、不要画像削除なし |
| グループ／ブランド画像 | 09_Imagesの既存ロゴを各機能が読む | 登録・差し替えの管理UIなし。Core09_ImagesにはMember以外のTargetTypeもあるが現フォームはMember専用 |
| 秒数 | 独立metricsツールを維持 | MANAGEMENTへ統合しない確定仕様。日常作業はこの独立ツールを使う |
| 点検・保守 | 読み取り専用点検 | 異常の修復、操作履歴閲覧、バックアップ、移行・復旧のUIなし。IDRegistryは自動管理であり手動編集の追加は不要 |

上表の将来機能は前回指示で非表示とした項目であり、すべてが実装バグという意味ではない。ただし「Sheetsに一切手を入れず全項目を管理」の達成条件には不足する。

### 8.4 全体検査の実行結果と未確認

- 既存PJ44／DB49試験は再実行して全件成功。静的検査もPJ27 GAS／63 HTML、DB13 GASが成功。
- 追加監査は上記6件失敗。既存CI成功を理由に公開してよい状態とは判定しない。
- Runtime同名関数・構文、既存のカラー重複拒否、ユニット参照保護、プロフィール値保持、LYRICS直接編集・metrics・クイズ廃止契約は既存自動試験の範囲で維持。
- 実Apps Script・Google権限・ライブラリ版接続・実DB保存・Safari／iPhone・描画されたDark／Light・全機能実機一巡は未実施。DOM試験はこれらの代替にはならない。
- 修正順：A1／A4／A5→A2／A3／A6→日常管理に必要な未実装範囲の確定→独立GAS・複製DBで実保存／権限／回帰確認→必要な移行手順の別途確認→公開可否の再判定。

**今回の結論は「問題があるため公開保留」。条件付きのデプロイ依頼は実行していない。**

## 9. サイト完結化・ロゴ廃止・監査修正（2026-11-17）

利用者の追加指示「グループ／ブランドロゴ管理を廃止」「既存ロゴも消す」「全てサイトで完結する構成を実装」「不具合修正」を受けた開発版。第8節の過去の監査記録は保持し、修正状態は本節を優先する。**公開判定は保留継続**。実Apps Scriptでの接続・保存とiPhone表示は未確認。

### 9.1 最終構成・対象範囲

SETTINGSの「管理ページを開く」→ MANAGEMENT → 次の5カテゴリ → 操作画面。HOME／DATA／LABナビを維持。

| カテゴリ | 操作 |
|---|---|
| 楽曲・歌詞 | 楽曲追加（歌詞有無選択・ソロ）、楽曲編集／安全な削除、管理者のArtist訂正、ゲスト追加・名前訂正・参照統合・未使用時削除 |
| メンバー・プロフィール | メンバー追加・編集・安全な削除、主所属・順番、プロフィール値、項目追加・非表示・再表示・項目名／分類／順番 |
| グループ・ユニット | 追加、名前／カラー／種別／順番の編集、参照ゼロ時削除、ユニット所属追加・解除・順番 |
| メンバー画像 | 既存の登録・差し替え・欠落修復、メイン指定・順番・未参照画像の登録データ削除 |
| データ点検・保守（管理者のみ） | 既存監査、変更履歴閲覧、Core／Logバックアップ、管理データ復元、初期整備・移行、不足行修復、機能flag設定 |

日常マスター編集にSheetsの直接入力を要求しない構成をコード実装した。ただし任意の破損データを自由編集する汎用スプレッドシートの代替ではない。既存権限を維持し、新規の高度な操作は管理者限定。一般登録ユーザーのLYRICS部分編集、プロフィール・画像の既存権限は変更しない。

確定仕様による制約：制作クレジット・秒数の分析対象はBE:FIRST。BE:FIRSTのグループ名は分析キーとして固定。Artist訂正でBE:FIRST対象外へ移す際、クレジット・秒数があれば先にサイト上で内容を整理する。履歴から参照される画像・メンバー等の削除は拒否する。プロフィール項目の型／IDは変更しない。新メンバーの初期順は末尾、登録後に変更。これらは無制限編集の不足とは区別する。

### 9.2 修正と依存関係

A1〜A6を修正し監査7件すべて成功。対象切替の破棄確認、既存曲の選択への戻り、歌詞なし最終工程の戻り、Guest二重送信防止、schema不足時の安全な案内、Card／Coverのグループ動的選択を確認した。

PROFILE・LYRICS・QUIZも実グループデータを参照する。PROFILEの追加グループキーはGroupIDから作り、同じ英数字化結果の名前でも衝突しない。従来4グループのキーは維持。グループ名変更はSongs.ArtistとクイズCourseラベルを同じロールバック対象に含める。メンバー順番変更は02_Membersと主所属04_GroupMembersを同時更新し、他ユニットを維持する。保存後にクライアントの歌詞／プロフィールキャッシュも無効化する。

高度操作の画面はManagementOperations.html、PJの権限確認・明示allowlistの中継はManagementOperationsApi.gs、DBの整合性・共通Writer lock・監査・復旧はCatalogMaintenance.gsへ分離。既存のプロフィール項目追加／非表示／再表示、Guest登録、カラー重複検証、採番・既存保存APIを再利用。新たな同名関数は静的検査で検出されていない。既存Catalog APIは互換性のため維持し、旧グループ編集には新画面から遷移しない。以前撤去したEntry・モーダル外枠は復活させない。

ロゴ：Card/Poker等のbrandLogoDriveFileId／logoDriveFileId参照・payloadと未使用ロゴCSSを撤去。09_ImagesのGroup／Brand行は、承認後の初期整備操作でバックアップを作成したうえで消去するコードを追加。復元でも廃止ロゴを再導入しない。**現時点では本番行は未変更。元のDrive画像ファイルの物理削除・共有設定変更は行わない。** Member画像は対象外。不要メンバー画像も登録データのみ消し、欠落修復による再登録を監査履歴で防ぐ。

### 9.3 保守処理の保護

- バックアップ先は指定フォルダ1YD-Df-gJPyes1fCRFYsOj5kL4YLidTyqのみ。既存バックアップは変更・削除しない。
- 高度編集は変更前revision照合、保存失敗時の入力保持、二重送信防止。セル保存と監査失敗は既存値へ戻し照合する。
- 復元は登録済みバックアップだけ。影響preview・再確認・実行直前バックアップ・snapshot照合が必須。Core01〜10とLog ProfileSettingsのみを書き戻し、ゲーム／取得履歴、IDRegistry、監査履歴は巻き戻さない。列違い、ID重複、孤立参照、復元による履歴参照欠落を拒否する。
- 不足修復は根拠のあるプロフィール行・主所属行の補完のみ。重複ID等は自動削除しない。任意破損の自動修復は未実装。
- 初期整備は明示操作時だけ既存migration APIを呼ぶ。起動時にschemaやデータを変更しない。機能flagは限定5項目のみ、管理者allowlistや認証方式を変更しない。

### 9.4 変更ファイル

PJ：ManagementOperations.html／ManagementOperationsApi.gs新設、ManagementPage／ManagementSystem／Indexの導線。CatalogManagement／SongLyricsManagementの不具合修正。ProfileManagement／ImageManagementのキャッシュ更新、ImageManagementApiの削除済み画像保護。CardApi／CardStyles／PokerApi／PokerScriptsのロゴ撤去、CacheInvalidationのcatalog v3化。CoverApi／ProfileApi／ProfileScripts／ProfileMembers／UserPreferences／LyricsApi／LyricsScripts／QuizApi／QuizLyricsGeneratorの動的グループ対応。tests/management-complete.test.mjs追加、既存DOM fixtureと契約試験を新導線へ整合。
DB：CatalogMaintenance.gs新設、CatalogManagement.gsのShowMinorSavage GROUP判定維持、CatalogMemberMaintenance.gsの主所属内順番整合。tests/catalog-maintenance.test.mjs追加。

### 9.5 検証結果・未実施

- PJ：Node53件成功、監査7件成功。28 GAS／64 HTML静的検査成功。DB：Node74件成功、14 GAS静的検査成功。diff whitespace検査成功。
- 新試験は実関数とメモリ上Core／Log／Driveモデル、jsdomを使い、途中失敗のrollback、参照保護、復元、権限拒否、未保存保護、操作遷移を検証した。実DBを書き換えていない。
- デザイン：既存management-card、management-field、u-btn、共通loading/error、tokensを再利用。追加CSSはlayoutとJSON閲覧の折返しのみ。ローカルChromiumの起動制限により画面画像・Dark/Light視覚一致・iPhone safe-area／スクロールは未確認。DOM試験を実機確認とは扱わない。
- 未実施：実GASライブラリ接続、Google権限、複製DB実保存、実ファイルupload、全登録ユーザーの実環境操作、Safari／iPhone、PROFILE／KARAOKE／QUIZ／COVER／ANALYSISの実機一巡。
- 本番／テストDBの書込、GAS push／deploy、library版発行・固定版14の変更、main merge、旧入力タブ・11削除は行っていない。10_PerformanceMetricsと独立metrics、LYRICS直接編集、下部ナビを維持。

### 9.6 公開前と切り戻し

独立した検証GAS＋複製Core／Logで新DB版とPJを接続→管理者allowlist等を確認→画面から初期整備・flag設定→保存・再読込・失敗復旧・権限・iPhoneを検証する。初回ライブラリ版接続・管理者認証の基盤設定はインフラ準備であり、Sheets直接編集とは別。未確認があるため条件付き公開の条件は未達。
公開する場合の手順は、直前のdeployment／library版とCore／Logバックアップを記録→新DB固定版→PJ参照更新→PJ公開。データ移行は別途許可範囲の確認が必要。切り戻しは直前PJ deployment／固定DB版とfeature flag OFF。保存済みデータを戻す必要がある場合は履歴参照の影響をpreviewし、対象限定復元を用いる。旧DB版に戻すだけで新規データが元に戻るとは扱わない。


## 10. 本番導入試行と認証ブロッカー

## 本番導入試行（2026-11-17）
利用者の本番導入指示を受け、GitHub Actions経由で実行。両repoに `backup/pre-management-production-20261117` を作成。DB PR #3をmainへmerge（fb677808eb4bbad6201da30f905711b1383d6506）したが、[Deploy to GAS #44041105303](https://github.com/kotori118/BMSG-DB/actions/runs/44041105303) はPush to GASで `invalid_grant` により失敗。保存済みGoogle OAuth認証が拒否され、新library版発行はskip。PJ PR #64はDraft・未merge、manifest v14維持、サイトdeployは未実行。本番Core／Log移行・flag設定・ロゴ登録行削除も未実行。

再開条件：GitHub secret `CLASPRC_JSON_KEY` のGoogle認証情報を安全に更新し、DBの失敗ジョブ再実行→新library版確認→PJ固定版更新・CI→PJ公開の順。認証情報をチャットやログへ貼らない。今回のエラーをコード不具合／公開成功とは扱わない。直前PJ公開版は25、DB参照版14。元mainはrollback branchに保存済み。

