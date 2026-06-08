/**
 * ToolApprovalCard.tsx — Tool execution approval dialog
 */

import { h } from 'preact';

interface ToolApprovalCardProps {
  command: string;
  description: string;
  onApprove: () => void;
  onDeny: () => void;
}

export function ToolApprovalCard({
  command,
  description,
  onApprove,
  onDeny,
}: ToolApprovalCardProps): h.JSX.Element {
  return (
    <div class="approval-card">
      <div class="approval-header">
        <span class="approval-title">Approve tool execution?</span>
      </div>
      <div class="approval-body">
        <div class="approval-command">
          <code>{command}</code>
        </div>
        {description && <div class="approval-desc">{description}</div>}
      </div>
      <div class="approval-actions">
        <button class="approval-deny" onClick={onDeny}>
          Deny
        </button>
        <button class="approval-approve" onClick={onApprove}>
          Approve
        </button>
      </div>
    </div>
  );
}
