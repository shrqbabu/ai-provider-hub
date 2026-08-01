// Virtual "aip/" prefix for Claude models.
//
// The user wants every Claude model to be addressable as `aip/<model-id>` so
// the combo/model list shows a consistent, self-describing name (aip = the
// user's chosen tag for their Anthropic-in-prefix models). The gateway strips
// the prefix before sending upstream (see api/_lib/upstreams.ts parseModel),
// so `aip/claude-opus-4-8` routes to a Claude provider as `claude-opus-4-8`.

export const CLAUDE_PREFIX = "aip/";

/** True if this looks like a Claude model id (with or without the prefix). */
export function isClaudeModel(modelId: string): boolean {
  return /claude/i.test(modelId);
}

/** Add the aip/ prefix to a Claude model id, unless it's already prefixed. */
export function withClaudePrefix(modelId: string): string {
  const id = (modelId ?? "").trim();
  if (!id) return id;
  if (id.startsWith(CLAUDE_PREFIX)) return id;
  return isClaudeModel(id) ? `${CLAUDE_PREFIX}${id}` : id;
}

/** Remove the aip/ prefix if present, returning the bare provider model id. */
export function stripClaudePrefix(modelId: string): string {
  const id = (modelId ?? "").trim();
  return id.startsWith(CLAUDE_PREFIX) ? id.slice(CLAUDE_PREFIX.length) : id;
}
