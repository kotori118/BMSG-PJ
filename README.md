# BMSG-PJ

BMSG Universe Apps Script source.

Song / Lyrics / Guest writes are centralized in BMSG-DB via the pinned Apps Script library. Image management remains owned by BMSG-PJ. Runtime spreadsheet Config counters are no longer used by the new management paths.

Server側の共通利用ユーザーID／表示名は `Config.gs` の `UNIVERSE_CONFIG.USER_IDS`／`USER_DISPLAY_NAMES` を唯一の定義元とする。各Serviceへ同じ値を再定義しない。Client側の初期選択UIは現行構成を維持する。
BMSG-DB更新時は同Repositoryのworkflow summaryで作成版を確認し、`appsscript.json`のBMSGDB固定versionを更新してBMSG-PJをdeployする。Library作成だけでは本番PJへの反映完了と扱わない。
deploy前に `node scripts/validate-gas-sources.mjs` と `node --test tests/config-contract.test.mjs` を実行し、GAS／Client script構文・Runtime関数名重複・BMSGDB固定参照・利用ユーザー定義重複を確認する。

このRepositoryは BMSG Universe サイト本体の現行実装を管理する。

【現行Authority】
- サイト／Client／Service APIの実装正本: GitHub `kotori118/BMSG-PJ` main
- 共通マスターWriter・採番・整合検証GASの正本: GitHub `kotori118/BMSG-DB` main
- **Universeの唯一の仕様正本**: [BMSG Universe｜統合仕様書](https://docs.google.com/document/d/1pgttqIlZ8pZtBNBpKt90U_nr4ZVZyeCtJyYvBhu8QFk/edit)
- 統合仕様書は運用原則、DB・ID、UIデザイン、各機能、GAS責務、管理、検証・判断待ちを1冊にまとめる。現行実装との不一致は仕様書内で明示する。
- 旧00「正本運用ルール」・01「プロジェクト指示書」・02「プロジェクト実務指示書」・03「変更履歴」・05「GAS一括実装仕様書」・06「PHASE3デザイン・アプリ基盤仕様書」は現行仕様の正本ではない。6冊ともDriveで【削除対象・旧資料】と改名済み。旧02・03・05・06は削除承認済みだがゴミ箱移動が権限エラーで未完了。旧00・01は識別改名のみ完了しており、削除実行していない。

【開発原則】
- コード変更前に統合仕様書の該当章、最新のGitHub mainとCore／Logの実データを確認する。旧文書だけを根拠に現行コードを変更しない。
- 仕様が変わったら統合仕様書の該当箇所を直接更新し、古い仕様・日付別追補・時系列の変更履歴を本文に蓄積しない。コードの変更記録はGitコミット／PR、文書はGoogle Docs版履歴、サイト運用操作はLog CATALOG_Auditで追跡する。
- 現行機能・UI・文言・Motion・保存挙動を壊さない非破壊変更を原則とする。
- Runtimeには最終版だけを残し、Fixes / Polish / V2 / V3 / Final等の一時的Override層は、Source Ownerへ最終挙動を吸収・検証後に削除する。
- 現行の責務分割を構成の基準とし、個別変更の都合だけでOwnerやService境界を混在・統合しない。
- 各Runtime関数の正本は1つのSource Ownerに限定する。実装前にRepository全体を検索し、同名関数・同等責務・後勝ち再代入・Wrapper Overrideを残さず、Owner本体を直接変更する。
- 新規ファイルは、独立した責務・規模・拡張性から分離が妥当な場合に追加してよい。その際はIndexのinclude順、READMEに示したOwner責務、統合仕様書の該当章を同時に整合させる。
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

※ 過去のPrototype ZIP名・個別Fix手順はGit履歴や削除前の旧資料で確認する。現在の仕様は統合仕様書、実装の実態はGitHub mainを優先し、このREADMEを仕様正本の代替にしない。
