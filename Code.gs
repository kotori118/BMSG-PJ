/** BMSG Universe web app entry point. */
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
 * Index.htmlから各HTMLパーツを読み込む。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
