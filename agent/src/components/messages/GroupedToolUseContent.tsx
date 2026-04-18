import type { ToolResultBlockParam, ToolUseBlockParam } from '../../services/api/streamTypes.js';
import * as React from 'react';
import { filterToolProgressMessages, findToolByName, type Tools } from '../../Tool.js';
import type { GroupedToolUseMessage } from '../../types/message.js';
import type { buildMessageLookups } from '../../utils/messages.js';
type Props = {
  message: GroupedToolUseMessage;
  tools: Tools;
  lookups: ReturnType<typeof buildMessageLookups>;
  inProgressToolUseIDs: Set<string>;
  shouldAnimate: boolean;
};
export function GroupedToolUseContent({
  message,
  tools,
  lookups,
  inProgressToolUseIDs,
  shouldAnimate
}: Props): React.ReactNode {
  const tool = findToolByName(tools, message.toolName);
  if (!tool?.renderGroupedToolUse) {
    return null;
  }

  // Build a map from tool_use_id to result data
  const resultsByToolUseId = new Map<string, {
    param: ToolResultBlockParam;
    output: unknown;
  }>();
  for (const resultMsg of message.results) {
    for (const content of resultMsg.message.content) {
      if (content.type === 'tool_result') {
        resultsByToolUseId.set(content.tool_use_id, {
          param: content,
          output: resultMsg.toolUseResult
        });
      }
    }
  }
  const toolUsesData = message.messages.map(msg => {
    const content = msg.message.content[0]
    const id = content?.type === 'tool_use' ? content.id : ''
    const result = resultsByToolUseId.get(id);
    return {
      param: content as ToolUseBlockParam,
      isResolved: lookups.resolvedToolUseIDs.has(id),
      isError: lookups.erroredToolUseIDs.has(id),
      isInProgress: inProgressToolUseIDs.has(id),
      progressMessages: filterToolProgressMessages(lookups.progressMessagesByToolUseID.get(id) ?? []),
      result
    };
  });
  const anyInProgress = toolUsesData.some(d => d.isInProgress);
  return tool.renderGroupedToolUse(toolUsesData, {
    shouldAnimate: shouldAnimate && anyInProgress,
    tools
  });
}
