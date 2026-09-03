BMSG Universe PHASE3 Gradient Background v2.1 MEMBER DETAIL
2026-09-03

基準版:
BMSG_Universe_PHASE3_GradientBackground_v2.0.1_MOBILE_IMAGE_FIX.zip

【今回の追加】
- メンバーカードをタップすると詳細画面を表示
- 詳細画面にプロフィール画像、所属グループ、表示名を表示
- 左上のUniverse HOMEボタンは詳細画面でも常時維持
- 詳細画面内にMEMBERS戻るボタンを追加
- 詳細表示中はグループフィルターとPROFILE内タブを隠す
- Enter / Spaceによるカード操作に対応
- DBに存在しないプロフィール項目は表示しない
- 書込処理なし（READ ONLY）

【確認された症状】
- PCではメンバー画像がすぐ表示される
- iPhone SafariのApps Script Web Appでは3分後も画像が表示されない
- Memberデータ、Group切替、Fallback initialsは正常
- Drive画像は「リンクを知っている全員が閲覧可」

【原因判断】
DBやDrive共有権限ではなく、iPhone Safari＋Apps Script内からの
drive.google.com/thumbnail直読みによる認証／Cookie／配信相性の可能性が高い。

【修正】
- 第一画像URLを公開Google Content CDNへ変更
  https://lh3.googleusercontent.com/d/{DriveFileID}=w600
- 第一URL失敗時はDriveのuc表示URLへ1回だけFallback
- 第二URLも失敗した場合だけ既存の頭文字表示へFallback
- referrerpolicy=no-referrer
- decoding=async / loading=lazy
- Cache keyをV2_0_1へ変更し、古いthumbnail URLを即時無効化
- 画像のobject-positionをcenter topへ変更
- 縦横比で見切れる場合は上側を残し、下側を切る

【変更ファイル】
- Code.gs
- ProfileApi.gs
- ProfileMembers.html
- ProfileStyles.html

【変更していない】
- Core DB
- 読取対象と結合ロジック
- Member並び順
- PROFILE Layout
- HOME / DATA / LAB
- 共通Styles / Shell / Router
- Spreadsheet書込なし

【実機確認】
1. 新しいデプロイを発行する
2. iPhone SafariでPROFILEを開く
3. 最初に見えるMember画像が短時間で表示される
4. スクロール後の画像もLazy Loadされる
5. 顔や頭など画像上部が優先され、見切れは下側に発生する
6. PC表示が引き続き正常

【共通UI仕様 2026-09-03】
- 最上部は不透明な共通ユーティリティヘッダーとする
- 左に家アイコンのHOME、右に検索・設定を同一列で配置する
- 各機能ページ内に重複する大きなHOMEボタンは置かない
- ヘッダー背面の画像・本文を透過表示しない
- 機能名や項目名で意味が伝わる場合、補足的な日本語説明文は置かない

