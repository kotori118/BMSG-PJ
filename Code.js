/**
 * BMSG Universe PHASE3
 * Gradient Background v2.1 MEMBER DETAIL
 *
 * v2.0.1のPROFILE一覧とモバイル画像修正を維持し、
 * メンバーカードからREAD ONLYの詳細画面を接続。
 * Spreadsheet / 既存サービスへの接続・書込は行わない。
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('BMSG UNIVERSE')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, viewport-fit=cover'
    );
}

/**
 * Index.htmlからStyles.html等を読み込む。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
