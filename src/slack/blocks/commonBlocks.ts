import { SLACK_ACTION_IDS } from '../../config/slackConstants';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = any;

export function buildSection(text: string, blockId?: string) {
  return {
    type: 'section' as const,
    block_id: blockId,
    text: {
      type: 'mrkdwn' as const,
      text,
    },
  };
}

export function buildDivider() {
  return { type: 'divider' as const };
}

export function buildHeader(text: string) {
  return {
    type: 'header' as const,
    text: {
      type: 'plain_text' as const,
      text,
      emoji: true,
    },
  };
}

export function buildButton(text: string, actionId: string, value?: string, style?: 'primary' | 'danger') {
  return {
    type: 'button' as const,
    text: {
      type: 'plain_text' as const,
      text,
      emoji: true,
    },
    action_id: actionId,
    value: value || text,
    style,
  };
}

export function buildContext(elements: string[]) {
  return {
    type: 'context' as const,
    elements: elements.map((e) => ({
      type: 'mrkdwn' as const,
      text: e,
    })),
  };
}

export function buildInput(
  label: string,
  actionId: string,
  blockId: string,
  placeholder?: string,
  optional = false,
) {
  return {
    type: 'input' as const,
    block_id: blockId,
    label: {
      type: 'plain_text' as const,
      text: label,
      emoji: true,
    },
    element: {
      type: 'plain_text_input' as const,
      action_id: actionId,
      placeholder: placeholder
        ? {
            type: 'plain_text' as const,
            text: placeholder,
            emoji: true,
          }
        : undefined,
    },
    optional,
  };
}

export function buildStaticSelect(
  label: string,
  actionId: string,
  blockId: string,
  options: Array<{ text: string; value: string }>,
  placeholder?: string,
) {
  return {
    type: 'section' as const,
    block_id: blockId,
    text: {
      type: 'mrkdwn' as const,
      text: label,
    },
    accessory: {
      type: 'static_select' as const,
      action_id: actionId,
      placeholder: {
        type: 'plain_text' as const,
        text: placeholder || 'Select...',
        emoji: true,
      },
      options: options.map((o) => ({
        text: {
          type: 'plain_text' as const,
          text: o.text,
          emoji: true,
        },
        value: o.value,
      })),
    },
  };
}

export function buildActions(...elements: unknown[]) {
  return {
    type: 'actions' as const,
    elements,
  };
}

export function buildConfirmationDialog(
  title: string,
  text: string,
  confirm: string,
  deny: string,
) {
  return {
    title: {
      type: 'plain_text' as const,
      text: title,
    },
    text: {
      type: 'mrkdwn' as const,
      text,
    },
    confirm: {
      type: 'plain_text' as const,
      text: confirm,
    },
    deny: {
      type: 'plain_text' as const,
      text: deny,
    },
  };
}

export function buildUserErrorBlocks(message: string) {
  return [
    buildHeader(':warning: Error'),
    buildSection(message),
    buildDivider(),
    buildActions(
      buildButton(':arrow_left: Back to Menu', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary'),
    ),
  ];
}

export function buildBackToMenuButton() {
  return buildButton(':arrow_left: Back to Menu', SLACK_ACTION_IDS.BACK_TO_MENU, 'back', 'primary');
}

export function buildMainMenuBlocks(userName: string): Block[] {
  return [
    buildHeader(`:package: DMS / SFA Dashboard`),
    buildSection(`Welcome, *${userName}*! What would you like to do?`),
    buildDivider(),
    buildActions(
      buildButton(':pencil: Create Primary Order', SLACK_ACTION_IDS.SELECT_ORDER_TYPE, 'create_primary', 'primary'),
      buildButton(':clipboard: My Primary Orders', SLACK_ACTION_IDS.VIEW_ORDER_DETAIL, 'my_orders'),
    ),
    buildActions(
      buildButton(':twisted_rightwards_arrows: Secondary Orders', 'secondary_orders_menu', 'secondary'),
      buildButton(':leftwards_arrow_with_hook: Returns & Claims', 'returns_claims_menu', 'returns'),
    ),
    buildActions(
      buildButton(':bar_chart: Business Insights', 'insights_menu', 'insights'),
      buildButton(':gear: ARS Settings', 'ars_menu', 'ars'),
    ),
    buildDivider(),
    buildContext([
      ':information_source: All actions are scoped to your distributor account. Data is synced with Salesforce in real-time.',
    ]),
  ];
}
