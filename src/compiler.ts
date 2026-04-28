import { START } from './constants.js';
import { cloneJsonObject } from './json.js';

import type { StoredEdge, StoredNode } from './internal-types.js';
import type {
  AgentFunctionTool,
  AgentNode,
  AgentWebhookTool,
  DecideNode,
  FlowDefinition,
  FlowNode,
  JsonObject,
  JsonValue,
  SendInteractiveNode,
  SendTemplateNode,
  SendTextNode,
  Trigger,
  WaitForResponseNode,
  WorkflowMetadata,
} from './types.js';

export function compileDefinition(
  edges: StoredEdge[],
  nodes: Iterable<StoredNode>,
): FlowDefinition {
  const storedNodes = Array.from(nodes);
  const startNode = storedNodes.find((node) => node.id === START);
  const regularNodes = storedNodes.filter((node) => node.id !== START);
  const flowNodes: FlowNode[] = [];

  if (startNode) {
    flowNodes.push(compileNode(startNode, 0));
  }

  let index = 1;
  for (const stored of regularNodes) {
    flowNodes.push(compileNode(stored, index));
    index += 1;
  }

  return {
    edges: edges.map((edge) => ({ ...edge })),
    nodes: flowNodes,
  };
}

export function compileTrigger(trigger: Trigger): WorkflowMetadata['triggers'][number] {
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

function nodeTypeFor(node: StoredNode['node']): string {
  if (node.type === 'start') {
    return START;
  }

  return node.type === 'raw' ? node.nodeType : node.type;
}

function compileConfig(node: StoredNode['node']): JsonObject {
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
    case 'start':
      return {};
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
