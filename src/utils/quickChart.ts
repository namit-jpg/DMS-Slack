export function buildQuickChartUrl(config: object, width = 600, height = 300): string {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&bkg=white`;
}
