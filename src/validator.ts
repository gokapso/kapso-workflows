import {
  CLEAN_NODE_ID_PATTERN,
  DEFAULT_AGENT_TOOL_SET,
  NUMERIC_PROJECT_EVENT_OPERATORS,
  PROJECT_EVENT_MAX_PROPERTIES,
  PROJECT_EVENT_MAX_PROPERTIES_BYTES,
  PROJECT_EVENT_MAX_PROPERTY_KEY_LENGTH,
  PROJECT_EVENT_MAX_STRING_VALUE_BYTES,
  PROJECT_EVENT_NAME_MAX_LENGTH,
  PROJECT_EVENT_NAME_PATTERN,
  START,
  VALID_PROJECT_EVENT_OPERATORS,
  VALID_REASONING_EFFORTS,
  VALID_WEBHOOK_METHODS,
} from './constants.js';
import { isCleanSlug } from './slug.js';

import type { StoredEdge, StoredNode } from './internal-types.js';
import type {
  AgentNode,
  DecideNode,
  SendInteractiveNode,
  Trigger,
  ValidationIssue,
  ValidationResult,
} from './types.js';

type WorkflowValidationInput = {
  edges: StoredEdge[];
  nodes: Iterable<StoredNode>;
  slug: string;
  triggers: Trigger[];
};

export function validateWorkflow(input: WorkflowValidationInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const nodes = Array.from(input.nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  if (!isCleanSlug(input.slug)) {
    errors.push(issue('invalid_slug', `Workflow slug "${input.slug}" must be lowercase kebab-case.`, 'slug'));
  }

  if (!nodesById.has(START)) {
    errors.push(issue('missing_start_node', 'Workflow must include workflow.addNode(START).', `nodes.${START}`));
  }

  for (const stored of nodes) {
    validateNodeId(stored.id, errors);
    validateNode(stored.id, stored.node, errors);
  }

  input.triggers.forEach((trigger, index) => {
    validateTrigger(trigger, index, errors);
  });

  for (const edge of input.edges) {
    if (!hasNode(nodesById, edge.source)) {
      errors.push(issue('missing_edge_source', `Edge source "${edge.source}" does not exist.`, edgePath(edge)));
    }

    if (!hasNode(nodesById, edge.target)) {
      errors.push(issue('missing_edge_target', `Edge target "${edge.target}" does not exist.`, edgePath(edge)));
    }
  }

  validateDecisionEdges(nodes, input.edges, errors);
  validateOutgoingEdges(nodesById, input.edges, errors, warnings);

  return { errors, warnings };
}

function hasNode(nodesById: Map<string, StoredNode>, id: string): boolean {
  return nodesById.has(id);
}

function validateDecisionEdges(nodes: StoredNode[], edges: StoredEdge[], errors: ValidationIssue[]): void {
  for (const stored of nodes) {
    if (stored.node.type !== 'decide') {
      continue;
    }

    const conditionLabels = new Set(stored.node.conditions.map((condition) => condition.label));
    const outgoing = edges.filter((edge) => edge.source === stored.id);

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

function validateOutgoingEdges(
  nodesById: Map<string, StoredNode>,
  edges: StoredEdge[],
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const edgesBySource = new Map<string, StoredEdge[]>();

  for (const edge of edges) {
    const sourceEdges = edgesBySource.get(edge.source) ?? [];
    sourceEdges.push(edge);
    edgesBySource.set(edge.source, sourceEdges);
  }

  const startNextEdges = (edgesBySource.get(START) ?? []).filter((edge) => edge.label === 'next');
  if (startNextEdges.length > 1) {
    errors.push(issue('multiple_start_edges', 'The start node can only have one outgoing "next" edge.', 'edges'));
  }

  for (const [nodeId, nodeEdges] of edgesBySource) {
    const stored = nodesById.get(nodeId);
    const nodeType = stored?.node.type ?? 'unknown';

    if (nodeType === 'decide') {
      continue;
    }

    if (nodeType === 'handoff' && nodeEdges.length > 0) {
      warnings.push(issue(
        'handoff_outgoing_edges',
        `Handoff node "${nodeId}" has outgoing edges, but runtime handoff does not advance automatically.`,
        `nodes.${nodeId}`,
      ));
    }

    if (nodeType === 'function' && nodeEdges.length > 1) {
      warnings.push(issue(
        'function_multiple_edges',
        `Function node "${nodeId}" has multiple outgoing edges; use a decide node for branching.`,
        `nodes.${nodeId}`,
      ));
    }

    if (nodeType !== 'start' && nodeEdges.length > 1) {
      warnings.push(issue(
        'non_decision_multiple_edges',
        `Non-decision node "${nodeId}" has multiple outgoing edges.`,
        `nodes.${nodeId}`,
      ));
    }

    for (const edge of nodeEdges) {
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

function validateNodeId(id: string, errors: ValidationIssue[]): void {
  if (!CLEAN_NODE_ID_PATTERN.test(id)) {
    errors.push(issue(
      'invalid_node_id',
      `Node id "${id}" must start with a letter and contain only letters, numbers, underscores, or dashes.`,
      `nodes.${id}`,
    ));
  }
}

function validateNode(id: string, node: StoredNode['node'], errors: ValidationIssue[]): void {
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
    case 'emit_event':
      validateProjectEventName('node', id, node.eventName, `nodes.${id}.eventName`, errors);
      validateProjectEventProperties(id, node.properties, errors);
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
    case 'start':
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

  if (trigger.type !== 'project_event') {
    return;
  }

  const attributes = trigger.triggerableAttributes;
  validateProjectEventName(
    'trigger',
    `Trigger ${index}`,
    attributes.event_name,
    `triggers.${index}.triggerableAttributes.event_name`,
    errors,
  );

  if (attributes.property_key !== undefined && attributes.property_key.trim().length === 0) {
    errors.push(issue(
      'empty_project_event_property_key',
      `Trigger ${index} project event property_key cannot be empty.`,
      `triggers.${index}.triggerableAttributes.property_key`,
    ));
  }

  if (attributes.operator && !VALID_PROJECT_EVENT_OPERATORS.has(attributes.operator)) {
    errors.push(issue(
      'invalid_project_event_operator',
      `Trigger ${index} project event operator "${attributes.operator}" is not supported.`,
      `triggers.${index}.triggerableAttributes.operator`,
    ));
  }

  const propertyKeyPresent = attributes.property_key !== undefined && attributes.property_key.trim().length > 0;
  const operatorPresent = attributes.operator !== undefined && attributes.operator.length > 0;
  const propertyValuePresent = attributes.property_value !== undefined && attributes.property_value !== null;
  const hasAnyPropertyFilter = propertyKeyPresent || operatorPresent || propertyValuePresent;
  const hasCompletePropertyFilter = propertyKeyPresent && operatorPresent && propertyValuePresent;

  if (hasAnyPropertyFilter && !hasCompletePropertyFilter) {
    errors.push(issue(
      'incomplete_project_event_property_filter',
      `Trigger ${index} project event property filter must include property_key, operator, and non-null property_value.`,
      `triggers.${index}.triggerableAttributes`,
    ));
  }

  if (
    hasCompletePropertyFilter &&
    attributes.operator &&
    NUMERIC_PROJECT_EVENT_OPERATORS.has(attributes.operator) &&
    !isNumericProjectEventPropertyValue(attributes.property_value)
  ) {
    errors.push(issue(
      'invalid_project_event_numeric_property_value',
      `Trigger ${index} project event property_value must be a number for numeric operator "${attributes.operator}".`,
      `triggers.${index}.triggerableAttributes.property_value`,
    ));
  }
}

function validateProjectEventName(
  ownerType: 'node' | 'trigger',
  owner: string,
  value: string,
  path: string,
  errors: ValidationIssue[],
): void {
  if (!PROJECT_EVENT_NAME_PATTERN.test(value) || value.length > PROJECT_EVENT_NAME_MAX_LENGTH) {
    const subject = ownerType === 'node' ? `Node "${owner}" field "eventName"` : `${owner} project event name "${value}"`;
    errors.push(issue(
      'invalid_project_event_name',
      `${subject} must be lowercase dotted snake_case and at most ${PROJECT_EVENT_NAME_MAX_LENGTH} characters.`,
      path,
    ));
  }
}

function validateProjectEventProperties(
  id: string,
  properties: Record<string, unknown> | undefined,
  errors: ValidationIssue[],
): void {
  const entries = Object.entries(properties ?? {});

  if (entries.length > PROJECT_EVENT_MAX_PROPERTIES) {
    errors.push(issue(
      'too_many_project_event_properties',
      `Node "${id}" Project Event properties can include at most ${PROJECT_EVENT_MAX_PROPERTIES} keys.`,
      `nodes.${id}.properties`,
    ));
  }

  if (jsonByteLength(properties ?? {}) > PROJECT_EVENT_MAX_PROPERTIES_BYTES) {
    errors.push(issue(
      'project_event_properties_too_large',
      `Node "${id}" Project Event properties payload must be at most ${PROJECT_EVENT_MAX_PROPERTIES_BYTES} bytes.`,
      `nodes.${id}.properties`,
    ));
  }

  for (const [key, value] of entries) {
    if (key.trim().length === 0) {
      errors.push(issue(
        'empty_project_event_property_key',
        `Node "${id}" Project Event property key cannot be empty.`,
        `nodes.${id}.properties`,
      ));
    }

    if (key.length > PROJECT_EVENT_MAX_PROPERTY_KEY_LENGTH) {
      errors.push(issue(
        'project_event_property_key_too_long',
        `Node "${id}" Project Event property key "${key}" is longer than ${PROJECT_EVENT_MAX_PROPERTY_KEY_LENGTH} characters.`,
        `nodes.${id}.properties.${key}`,
      ));
    }

    if (!isJsonPrimitive(value) || (typeof value === 'number' && !Number.isFinite(value))) {
      errors.push(issue(
        'invalid_project_event_property_value',
        `Node "${id}" Project Event property "${key}" must be a scalar JSON value.`,
        `nodes.${id}.properties.${key}`,
      ));
    }

    if (typeof value === 'string' && textByteLength(value) > PROJECT_EVENT_MAX_STRING_VALUE_BYTES) {
      errors.push(issue(
        'project_event_property_string_too_large',
        `Node "${id}" Project Event property "${key}" string value must be at most ${PROJECT_EVENT_MAX_STRING_VALUE_BYTES} bytes.`,
        `nodes.${id}.properties.${key}`,
      ));
    }
  }
}

function isJsonPrimitive(value: unknown): boolean {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

function jsonByteLength(value: unknown): number {
  return textByteLength(JSON.stringify(value));
}

function textByteLength(value: string): number {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function isNumericProjectEventPropertyValue(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  return Number.isFinite(Number(value));
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
