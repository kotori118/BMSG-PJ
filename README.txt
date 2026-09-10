BMSG Universe
2026-09-10

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
