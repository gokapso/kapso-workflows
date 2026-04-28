import {
  CLEAN_NODE_ID_PATTERN,
  DEFAULT_AGENT_TOOL_SET,
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
  WorkflowNode,
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
  return id === 'start' || nodesById.has(id);
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

  const startNextEdges = (edgesBySource.get('start') ?? []).filter((edge) => edge.label === 'next');
  if (startNextEdges.length > 1) {
    errors.push(issue('multiple_start_edges', 'The start node can only have one outgoing "next" edge.', 'edges'));
  }

  for (const [nodeId, nodeEdges] of edgesBySource) {
    const stored = nodesById.get(nodeId);
    const nodeType = stored?.node.type ?? 'start';

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
