import type { ToolExecutor } from '../../../tools/types.js';
import { loadTeamConfig } from '../../team-store.js';
import { sendMessage } from '../../team-mailbox.js';

export const execute: ToolExecutor = async (input, _options) => {
  const teamName = input.team_name as string;
  const to = input.to as string;
  const text = input.text as string;
  const from = 'coordinator';

  const config = await loadTeamConfig(teamName);
  if (!config) {
    return {
      content: `Team '${teamName}' not found. Use team-create to create it first.`,
      isError: true,
    };
  }

  // ── Broadcast ────────────────────────────────────────────────────
  if (to === '*') {
    let sent = 0;
    for (const member of config.members) {
      try {
        await sendMessage(teamName, from, member.name, text);
        sent++;
      } catch {
        // Skip unreachable members
      }
    }
    return {
      content: `Broadcast message sent to ${sent}/${config.members.length} member(s) in '${teamName}'.`,
      isError: false,
      metadata: { teamName, broadcast: true, recipientCount: sent },
    };
  }

  // ── Direct message ───────────────────────────────────────────────
  const recipient = config.members.find(m => m.name === to);
  if (!recipient) {
    const available = config.members.map(m => m.name).join(', ');
    return {
      content: `Member '${to}' not found in team '${teamName}'. Available: ${available}`,
      isError: true,
    };
  }

  await sendMessage(teamName, from, to, text);

  return {
    content: `Message sent to ${to} in team '${teamName}'.`,
    isError: false,
    metadata: { teamName, to },
  };
};
