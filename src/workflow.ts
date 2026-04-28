import type {
  AgentFunctionTool,
  AgentNode,
  AgentWebhookTool,
  CallNode,
  DecideNode,
  EdgeOptions,
  FlowDefinition,
  FlowEdge,
  FlowNode,
  HandoffNode,
  JsonObject,
  JsonValue,
  NodeOptions,
  PipedreamNode,
  Position,
  RawNode,
  SendInteractiveNode,
  SendTemplateNode,
  SendTextNode,
  SetVariableNode,
  SourceFiles,
  Trigger,
  ValidationIssue,
  ValidationResult,
  WaitForResponseNode,
  WebhookNode,
  WorkflowMetadata,
  WorkflowNode,
  WorkflowOptions,
  WorkflowStatus,
} from './types.js';

const CLEAN_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CLEAN_NODE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const VALID_WEBHOOK_METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
const VALID_REASONING_EFFORTS = new Set(['high', 'low', 'medium', 'minimal']);

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

const DEFAULT_AGENT_TOOL_SET = new Set<string>(DEFAULT_AGENT_TOOLS);

type StoredNode = {
  id: string;
  node: WorkflowNode;
  options: NodeOptions;
};

type StoredEdge = {
  label: string;
  source: string;
  target: string;
};

export class WorkflowValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => issue.message).join('\n'));
    this.issues = issues;
    this.name = 'WorkflowValidationError';
  }
}

export class Workflow {
  readonly name: string;
  readonly slug: string;
  readonly startPosition: Position;
  readonly status: WorkflowStatus;

  #edges: StoredEdge[] = [];
  #nodes = new Map<string, StoredNode>();
  #triggers: Trigger[] = [];

  constructor(slug: string, options: WorkflowOptions = {}) {
    this.slug = slug;
    this.name = options.name ?? slug;
    this.status = options.status ?? 'draft';
    this.startPosition = options.startPosition ?? { x: 0, y: 0 };
  }

  addEdge(source: string, target: string, options: EdgeOptions = {}): this {
    this.#edges.push({
      label: options.label ?? 'next',
      source,
      target,
    });

    return this;
  }

  addNode(id: string, node: WorkflowNode, options: NodeOptions = {}): this {
    if (id === 'start') {
      throw new Error('The start node is created automatically and cannot be added manually.');
    }

    if (this.#nodes.has(id)) {
      throw new Error(`Node "${id}" already exists.`);
    }

    this.#nodes.set(id, {
      id,
      node,
      options,
    });

    return this;
  }

  addTrigger(trigger: Trigger): this {
    this.#triggers.push(trigger);
    return this;
  }

  toDefinition(): FlowDefinition {
    this.#assertValid();

    return {
      edges: this.#edges.map((edge) => ({ ...edge })),
      nodes: this.#flowNodes(),
    };
  }

  toSourceFiles(): SourceFiles {
    const definition = this.toDefinition();

    return {
      definition,
      definitionJson: `${canonicalJson(definition)}\n`,
      metadata: this.toMetadata(),
    };
  }

  toMetadata(): WorkflowMetadata {
    this.#assertValid();

    return {
      definition: 'definition.json',
      name: this.name,
      slug: this.slug,
      status: this.status,
      triggers: this.#triggers.map((trigger) => compileTrigger(trigger)),
    };
  }

  validate(): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];

    if (!isCleanSlug(this.slug)) {
      errors.push(issue('invalid_slug', `Workflow slug "${this.slug}" must be lowercase kebab-case.`, 'slug'));
    }

    for (const stored of this.#nodes.values()) {
      validateNodeId(stored.id, errors);
      validateNode(stored.id, stored.node, errors);
    }

    this.#triggers.forEach((trigger, index) => {
      validateTrigger(trigger, index, errors);
    });

    for (const edge of this.#edges) {
      if (!this.#hasNode(edge.source)) {
        errors.push(issue('missing_edge_source', `Edge source "${edge.source}" does not exist.`, edgePath(edge)));
      }

      if (!this.#hasNode(edge.target)) {
        errors.push(issue('missing_edge_target', `Edge target "${edge.target}" does not exist.`, edgePath(edge)));
      }
    }

    this.#validateDecisionEdges(errors);
    this.#validateOutgoingEdges(errors, warnings);

    return { errors, warnings };
  }

  #assertValid(): void {
    const result = this.validate();
    if (result.errors.length > 0) {
      throw new WorkflowValidationError(result.errors);
    }
  }

  #flowNodes(): FlowNode[] {
    const nodes: FlowNode[] = [
      {
        data: {
          config: {},
          node_type: 'start',
        },
        id: 'start',
        position: this.startPosition,
        type: 'flow-node',
      },
    ];

    let index = 1;
    for (const stored of this.#nodes.values()) {
      nodes.push(compileNode(stored, index));
      index += 1;
    }

    return nodes;
  }

  #hasNode(id: string): boolean {
    return id === 'start' || this.#nodes.has(id);
  }

  #validateDecisionEdges(errors: ValidationIssue[]): void {
    for (const stored of this.#nodes.values()) {
      if (stored.node.type !== 'decide') {
        continue;
      }

      const conditionLabels = new Set(stored.node.conditions.map((condition) => condition.label));
      const outgoing = this.#edges.filter((edge) => edge.source === stored.id);

      for (const edge of outgoing) {
        if (!conditionLabels.has(edge.label)) {
          errors.push(issue(
            'unknown_decision_edge_label',
            `Decision node "${stored.id}" has outgoing edge label "${edge.label}" with no matching condition.`,
            edgePath(edge),
          ));
        }
      }
    }
  }

  #validateOutgoingEdges(errors: ValidationIssue[], warnings: ValidationIssue[]): void {
    const edgesBySource = new Map<string, StoredEdge[]>();

    for (const edge of this.#edges) {
      const edges = edgesBySource.get(edge.source) ?? [];
      edges.push(edge);
      edgesBySource.set(edge.source, edges);
    }

    const startNextEdges = (edgesBySource.get('start') ?? []).filter((edge) => edge.label === 'next');
    if (startNextEdges.length > 1) {
      errors.push(issue('multiple_start_edges', 'The start node can only have one outgoing "next" edge.', 'edges'));
    }

    for (const [nodeId, edges] of edgesBySource) {
      const stored = this.#nodes.get(nodeId);
      const nodeType = stored?.node.type ?? 'start';

      if (nodeType === 'decide') {
        continue;
      }

      if (nodeType === 'handoff' && edges.length > 0) {
        warnings.push(issue(
          'handoff_outgoing_edges',
          `Handoff node "${nodeId}" has outgoing edges, but runtime handoff does not advance automatically.`,
          `nodes.${nodeId}`,
        ));
      }

      if (nodeType === 'function' && edges.length > 1) {
        warnings.push(issue(
          'function_multiple_edges',
          `Function node "${nodeId}" has multiple outgoing edges; use a decide node for branching.`,
          `nodes.${nodeId}`,
        ));
      }

      if (nodeType !== 'start' && edges.length > 1) {
        warnings.push(issue(
          'non_decision_multiple_edges',
          `Non-decision node "${nodeId}" has multiple outgoing edges.`,
          `nodes.${nodeId}`,
        ));
      }

      for (const edge of edges) {
        if (edge.label !== 'next') {
          warnings.push(issue(
            'non_decision_edge_label',
            `Non-decision node "${nodeId}" has outgoing edge label "${edge.label}" instead of "next".`,
            edgePath(edge),
          ));
        }
      }
    }
  }
}

function compileNode(stored: StoredNode, index: number): FlowNode {
  const nodeType = nodeTypeFor(stored.node);
  const data: FlowNode['data'] = {
    config: compileConfig(stored.node),
    node_type: nodeType,
  };

  if (stored.options.displayName) {
    data.display_name = stored.options.displayName;
  }

  return {
    data,
    id: stored.id,
    position: stored.options.position ?? { x: index * 240, y: 0 },
    type: 'flow-node',
  };
}

function nodeTypeFor(node: WorkflowNode): string {
  return node.type === 'raw' ? node.nodeType : node.type;
}

function compileConfig(node: WorkflowNode): JsonObject {
  switch (node.type) {
    case 'agent':
      return withRawConfig(compileAgentConfig(node), node);
    case 'call':
      return withRawConfig(definedObject({
        save_error_to: node.saveErrorTo,
        workflow_slug: node.workflowSlug,
      }), node);
    case 'decide':
      return withRawConfig(compileDecisionConfig(node), node);
    case 'function':
      return withRawConfig(definedObject({
        function_slug: node.functionSlug,
        save_response_to: node.saveResponseTo,
      }), node);
    case 'handoff':
      return withRawConfig(definedObject({
        context_data: node.contextData,
        reason: node.reason,
      }), node);
    case 'pipedream':
      return withRawConfig(definedObject({
        account_id: node.accountId,
        action_id: node.actionId,
        ai_field_config: node.aiFields,
        app_slug: node.appSlug,
        configured_props: node.configuredProps,
        dynamic_props_id: node.dynamicPropsId,
        provider_model_name: node.providerModel,
        save_response_to: node.saveResponseTo,
      }), node);
    case 'raw':
      return node.config ? cloneJsonObject(node.config) : {};
    case 'send_interactive':
      return withRawConfig(compileInteractiveConfig(node), node);
    case 'send_template':
      return withRawConfig(compileTemplateConfig(node), node);
    case 'send_text':
      return withRawConfig(compileTextConfig(node), node);
    case 'set_variable':
      return withRawConfig(definedObject({
        value_type: node.valueType,
        variable_name: node.variableName,
        variable_value: node.variableValue,
      }), node);
    case 'wait_for_response':
      return withRawConfig(compileWaitConfig(node), node);
    case 'webhook':
      return withRawConfig(definedObject({
        ai_field_config: node.aiFields,
        body_template: node.bodyTemplate,
        headers: node.headers,
        method: node.method,
        provider_model_name: node.providerModel,
        save_response_to: node.saveResponseTo,
        url: node.url,
      }), node);
  }
}

function compileAgentConfig(node: AgentNode): JsonObject {
  return definedObject({
    enabled_default_tools: node.enabledDefaultTools,
    flow_agent_app_integration_tools: node.appIntegrationTools,
    flow_agent_function_tools: node.functionTools?.map((tool) => compileAgentFunctionTool(tool)),
    flow_agent_knowledge_bases: node.knowledgeBases,
    flow_agent_mcp_servers: node.mcpServers,
    flow_agent_resources: node.resources,
    flow_agent_webhooks: node.webhooks?.map((tool) => compileAgentWebhookTool(tool)),
    max_iterations: node.maxIterations,
    max_tokens: node.maxTokens,
    observer_prompt_mode: node.observerPromptMode,
    provider_model_name: node.providerModel,
    reasoning_effort: node.reasoningEffort,
    sandbox_allowed_outbound_hosts: node.sandboxAllowedOutboundHosts,
    sandbox_enabled: node.sandboxEnabled,
    sandbox_network_mode: node.sandboxNetworkMode,
    system_prompt: node.systemPrompt,
    temperature: node.temperature,
  });
}

function compileAgentFunctionTool(tool: AgentFunctionTool): JsonObject {
  return definedObject({
    description: tool.description,
    function_slug: tool.functionSlug,
    input_schema: tool.inputSchema,
    name: tool.name,
  });
}

function compileAgentWebhookTool(tool: AgentWebhookTool): JsonObject {
  return definedObject({
    body_template: tool.bodyTemplate,
    description: tool.description,
    headers: tool.headers,
    method: tool.method,
    name: tool.name,
    url: tool.url,
  });
}

function compileDecisionConfig(node: DecideNode): JsonObject {
  const base = definedObject({
    conditions: node.conditions.map((condition) => definedObject({
      description: condition.description,
      label: condition.label,
    })),
    decision_type: node.decisionType,
  });

  if (node.decisionType === 'function') {
    return {
      ...base,
      function_slug: node.functionSlug,
    };
  }

  return definedObject({
    ...base,
    llm_configuration: node.llmConfiguration,
    llm_max_tokens: node.llmMaxTokens,
    llm_temperature: node.llmTemperature,
    provider_model_name: node.providerModel,
  });
}

function compileInteractiveConfig(node: SendInteractiveNode): JsonObject {
  const base = definedObject({
    ai_field_config: node.aiFields,
    body_text: node.bodyText,
    footer_text: node.footerText,
    header_media_url: node.headerMediaUrl,
    header_text: node.headerText,
    header_type: node.headerType,
    interactive_type: node.interactiveType,
    phone_number_id: node.phoneNumberId,
    provider_model_name: node.providerModel,
    to_phone_number: node.toPhoneNumber,
    whatsapp_config_id: node.whatsappConfigId,
  });

  switch (node.interactiveType) {
    case 'button':
      return {
        ...base,
        buttons: node.buttons.map((button) => ({ ...button })),
      };
    case 'cta_url':
      return {
        ...base,
        cta_display_text: node.ctaDisplayText,
        cta_url: node.ctaUrl,
      };
    case 'flow':
      return definedObject({
        ...base,
        flow_action: node.flowAction,
        flow_action_payload: node.flowActionPayload,
        flow_cta: node.flowCta,
        flow_id: node.flowId,
        flow_token: node.flowToken,
      });
    case 'list':
      return definedObject({
        ...base,
        list_button_text: node.listButtonText,
        list_sections: node.listSections.map((section) => definedObject({
          rows: section.rows.map((row) => definedObject({
            description: row.description,
            id: row.id,
            title: row.title,
          })),
          title: section.title,
        })),
      });
    case 'location_request_message':
      return base;
  }
}

function compileTemplateConfig(node: SendTemplateNode): JsonObject {
  return definedObject({
    ai_field_config: node.aiFields,
    parameters: node.parameters,
    phone_number_id: node.phoneNumberId,
    provider_model_name: node.providerModel,
    template_id: node.templateId,
    to_phone_number: node.toPhoneNumber,
    whatsapp_config_id: node.whatsappConfigId,
  });
}

function compileTextConfig(node: SendTextNode): JsonObject {
  return definedObject({
    ai_field_config: node.aiFields,
    delay_seconds: node.delaySeconds,
    message: node.message,
    phone_number_id: node.phoneNumberId,
    provider_model_name: node.providerModel,
    to_phone_number: node.toPhoneNumber,
    whatsapp_config_id: node.whatsappConfigId,
  });
}

function compileWaitConfig(node: WaitForResponseNode): JsonObject {
  return definedObject({
    has_timeout: node.timeoutSeconds !== undefined,
    save_response_to: node.saveResponseTo,
    timeout_seconds: node.timeoutSeconds,
  });
}

function compileTrigger(trigger: Trigger): WorkflowMetadata['triggers'][number] {
  switch (trigger.type) {
    case 'api_call':
      return {
        active: trigger.active ?? true,
        triggerType: 'api_call',
      };
    case 'inbound_message':
      return definedObject({
        active: trigger.active ?? true,
        phoneNumberId: trigger.phoneNumberId,
        triggerType: 'inbound_message',
      }) as WorkflowMetadata['triggers'][number];
    case 'whatsapp_event':
      return definedObject({
        active: trigger.active ?? true,
        event: trigger.event,
        phoneNumberId: trigger.phoneNumberId,
        triggerType: 'whatsapp_event',
      }) as WorkflowMetadata['triggers'][number];
  }
}

function validateNodeId(id: string, errors: ValidationIssue[]): void {
  if (!CLEAN_NODE_ID_PATTERN.test(id)) {
    errors.push(issue(
      'invalid_node_id',
      `Node id "${id}" must start with a letter and contain only letters, numbers, underscores, or dashes.`,
      `nodes.${id}`,
    ));
  }
}

function validateNode(id: string, node: WorkflowNode, errors: ValidationIssue[]): void {
  switch (node.type) {
    case 'agent':
      validateAgentNode(id, node, errors);
      return;
    case 'call':
      validateNonEmpty(id, 'workflowSlug', node.workflowSlug, errors);
      return;
    case 'decide':
      validateDecisionNode(id, node, errors);
      return;
    case 'function':
      validateNonEmpty(id, 'functionSlug', node.functionSlug, errors);
      return;
    case 'pipedream':
      validateNonEmpty(id, 'actionId', node.actionId, errors);
      validateNonEmpty(id, 'appSlug', node.appSlug, errors);
      return;
    case 'raw':
      validateNonEmpty(id, 'nodeType', node.nodeType, errors);
      return;
    case 'send_interactive':
      validateInteractiveNode(id, node, errors);
      return;
    case 'send_template':
      validateNonEmpty(id, 'templateId', node.templateId, errors);
      return;
    case 'send_text':
      validateNonEmpty(id, 'message', node.message, errors);
      return;
    case 'set_variable':
      validateNonEmpty(id, 'variableName', node.variableName, errors);
      return;
    case 'wait_for_response':
      if (node.timeoutSeconds !== undefined && node.timeoutSeconds <= 0) {
        errors.push(issue('invalid_timeout', `Node "${id}" timeoutSeconds must be positive.`, `nodes.${id}.timeoutSeconds`));
      }

      return;
    case 'webhook':
      validateNonEmpty(id, 'url', node.url, errors);
      if (node.method && !VALID_WEBHOOK_METHODS.has(node.method.toUpperCase())) {
        errors.push(issue('invalid_webhook_method', `Node "${id}" webhook method "${node.method}" is not supported.`, `nodes.${id}.method`));
      }

      return;
    default:
      return;
  }
}

function validateAgentNode(id: string, node: AgentNode, errors: ValidationIssue[]): void {
  if (node.reasoningEffort && !VALID_REASONING_EFFORTS.has(node.reasoningEffort)) {
    errors.push(issue(
      'invalid_reasoning_effort',
      `Node "${id}" reasoningEffort "${node.reasoningEffort}" is not supported.`,
      `nodes.${id}.reasoningEffort`,
    ));
  }

  for (const tool of node.enabledDefaultTools ?? []) {
    if (!DEFAULT_AGENT_TOOL_SET.has(tool)) {
      errors.push(issue(
        'unknown_agent_default_tool',
        `Node "${id}" enabledDefaultTools contains unknown tool "${tool}".`,
        `nodes.${id}.enabledDefaultTools`,
      ));
    }
  }

  for (const tool of node.functionTools ?? []) {
    validateNonEmpty(id, 'functionTools.name', tool.name, errors);
    validateNonEmpty(id, 'functionTools.functionSlug', tool.functionSlug, errors);
  }

  for (const tool of node.webhooks ?? []) {
    validateNonEmpty(id, 'webhooks.name', tool.name, errors);
    validateNonEmpty(id, 'webhooks.url', tool.url, errors);
  }
}

function validateDecisionNode(id: string, node: DecideNode, errors: ValidationIssue[]): void {
  const labels = new Set<string>();

  if (node.conditions.length === 0) {
    errors.push(issue('missing_decision_conditions', `Decision node "${id}" must have at least one condition.`, `nodes.${id}.conditions`));
  }

  if (node.decisionType === 'function') {
    validateNonEmpty(id, 'functionSlug', node.functionSlug, errors);
  }

  for (const condition of node.conditions) {
    if (condition.label.trim().length === 0) {
      errors.push(issue('empty_decision_condition_label', `Decision node "${id}" has an empty condition label.`, `nodes.${id}.conditions`));
      continue;
    }

    if (labels.has(condition.label)) {
      errors.push(issue(
        'duplicate_decision_condition',
        `Decision node "${id}" has duplicate condition label "${condition.label}".`,
        `nodes.${id}.conditions`,
      ));
    }

    labels.add(condition.label);
  }
}

function validateInteractiveNode(id: string, node: SendInteractiveNode, errors: ValidationIssue[]): void {
  if (node.interactiveType === 'button') {
    if (node.buttons.length === 0) {
      errors.push(issue('missing_buttons', `Node "${id}" must have at least one button.`, `nodes.${id}.buttons`));
    }

    if (node.buttons.length > 3) {
      errors.push(issue('too_many_buttons', `Node "${id}" can have at most 3 buttons.`, `nodes.${id}.buttons`));
    }

    for (const button of node.buttons) {
      if (button.title.length > 20) {
        errors.push(issue('button_title_too_long', `Node "${id}" button "${button.id}" title is longer than 20 characters.`, `nodes.${id}.buttons`));
      }
    }
  }

  if (node.interactiveType === 'list') {
    if (node.listSections.length === 0) {
      errors.push(issue('missing_list_sections', `Node "${id}" must have at least one list section.`, `nodes.${id}.listSections`));
    }

    if (node.listSections.length > 10) {
      errors.push(issue('too_many_list_sections', `Node "${id}" can have at most 10 list sections.`, `nodes.${id}.listSections`));
    }

    const rows = node.listSections.flatMap((section) => section.rows);
    if (rows.length > 10) {
      errors.push(issue('too_many_list_rows', `Node "${id}" can have at most 10 list rows.`, `nodes.${id}.listSections`));
    }

    for (const row of rows) {
      if (row.title.length > 24) {
        errors.push(issue('list_row_title_too_long', `Node "${id}" row "${row.id}" title is longer than 24 characters.`, `nodes.${id}.listSections`));
      }

      if (row.description && row.description.length > 72) {
        errors.push(issue('list_row_description_too_long', `Node "${id}" row "${row.id}" description is longer than 72 characters.`, `nodes.${id}.listSections`));
      }
    }
  }
}

function validateTrigger(trigger: Trigger, index: number, errors: ValidationIssue[]): void {
  if (trigger.type === 'whatsapp_event' && trigger.event.trim().length === 0) {
    errors.push(issue('empty_trigger_event', `Trigger ${index} has an empty event.`, `triggers.${index}.event`));
  }
}

function validateNonEmpty(
  id: string,
  field: string,
  value: string,
  errors: ValidationIssue[],
): void {
  if (value.trim().length === 0) {
    errors.push(issue('empty_required_field', `Node "${id}" field "${field}" cannot be empty.`, `nodes.${id}.${field}`));
  }
}

function edgePath(edge: StoredEdge): string {
  return `edges.${edge.source}.${edge.label}.${edge.target}`;
}

function issue(code: string, message: string, path?: string): ValidationIssue {
  return path ? { code, message, path } : { code, message };
}

function definedObject(values: Record<string, JsonValue | undefined>): JsonObject {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

function withRawConfig(config: JsonObject, node: { rawConfig?: JsonObject }): JsonObject {
  return node.rawConfig ? { ...config, ...cloneJsonObject(node.rawConfig) } : config;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value), null, 2);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) {
      result[key] = stableValue(child);
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCleanSlug(value: string): boolean {
  return CLEAN_SLUG_PATTERN.test(value);
}

export function normalizeSlug(value: string): string {
  const spaced = value
    .trim()
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replaceAll(/([a-z\d])([A-Z])/g, '$1-$2');

  const normalized = spaced
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  return normalized.length > 0 ? normalized : 'workflow';
}
