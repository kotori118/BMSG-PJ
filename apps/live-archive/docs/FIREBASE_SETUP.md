# Firebase接続の準備

この段階はユーザーのGoogleアカウント側の操作が必要。接続済みGitHub/Driveの権限はFirebase管理権限を含まない。

1. Firebase ConsoleでLIVE専用プロジェクトを作成。既存Universe用プロジェクトは流用しない。
2. Webアプリを登録し、表示されたfirebaseConfigの apiKey/authDomain/projectId/appId を開発担当へ渡す。これはWeb接続用設定で、サービスアカウント秘密鍵ではない。秘密鍵JSON・Googleパスワード・アクセストークンは送らない。
3. Authentication → Sign-in method → Googleを有効化。Firestore DatabaseをProductionモードで作成し、場所を確認。Functionsを使うためのBlazeプラン設定は利用者自身が料金条件を確認して行う。
4. `.env.local`にWeb設定を入れてGoogleログインを実行。AuthenticationのUsersに現れた本人UIDを確認する。サーバー設定前はアプリのデータ取得は拒否されるが、Googleログインによるユーザー作成は別処理として成立する。
5. Cloud Functions用の専用実行サービスアカウントを用意。鍵ファイルを発行せずランタイムのADCで実行する。`roles/datastore.user`等、LIVEの実行に必要な権限だけ付与。LIVE_SERVICE_ACCOUNTへそのメールを指定する。
6. Universe_DBを、その実行サービスアカウントのメールへ **閲覧者** で共有する。Google Sheets APIを有効化。編集者にはしない。Sheetsスコープ自体はタブ単位に限定できないので、コード上は06_SongsだけをGETし、他シートの読取を追加しない。
7. `functions/.env.<project-id>`に OWNER_UID と UNIVERSE_SPREADSHEET_ID と LIVE_SERVICE_ACCOUNT を設定（例はルートの `.env.server.example`）。実ファイルはgitignore対象。
8. Firebase CLIで本人が認証し、対象projectを明示してデプロイ。HostingのドメインをAuthenticationの承認済みドメインに追加し、Googleログインを確認する。

```sh
npx firebase login
npm run build
npm run build:functions
npx firebase deploy --project <LIVE専用project-id> --only firestore:rules,firestore:indexes,functions,hosting
```

実行サービスアカウントは LIVE_SERVICE_ACCOUNT で必須指定する。その同じアカウントだけへUniverseをViewer共有する。

初回は空のLIVEデータから開始する。試験fixtureや歴代公演を勝手に投入しない。Googleログイン、他アカウント拒否、起動時同期、Universe曲名更新、読取権限を外した際の前回値表示、iPhone/PCの参戦同期を順番に確認する。その後、別途プレビューと承認を経て公演データを投入する。
