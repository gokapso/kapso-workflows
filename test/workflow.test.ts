import { describe, expect, it } from 'bun:test';

import {
  Workflow,
  WorkflowValidationError,
  canonicalJson,
  normalizeSlug,
} from '../src/index';

import type { FlowDefinition } from '../src/index';

describe('Workflow', () => {
  it('creates an implicit start node and preserves node and edge order', () => {
    const workflow = new Workflow('inbound-support', { name: 'Inbound Support' });

    workflow
      .addNode('normalize', {
        functionSlug: 'normalize-phone',
        type: 'function',
      })
      .addNode('sendWelcome', {
        message: 'Hi there',
        type: 'send_text',
      }, {
        position: { x: 10, y: 20 },
      })
      .addEdge('start', 'normalize')
      .addEdge('normalize', 'sendWelcome');

    const definition = workflow.toDefinition();

    expect(definition.nodes.map((node) => node.id)).toEqual(['start', 'normalize', 'sendWelcome']);
    expect(definition.nodes[0]).toEqual({
      data: {
        config: {},
        node_type: 'start',
      },
      id: 'start',
      position: { x: 0, y: 0 },
      type: 'flow-node',
    });
    expect(definition.nodes[1]?.position).toEqual({ x: 240, y: 0 });
    expect(definition.nodes[2]?.position).toEqual({ x: 10, y: 20 });
    expect(definition.edges).toEqual([
      { label: 'next', source: 'start', target: 'normalize' },
      { label: 'next', source: 'normalize', target: 'sendWelcome' },
    ]);
  });

  it('emits source metadata, triggers, and canonical definition JSON', () => {
    const workflow = new Workflow('inbound-support', {
      name: 'Inbound Support',
      status: 'draft',
    });

    workflow
      .addTrigger({ phoneNumberId: '15551234567', type: 'inbound_message' })
      .addTrigger({ active: false, event: 'message_template_status_update', type: 'whatsapp_event' })
      .addNode('wait', {
        saveResponseTo: 'reply',
        timeoutSeconds: 60,
        type: 'wait_for_response',
      })
      .addEdge('start', 'wait');

    const sourceFiles = workflow.toSourceFiles();

    expect(sourceFiles.metadata).toEqual({
      definition: 'definition.json',
      name: 'Inbound Support',
      slug: 'inbound-support',
      status: 'draft',
      triggers: [
        {
          active: true,
          phoneNumberId: '15551234567',
          triggerType: 'inbound_message',
        },
        {
          active: false,
          event: 'message_template_status_update',
          triggerType: 'whatsapp_event',
        },
      ],
    });
    expect(sourceFiles.definitionJson).toBe(`${canonicalJson(sourceFiles.definition)}\n`);
    expect(sourceFiles.definitionJson).toContain('"node_type": "wait_for_response"');
  });

  it('compiles send text, template, and interactive nodes', () => {
    const workflow = new Workflow('messaging');

    workflow
      .addNode('text', {
        aiFields: { tone: 'friendly' },
        delaySeconds: 3,
        message: 'Hello {{vars.name}}',
        phoneNumberId: '15551234567',
        providerModel: 'gpt-5-mini',
        toPhoneNumber: '{{vars.phone}}',
        type: 'send_text',
      })
      .addNode('template', {
        parameters: { name: '{{vars.name}}' },
        templateId: 'tpl_123',
        type: 'send_template',
        whatsappConfigId: 'wac_123',
      })
      .addNode('buttons', {
        bodyText: 'Choose',
        buttons: [
          { id: 'sales', title: 'Sales' },
          { id: 'support', title: 'Support' },
        ],
        interactiveType: 'button',
        type: 'send_interactive',
      })
      .addNode('list', {
        interactiveType: 'list',
        listButtonText: 'Open',
        listSections: [
          {
            rows: [
              { id: 'one', title: 'One' },
              { description: 'Second option', id: 'two', title: 'Two' },
            ],
            title: 'Options',
          },
        ],
        type: 'send_interactive',
      })
      .addNode('cta', {
        ctaDisplayText: 'Open',
        ctaUrl: 'https://example.com',
        interactiveType: 'cta_url',
        type: 'send_interactive',
      })
      .addNode('flow', {
        flowAction: 'navigate',
        flowActionPayload: { screen: 'intro' },
        flowCta: 'Start',
        flowId: 'meta-flow-id',
        flowToken: 'token',
        interactiveType: 'flow',
        type: 'send_interactive',
      })
      .addNode('location', {
        interactiveType: 'location_request_message',
        type: 'send_interactive',
      });

    const configs = configsById(workflow.toDefinition());

    expect(configs.text).toEqual({
      ai_field_config: { tone: 'friendly' },
      delay_seconds: 3,
      message: 'Hello {{vars.name}}',
      phone_number_id: '15551234567',
      provider_model_name: 'gpt-5-mini',
      to_phone_number: '{{vars.phone}}',
    });
    expect(configs.template).toEqual({
      parameters: { name: '{{vars.name}}' },
      template_id: 'tpl_123',
      whatsapp_config_id: 'wac_123',
    });
    expect(configs.buttons?.buttons).toEqual([
      { id: 'sales', title: 'Sales' },
      { id: 'support', title: 'Support' },
    ]);
    expect(configs.list?.list_sections).toEqual([
      {
        rows: [
          { id: 'one', title: 'One' },
          { description: 'Second option', id: 'two', title: 'Two' },
        ],
        title: 'Options',
      },
    ]);
    expect(configs.cta).toMatchObject({
      cta_display_text: 'Open',
      cta_url: 'https://example.com',
      interactive_type: 'cta_url',
    });
    expect(configs.flow).toMatchObject({
      flow_action: 'navigate',
      flow_action_payload: { screen: 'intro' },
      flow_cta: 'Start',
      flow_id: 'meta-flow-id',
      flow_token: 'token',
      interactive_type: 'flow',
    });
    expect(configs.location).toEqual({
      interactive_type: 'location_request_message',
    });
  });

  it('compiles function, decision, and call nodes with slug references', () => {
    const workflow = new Workflow('router');

    workflow
      .addNode('normalize', {
        functionSlug: 'normalize-phone',
        saveResponseTo: 'normalized_phone',
        type: 'function',
      })
      .addNode('classify', {
        conditions: [
          { description: 'Sales inquiry', label: 'sales' },
          { label: 'support' },
        ],
        decisionType: 'function',
        functionSlug: 'classify-message',
        type: 'decide',
      })
      .addNode('support', {
        saveErrorTo: 'support_error',
        type: 'call',
        workflowSlug: 'support-flow',
      })
      .addEdge('start', 'normalize')
      .addEdge('normalize', 'classify')
      .addEdge('classify', 'support', { label: 'support' });

    const configs = configsById(workflow.toDefinition());

    expect(configs.normalize).toEqual({
      function_slug: 'normalize-phone',
      save_response_to: 'normalized_phone',
    });
    expect(configs.classify).toEqual({
      conditions: [
        { description: 'Sales inquiry', label: 'sales' },
        { label: 'support' },
      ],
      decision_type: 'function',
      function_slug: 'classify-message',
    });
    expect(configs.support).toEqual({
      save_error_to: 'support_error',
      workflow_slug: 'support-flow',
    });
  });

  it('compiles AI decisions and agent function tools', () => {
    const workflow = new Workflow('agent-flow');

    workflow
      .addNode('decide', {
        conditions: [{ label: 'next' }],
        decisionType: 'ai',
        llmConfiguration: { instructions: 'Be brief' },
        llmMaxTokens: 200,
        llmTemperature: 0.2,
        providerModel: 'gpt-5-mini',
        type: 'decide',
      })
      .addNode('agent', {
        enabledDefaultTools: ['get_whatsapp_context', 'complete_task'],
        functionTools: [
          {
            description: 'Lookup order',
            functionSlug: 'lookup-order',
            inputSchema: {
              properties: { order_id: { type: 'string' } },
              required: ['order_id'],
              type: 'object',
            },
            name: 'lookup_order',
          },
        ],
        maxIterations: 5,
        providerModel: 'gpt-5',
        reasoningEffort: 'medium',
        sandboxAllowedOutboundHosts: ['api.example.com'],
        sandboxEnabled: true,
        sandboxNetworkMode: 'allowlist',
        systemPrompt: 'Help the user.',
        temperature: 0.1,
        type: 'agent',
        webhooks: [
          {
            bodyTemplate: { phone: '{{vars.phone}}' },
            headers: { Authorization: 'Bearer {{vars.token}}' },
            method: 'POST',
            name: 'lookup_customer',
            url: 'https://example.com/customer',
          },
        ],
      });

    const configs = configsById(workflow.toDefinition());

    expect(configs.decide).toMatchObject({
      decision_type: 'ai',
      llm_configuration: { instructions: 'Be brief' },
      llm_max_tokens: 200,
      llm_temperature: 0.2,
      provider_model_name: 'gpt-5-mini',
    });
    expect(configs.agent).toMatchObject({
      enabled_default_tools: ['get_whatsapp_context', 'complete_task'],
      flow_agent_function_tools: [
        {
          description: 'Lookup order',
          function_slug: 'lookup-order',
          input_schema: {
            properties: { order_id: { type: 'string' } },
            required: ['order_id'],
            type: 'object',
          },
          name: 'lookup_order',
        },
      ],
      provider_model_name: 'gpt-5',
      reasoning_effort: 'medium',
      sandbox_allowed_outbound_hosts: ['api.example.com'],
      sandbox_enabled: true,
      sandbox_network_mode: 'allowlist',
      system_prompt: 'Help the user.',
    });
    expect(configs.agent?.flow_agent_webhooks).toEqual([
      {
        body_template: { phone: '{{vars.phone}}' },
        headers: { Authorization: 'Bearer {{vars.token}}' },
        method: 'POST',
        name: 'lookup_customer',
        url: 'https://example.com/customer',
      },
    ]);
  });

  it('compiles webhook, pipedream, handoff, set variable, and raw nodes', () => {
    const workflow = new Workflow('actions');

    workflow
      .addNode('webhook', {
        bodyTemplate: { phone: '{{vars.phone}}' },
        headers: { Authorization: 'Bearer {{vars.token}}' },
        method: 'POST',
        providerModel: 'gpt-5-mini',
        saveResponseTo: 'customer',
        type: 'webhook',
        url: 'https://example.com/customer',
      })
      .addNode('ticket', {
        accountId: 'acct_123',
        actionId: 'zendesk-create-ticket',
        appSlug: 'zendesk',
        configuredProps: { subject: '{{vars.subject}}' },
        dynamicPropsId: 'dyn_123',
        saveResponseTo: 'ticket',
        type: 'pipedream',
      })
      .addNode('handoff', {
        contextData: { tier: 'enterprise' },
        reason: 'needs_human',
        type: 'handoff',
      })
      .addNode('setPlan', {
        type: 'set_variable',
        valueType: 'string',
        variableName: 'plan',
        variableValue: 'pro',
      })
      .addNode('future', {
        config: { future_field: true },
        nodeType: 'future_node_type',
        type: 'raw',
      });

    const definition = workflow.toDefinition();
    const configs = configsById(definition);

    expect(configs.webhook).toEqual({
      body_template: { phone: '{{vars.phone}}' },
      headers: { Authorization: 'Bearer {{vars.token}}' },
      method: 'POST',
      provider_model_name: 'gpt-5-mini',
      save_response_to: 'customer',
      url: 'https://example.com/customer',
    });
    expect(configs.ticket).toEqual({
      account_id: 'acct_123',
      action_id: 'zendesk-create-ticket',
      app_slug: 'zendesk',
      configured_props: { subject: '{{vars.subject}}' },
      dynamic_props_id: 'dyn_123',
      save_response_to: 'ticket',
    });
    expect(configs.handoff).toEqual({
      context_data: { tier: 'enterprise' },
      reason: 'needs_human',
    });
    expect(configs.setPlan).toEqual({
      value_type: 'string',
      variable_name: 'plan',
      variable_value: 'pro',
    });
    expect(definition.nodes.find((node) => node.id === 'future')?.data.node_type).toBe('future_node_type');
    expect(configs.future).toEqual({ future_field: true });
  });

  it('merges rawConfig into typed nodes as an escape hatch', () => {
    const workflow = new Workflow('raw-config');

    workflow.addNode('send', {
      message: 'Hello',
      rawConfig: {
        experimental_field: 'yes',
      },
      type: 'send_text',
    });

    expect(configsById(workflow.toDefinition()).send).toEqual({
      experimental_field: 'yes',
      message: 'Hello',
    });
  });

  it('throws on duplicate nodes and manual start nodes', () => {
    const workflow = new Workflow('duplicates');
    workflow.addNode('one', {
      message: 'Hello',
      type: 'send_text',
    });

    expect(() => workflow.addNode('one', {
      message: 'Again',
      type: 'send_text',
    })).toThrow('already exists');
    expect(() => workflow.addNode('start', {
      message: 'Nope',
      type: 'send_text',
    })).toThrow('created automatically');
  });

  it('rejects invalid workflow slugs, node ids, and missing edge endpoints', () => {
    const workflow = new Workflow('Bad Slug');

    workflow
      .addNode('bad id', {
        message: 'Hello',
        type: 'send_text',
      })
      .addEdge('missing', 'bad id')
      .addEdge('bad id', 'alsoMissing');

    const result = workflow.validate();

    expect(result.errors.map((error) => error.code)).toContain('invalid_slug');
    expect(result.errors.map((error) => error.code)).toContain('invalid_node_id');
    expect(result.errors.map((error) => error.code)).toContain('missing_edge_source');
    expect(result.errors.map((error) => error.code)).toContain('missing_edge_target');
    expect(() => workflow.toDefinition()).toThrow(WorkflowValidationError);
  });

  it('rejects decision edges without matching condition labels and duplicate conditions', () => {
    const workflow = new Workflow('decision-errors');

    workflow
      .addNode('classify', {
        conditions: [
          { label: 'sales' },
          { label: 'sales' },
        ],
        decisionType: 'ai',
        type: 'decide',
      })
      .addNode('nextNode', {
        message: 'Next',
        type: 'send_text',
      })
      .addEdge('classify', 'nextNode', { label: 'support' });

    const result = workflow.validate();

    expect(result.errors.map((error) => error.code)).toContain('duplicate_decision_condition');
    expect(result.errors.map((error) => error.code)).toContain('unknown_decision_edge_label');
  });

  it('rejects invalid timeout, webhook method, agent fields, and interactive limits', () => {
    const workflow = new Workflow('invalid-fields');

    workflow
      .addNode('wait', {
        timeoutSeconds: 0,
        type: 'wait_for_response',
      })
      .addNode('webhook', {
        method: 'TRACE',
        type: 'webhook',
        url: 'https://example.com',
      })
      .addNode('agent', {
        enabledDefaultTools: ['not_a_tool'],
        reasoningEffort: 'extreme',
        type: 'agent',
      })
      .addNode('buttons', {
        buttons: [
          { id: 'one', title: 'One' },
          { id: 'two', title: 'Two' },
          { id: 'three', title: 'Three' },
          { id: 'four', title: 'Four' },
        ],
        interactiveType: 'button',
        type: 'send_interactive',
      })
      .addNode('list', {
        interactiveType: 'list',
        listSections: [
          {
            rows: [
              { description: 'x'.repeat(73), id: 'bad', title: 'x'.repeat(25) },
              ...Array.from({ length: 10 }, (_, index) => ({ id: `row${index}`, title: `Row ${index}` })),
            ],
          },
        ],
        type: 'send_interactive',
      });

    expect(workflow.validate().errors.map((error) => error.code)).toEqual([
      'invalid_timeout',
      'invalid_webhook_method',
      'invalid_reasoning_effort',
      'unknown_agent_default_tool',
      'too_many_buttons',
      'too_many_list_rows',
      'list_row_title_too_long',
      'list_row_description_too_long',
    ]);
  });

  it('rejects empty required runtime strings', () => {
    const workflow = new Workflow('empty-fields');

    workflow
      .addTrigger({ event: '', type: 'whatsapp_event' })
      .addNode('fn', {
        functionSlug: '',
        type: 'function',
      })
      .addNode('call', {
        type: 'call',
        workflowSlug: '',
      })
      .addNode('decision', {
        conditions: [{ label: '' }],
        decisionType: 'function',
        functionSlug: '',
        type: 'decide',
      })
      .addNode('agent', {
        functionTools: [
          {
            functionSlug: '',
            name: '',
          },
        ],
        type: 'agent',
      })
      .addNode('raw', {
        config: {},
        nodeType: '',
        type: 'raw',
      });

    expect(workflow.validate().errors.map((error) => error.code)).toEqual([
      'empty_required_field',
      'empty_required_field',
      'empty_required_field',
      'empty_decision_condition_label',
      'empty_required_field',
      'empty_required_field',
      'empty_required_field',
      'empty_trigger_event',
    ]);
  });

  it('warns about runtime footguns without blocking compilation', () => {
    const workflow = new Workflow('warnings');

    workflow
      .addNode('fn', {
        functionSlug: 'do-work',
        type: 'function',
      })
      .addNode('one', {
        message: 'One',
        type: 'send_text',
      })
      .addNode('two', {
        message: 'Two',
        type: 'send_text',
      })
      .addNode('handoff', {
        type: 'handoff',
      })
      .addEdge('fn', 'one')
      .addEdge('fn', 'two', { label: 'other' })
      .addEdge('handoff', 'one');

    const result = workflow.validate();

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'function_multiple_edges',
      'non_decision_multiple_edges',
      'non_decision_edge_label',
      'handoff_outgoing_edges',
    ]);
    expect(workflow.toDefinition().edges).toHaveLength(3);
  });

  it('rejects multiple outgoing next edges from start', () => {
    const workflow = new Workflow('bad-start');

    workflow
      .addNode('one', {
        message: 'One',
        type: 'send_text',
      })
      .addNode('two', {
        message: 'Two',
        type: 'send_text',
      })
      .addEdge('start', 'one')
      .addEdge('start', 'two');

    expect(workflow.validate().errors.map((error) => error.code)).toContain('multiple_start_edges');
  });

  it('normalizes slugs the same way source sync expects', () => {
    expect(normalizeSlug('ThisIsA Function!!')).toBe('this-is-a-function');
    expect(normalizeSlug('  Crédito Déjà Vu  ')).toBe('credito-deja-vu');
    expect(normalizeSlug('!!!')).toBe('workflow');
  });
});

function configsById(definition: FlowDefinition) {
  return Object.fromEntries(definition.nodes.map((node) => [node.id, node.data.config]));
}
