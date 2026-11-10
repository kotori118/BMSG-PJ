# 実装計画・DB設計 v0.24対応

正本: https://docs.google.com/document/d/1f2vC8x6D7xW_QF4oZXTQDGagYO5Gt4-37N9OGRpIjFk/edit

## 現状確認

- GitHub接続で確認できたのは `kotori118/BMSG-PJ`、`BMSG-DB`、`Harmony-Lab`。LIVE専用リポジトリは未作成。
- BMSG-PJ main `96c47b16960ecd353551deaaf53e2cee4002a5a4` を起点に独立ブランチで実装。GASの関数・既存画面・DB Writerは変更しない。
- 設計書の格納フォルダには設計書1件。Firebaseは設計書上も未構築で、実環境認証情報は接続先にない。
- Universe_DB `06_Songs` はメタデータ上158行25列、実データのヘッダーは7列。157曲、Artist=BE:FIRST 66曲。SongIDは文字列化、Artistは前後空白のみ除去、日付はISOへ変換する。同名曲があるためタイトルでの自動統合は禁止。

## 作業順

1. 型・制約・安定キー・有効セトリの合成と集計を先行。shared/model.ts と shared/domain.ts が共通Owner。
2. 専用サーバーのSheets GET → 全件検証 → Firebase楽曲スナップショットを原子的に更新。失敗時は前回値を保持。
3. 2024年初ドーム4公演の日程と3/3の29曲を試験fixture化。参戦記録なし。他3公演のセトリは未入力。
4. 本人専用Google認証、HOME/LIVE/MY LIVE/ANALYSIS、編集と集計、JSONを実装し、実環境接続後に権限と端末間同期を検証。
5. 下記の未完了UIを完成させ、実環境ゲートA/Bを通過してから歴代公演を整理。
6. ツアー別の公演数・セトリ・不足情報をプレビューし、本人承認後に初期データを一括登録。
7. 予想・バックテストは別段階。

## Firestore配置

| パス                                       | 責務・制約                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `config/owner`                             | サーバーのみ作成。OWNER_UIDに一致する本人Googleログインで初期化。クライアント読取・書込不可 |
| `users/{uid}/control/state`                | activeDatasetId、previousDatasetId、revision。全編集は期待dataset/revisionと照合            |
| `users/{uid}/catalog/universe`             | songs[]、revision、digest、syncedAt。最終成功スナップショット。LIVEの復元と分離             |
| `users/{uid}/datasets/{datasetId}`         | ready、schemaVersion、createdAt、照合digest。readyの確認後だけactiveに切替                  |
| `…/datasets/{datasetId}/{collection}/{id}` | 以下のLIVE固有エンティティ。通常の保存はactive datasetだけ変更                              |

| collection    | 保存項目・キー                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| tours         | id、revision、name、type、startDate/endDate、defaultTime、releaseIds[]                                                                          |
| shows         | id、revision、tourId/null、name、type、format、date、venue、region、slot、startsAt/null、templateId/null、hasSavedSetlist、surpriseReview、note |
| templates     | id、revision、tourId、name、entries[]。テンプレート行のidは改名・並替で変更しない                                                               |
| overrides     | id、revision、showId、templateId、operations[]。showIdごとに1文書。ADD/REMOVE/MOVE/PATCH。対象は安定行ID                                        |
| directEntries | id、revision、showId、entries[]。基本セトリなしの直接明細                                                                                       |
| entryFacts    | id、revision、showId、entryKey、unpublishedBeforeShow、firstPerformedAtShow、note。公演＋行IDで一意                                             |
| localSongs    | id、revision、title、artist/null。参照はL:id                                                                                                    |
| songMetadata  | id、revision、songRef、category、unreleased、announcedAt/null、appleMusicUrl/null                                                               |
| releases      | id、revision、title、artist、form、announcedAt、releaseDate、universeKey                                                                        |
| releaseTracks | id、revision、releaseId、songRef、position、lead、newOnAlbum、announcedAt。releaseId＋songRefで一意                                             |
| attendance    | id、revision、showId、attended、seat、note、createdAt、updatedAt。showIdごとに1文書                                                             |

Entry: id、songRef、section(MAIN/ENCORE)、version(FULL/SHORT/null)、medleyGroup/null、performance、members[]。配列順が曲順。テンプレートと公演追加行はUUID等の安定IDを使う。同じ曲の繰返しは別行ID。

`SetlistEntries` は保存用の重複コレクションを作らず、`effectiveEntries` で基本セトリ＋差分を合成し、表示・分析が共通利用する。公演固有の披露事実は `showId + entryKey` で別に結合する。テンプレート内にサプライズフラグを置かない。

## 同期と安全性

Universe曲の参照は `U:SongID`。必須列欠損、重複ID、空取得、不正日付、不正booleanを検出したら更新しない。同期元から消えた曲は既存参照維持のためavailable=falseで保持し、未聴一覧には含めない。追加メタデータを上書きしない。更新は同期前revisionのCAS付きトランザクション。新しい同期の後へ古い取得結果を上書きしない。

L→U統合は候補表示＋本人確認。テンプレート・追加行・差替差分・作品収録・追加メタデータを移行。メタデータが競合したら黙って捨てず中止する。披露行IDを変えないため参戦と披露事実が維持される。

## 編集・復元

各編集は期待control revisionと対象エンティティrevisionで競合を拒否。公演の複数変更は `saveDatasetChanges` の1トランザクションで確定し、復元前バックアップの参照を変えない。現在は共通control revisionも比較するため別エンティティへの同時変更でも保守的に再読込を要求する。

JSONはLIVE固有コレクションのみ。復元は厳格な型・外部キー検証→新datasetへ400件ずつ登録→読戻しとdigest照合→期待control revisionを再確認→active参照切替。失敗したstagingは非activeのままで、旧データを使用。切替前のdatasetは次の別復元まで保持し、復元後の通常編集では上書きしない。巻戻し前に編集消失を確認する。通常編集履歴や定期バックアップは増やさない。

## 実装後も残るゲート

- 本番Firebaseの作成・Googleプロバイダー・本人UID・Viewer権限・実際のSheets読取。
- iPhone/PCのGoogleログイン、端末間同期、実環境での他アカウント拒否。
- docs/AUDIT.mdの未完了UIと、承認付き初期データ取込。
