export const CLEAN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CLEAN_NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const VALID_WEBHOOK_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
export const VALID_REASONING_EFFORTS = new Set(['high', 'low', 'medium', 'minimal']);

export const DEFAULT_AGENT_TOOLS = [
  'send_notification_to_user',
  'send_media',
  'get_execution_metadata',
  'get_whatsapp_context',
  'get_current_datetime',
  'save_variable',
  'get_variable',
  'ask_about_file',
  'complete_task',
  'handoff_to_human',
  'enter_waiting',
] as const;

export const DEFAULT_AGENT_TOOL_SET = new Set<string>(DEFAULT_AGENT_TOOLS);
