export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type WorkflowStatus = 'active' | 'draft' | 'paused' | string;

export type Position = {
  x: number;
  y: number;
};

export type WorkflowOptions = {
  name?: string;
  status?: WorkflowStatus;
};

export type NodeOptions = {
  displayName?: string;
  position?: Position;
};

export type StartNode = {
  type: 'start';
};

export type StartNodeOptions = {
  position?: Position;
};

export type EdgeOptions = {
  label?: string;
};

export type ApiCallTrigger = {
  active?: boolean;
  type: 'api_call';
};

export type InboundMessageTrigger = {
  active?: boolean;
  phoneNumberId?: string;
  type: 'inbound_message';
};

export type WhatsappEventTrigger = {
  active?: boolean;
  event: string;
  phoneNumberId?: string;
  type: 'whatsapp_event';
};

export type Trigger = ApiCallTrigger | InboundMessageTrigger | WhatsappEventTrigger;

export type BaseNode = {
  rawConfig?: JsonObject;
};

export type AiFields = JsonObject;

export type SendTextNode = BaseNode & {
  aiFields?: AiFields;
  delaySeconds?: number;
  message: string;
  phoneNumberId?: string;
  providerModel?: string;
  toPhoneNumber?: string;
  type: 'send_text';
  whatsappConfigId?: string;
};

export type SendTemplateNode = BaseNode & {
  aiFields?: AiFields;
  parameters?: JsonObject | JsonValue[];
  phoneNumberId?: string;
  providerModel?: string;
  templateId: string;
  toPhoneNumber?: string;
  type: 'send_template';
  whatsappConfigId?: string;
};

export type InteractiveButton = {
  id: string;
  title: string;
};

export type InteractiveListRow = {
  description?: string;
  id: string;
  title: string;
};

export type InteractiveListSection = {
  rows: InteractiveListRow[];
  title?: string;
};

export type InteractiveBaseNode = BaseNode & {
  aiFields?: AiFields;
  bodyText?: string;
  footerText?: string;
  headerMediaUrl?: string;
  headerText?: string;
  headerType?: 'image' | 'none' | 'text' | 'video' | string;
  phoneNumberId?: string;
  providerModel?: string;
  toPhoneNumber?: string;
  type: 'send_interactive';
  whatsappConfigId?: string;
};

export type ButtonInteractiveNode = InteractiveBaseNode & {
  buttons: InteractiveButton[];
  interactiveType: 'button';
};

export type ListInteractiveNode = InteractiveBaseNode & {
  interactiveType: 'list';
  listButtonText?: string;
  listSections: InteractiveListSection[];
};

export type CtaUrlInteractiveNode = InteractiveBaseNode & {
  ctaDisplayText: string;
  ctaUrl: string;
  interactiveType: 'cta_url';
};

export type FlowInteractiveNode = InteractiveBaseNode & {
  flowAction?: string;
  flowActionPayload?: JsonObject;
  flowCta?: string;
  flowId: string;
  flowToken?: string;
  interactiveType: 'flow';
};

export type LocationRequestInteractiveNode = InteractiveBaseNode & {
  interactiveType: 'location_request_message';
};

export type SendInteractiveNode =
  | ButtonInteractiveNode
  | CtaUrlInteractiveNode
  | FlowInteractiveNode
  | ListInteractiveNode
  | LocationRequestInteractiveNode;

export type WaitForResponseNode = BaseNode & {
  saveResponseTo?: string;
  timeoutSeconds?: number;
  type: 'wait_for_response';
};

export type DecisionCondition = {
  description?: string;
  label: string;
};

export type AiDecisionNode = BaseNode & {
  conditions: DecisionCondition[];
  decisionType: 'ai';
  llmConfiguration?: JsonObject;
  llmMaxTokens?: number;
  llmTemperature?: number;
  providerModel?: string;
  type: 'decide';
};

export type FunctionDecisionNode = BaseNode & {
  conditions: DecisionCondition[];
  decisionType: 'function';
  functionSlug: string;
  type: 'decide';
};

export type DecideNode = AiDecisionNode | FunctionDecisionNode;

export type FunctionNode = BaseNode & {
  functionSlug: string;
  saveResponseTo?: string;
  type: 'function';
};

export type WebhookNode = BaseNode & {
  aiFields?: AiFields;
  bodyTemplate?: JsonObject | JsonValue[];
  headers?: Record<string, string>;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | string;
  providerModel?: string;
  saveResponseTo?: string;
  type: 'webhook';
  url: string;
};

export type PipedreamNode = BaseNode & {
  accountId?: string;
  actionId: string;
  aiFields?: AiFields;
  appSlug: string;
  configuredProps?: JsonObject;
  dynamicPropsId?: string;
  providerModel?: string;
  saveResponseTo?: string;
  type: 'pipedream';
};

export type AgentFunctionTool = {
  description?: string;
  functionSlug: string;
  inputSchema?: JsonObject;
  name: string;
};

export type AgentWebhookTool = {
  bodyTemplate?: JsonObject | JsonValue[];
  description?: string;
  headers?: Record<string, string>;
  method?: string;
  name: string;
  url: string;
};

export type AgentNode = BaseNode & {
  appIntegrationTools?: JsonObject[];
  enabledDefaultTools?: string[];
  functionTools?: AgentFunctionTool[];
  knowledgeBases?: JsonObject[];
  maxIterations?: number;
  maxTokens?: number;
  mcpServers?: JsonObject[];
  observerPromptMode?: string;
  providerModel?: string;
  reasoningEffort?: 'high' | 'low' | 'medium' | 'minimal' | string;
  resources?: JsonObject[];
  sandboxAllowedOutboundHosts?: string[];
  sandboxEnabled?: boolean;
  sandboxNetworkMode?: string;
  systemPrompt?: string;
  temperature?: number;
  type: 'agent';
  webhooks?: AgentWebhookTool[];
};

export type CallNode = BaseNode & {
  saveErrorTo?: string;
  type: 'call';
  workflowSlug: string;
};

export type HandoffNode = BaseNode & {
  contextData?: JsonObject | string;
  reason?: string;
  type: 'handoff';
};

export type SetVariableNode = BaseNode & {
  type: 'set_variable';
  valueType?: 'boolean' | 'json' | 'number' | 'string' | string;
  variableName: string;
  variableValue: JsonValue;
};

export type RawNode = {
  config?: JsonObject;
  nodeType: string;
  type: 'raw';
};

export type WorkflowNode =
  | AgentNode
  | CallNode
  | DecideNode
  | FunctionNode
  | HandoffNode
  | PipedreamNode
  | RawNode
  | SendInteractiveNode
  | SendTemplateNode
  | SendTextNode
  | SetVariableNode
  | WaitForResponseNode
  | WebhookNode;

export type FlowNode = {
  data: {
    config: JsonObject;
    display_name?: string;
    node_type: string;
  };
  id: string;
  position: Position;
  type: 'flow-node';
};

export type FlowEdge = {
  label: string;
  source: string;
  target: string;
};

export type FlowDefinition = {
  edges: FlowEdge[];
  nodes: FlowNode[];
};

export type WorkflowMetadataTrigger = {
  active: boolean;
  event?: string;
  phoneNumberId?: string;
  triggerType: 'api_call' | 'inbound_message' | 'whatsapp_event';
};

export type WorkflowMetadata = {
  definition: 'definition.json';
  name: string;
  slug: string;
  status: WorkflowStatus;
  triggers: WorkflowMetadataTrigger[];
};

export type SourceFiles = {
  definition: FlowDefinition;
  definitionJson: string;
  metadata: WorkflowMetadata;
};

export type ValidationIssue = {
  code: string;
  message: string;
  path?: string;
};

export type ValidationResult = {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};
