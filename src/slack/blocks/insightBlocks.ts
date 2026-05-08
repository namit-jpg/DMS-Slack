import { BusinessInsight } from '../../services/InsightsService';
import { SLACK_ACTION_IDS } from '../../config/slackConstants';
import { buildSection, buildDivider, buildHeader, buildContext, buildButton } from './commonBlocks';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;

export function buildInsightBlocks(insights: BusinessInsight[]): Block[] {
  const blocks: Block[] = [buildHeader(':bulb: Business Insights'), buildDivider()];

  if (insights.length === 0) {
    blocks.push(buildSection('No insights available at this time.'));
    blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });
    return blocks;
  }

  for (const insight of insights) {
    const icon = insightIcon(insight.type);
    blocks.push(
      buildSection(
        `${icon} *${insight.title}*\n${insight.description}\n${insight.metric ? `_${insight.metric}_` : ''}`,
      ),
    );
    blocks.push(buildDivider());
  }

  blocks.push(
    buildContext([
      ':information_source: Insights are based on your order history and inventory data.',
    ]),
  );
  blocks.push({ type: 'actions', elements: [buildButton(':arrow_left: Back to Dashboard', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary')] });

  return blocks;
}

function insightIcon(type: string): string {
  switch (type) {
    case 'warning':
      return ':warning:';
    case 'success':
      return ':white_check_mark:';
    case 'recommendation':
      return ':star:';
    default:
      return ':information_source:';
  }
}
