# Kapso Workflows JS/TS Library Implementation Plan

## Goal

Build a small JS/TS library for authoring Kapso workflows as code.

The library should be boring:

- It builds a graph.
- It validates obvious mistakes.
- It compiles to the same workflow definition JSON that `kapso pull` and `kapso push` already understand.
- It does not execute workflows locally.
- It does not hide the graph behind async/await, decorators, JSX, or a custom language.

The mental model should stay close to the current product: nodes, edges, triggers, and project resource references.

## What I Inspected

Primary source files:

- `cientos/app/jobs/flows/update_flow_with_definition_job.rb`
  - This is the current import/apply path for workflow definitions.
  - It creates or updates nodes by `node.id`, creates or updates edges by source and label or condition, and deletes remote nodes/edges omitted from the submitted definition.
- `cientos/app/blueprints/flow_blueprint.rb`
  - This is the current export path for canvas definitions.
  - It serializes `definition.nodes[]` and `definition.edges[]`.
- `cientos/app/javascript/config/flows/flow-node-schemas.ts`
  - This is the current UI node surface and field schema.
- `cientos/app/javascript/types/flow-node.ts`
  - This is the frontend node type union.
- `cientos/app/models/flow_step.rb`, `flow_edge.rb`, `flow_condition.rb`
  - These define graph identity, edge uniqueness, and decision condition behavior.
- `cientos/app/models/flow_action_step.rb`, `flow_wait_step.rb`, `flow_decide_step.rb`, `flow_agent_step.rb`, `call_flow_step.rb`
  - These define runtime node behavior.
- Action models: `send_text_action.rb`, `send_template_action.rb`, `send_interactive_action.rb`, `webhook_action.rb`, `pipedream_action.rb`, `function_action.rb`, `set_variable_action.rb`, `handoff_action.rb`.
- Trigger models/controllers/blueprints:
  - `flow_trigger.rb`
  - `inbound_message_trigger.rb`
  - `api_call_trigger.rb`
  - `whatsapp_event_trigger.rb`
  - `api/platform/v1/flow_triggers_controller.rb`
  - `flow_trigger_blueprint.rb`
- Tests:
  - `spec/jobs/flows/update_flow_with_definition_job_spec.rb`
  - `spec/jobs/flows/update_flow_with_definition_job_pipedream_spec.rb`
  - `spec/blueprints/flow_blueprint_spec.rb`
  - flow step and trigger specs.
- CLI source sync:
  - `kapso-cli/src/services/source-sync.ts`
  - `kapso-cli/src/services/source-transforms.ts`

## Current Definition Contract

The API/canvas definition shape is:

```json
{
  "nodes": [
    {
      "id": "normalize",
      "type": "flow-node",
      "position": { "x": 0, "y": 0 },
      "data": {
        "node_type": "function",
        "config": {},
        "display_name": "Function"
      }
    }
  ],
  "edges": [
    {
      "source": "start",
      "target": "normalize",
      "label": "next"
    }
  ]
}
```

Important semantics:

- `node.id` is the stable source identity for a node inside a workflow.
- The backend stores it as `flow_steps.identifier`.
- Renaming a node display label should not change the node id.
- Missing nodes are deleted on push if `definition.nodes` is present.
- Missing edges are deleted on push if `definition.edges` is present.
- Edge IDs are remote-generated and should not be in source.
- Decision condition IDs are remote-generated and should not be in source.
- Decision edges should be source-authored by condition label.
- Non-decision runtime steps normally advance on the `next` edge.
- A normal function node currently logs `next_edge` if a function returns it, but the runtime still advances to `next`. Branching by function must use a `decide` node with `decision_type: "function"`.

## Recommended Public API

The first library should be a direct graph builder:

```ts
import { Workflow } from "@kapso/workflows";

const workflow = new Workflow("inbound-support", {
  name: "Inbound Support",
  status: "draft",
});

workflow.addTrigger({
  type: "inbound_message",
  phoneNumberId: "15551234567",
});

workflow.addNode("normalize", {
  type: "function",
  functionSlug: "normalize-phone",
  saveResponseTo: "normalized_phone",
});

workflow.addNode("classify", {
  type: "decide",
  decisionType: "function",
  functionSlug: "classify-message",
  conditions: [
    { label: "sales", description: "Sales inquiry" },
    { label: "support", description: "Support request" },
    { label: "default", description: "Anything else" },
  ],
});

workflow.addNode("sales", {
  type: "call",
  workflowSlug: "sales-flow",
});

workflow.addNode("support", {
  type: "call",
  workflowSlug: "support-flow",
});

workflow.addEdge("start", "normalize");
workflow.addEdge("normalize", "classify");
workflow.addEdge("classify", "sales", { label: "sales" });
workflow.addEdge("classify", "support", { label: "support" });
workflow.addEdge("classify", "support", { label: "default" });

export default workflow;
```

Core API:

```ts
new Workflow(slug, options)
workflow.addTrigger(trigger)
workflow.addNode(id, node, options?)
workflow.addEdge(from, to, options?)
workflow.toDefinition()
workflow.toSourceFiles()
workflow.validate()
```

Recommended rules:

- Use camelCase in TypeScript.
- Compile to canonical snake_case JSON/YAML for source files.
- Keep public node type names close to backend `node_type` names.
- Automatically include a `start` node with id `start`.
- Let users override `start` position, but not remove it in V1.
- Expose a raw escape hatch, but do not make raw the main experience.

Example raw node:

```ts
workflow.addNode("future", {
  type: "raw",
  nodeType: "future_node_type",
  config: {},
});
```

## Package Shape

Create this as a standalone TypeScript package first:

```txt
kapso-workflows/
  package.json
  tsconfig.json
  src/
    index.ts
    workflow.ts
    types.ts
    compile.ts
    validate.ts
    normalize.ts
  test/
    workflow.test.ts
    compile.test.ts
    validate.test.ts
  IMPLEMENTATION_PLAN.md
```

Package name when published:

```txt
@kapso/workflows
```

Keep dependencies minimal. Recommended V1 dependencies:

- TypeScript dev dependency.
- Vitest or the repo-standard test runner.
- No runtime dependency unless validation becomes painful.

Avoid adding Zod in V1 unless we decide the runtime schemas are worth the extra dependency. TypeScript types plus targeted runtime validation should be enough to start.

## Source File Integration

Kapso should support two source formats:

- CLI-only source: `workflow.yaml` plus `definition.json`.
- Optional code source: `workflow.ts`, compiled to the same JSON/YAML contract.

Current CLI source sync uses:

```txt
workflows/<slug>/workflow.yaml
workflows/<slug>/definition.json
```

Recommended layout for code-authored workflows:

```txt
workflows/<slug>/workflow.yaml
workflows/<slug>/workflow.ts
workflows/<slug>/definition.json
```

In V1, `definition.json` remains first-class. Teams can commit it for reviewable compiled output, or ignore it with `.gitignore`.

Recommended CLI behavior:

- If `workflow.ts` exists, `kapso push` compiles it, writes/updates `definition.json`, and uploads that compiled definition.
- If `workflow.ts` does not exist, `kapso push` reads `definition.json`.
- If both exist, `workflow.ts` wins for push; `definition.json` is overwritten with the compiled output.
- `kapso build` should perform the same compile-and-write step without uploading.
- `kapso pull` should keep writing `workflow.yaml` and `definition.json`. It should not generate or overwrite `workflow.ts` in V1.

This keeps the first version simple:

- Pull gives you exact JSON.
- Code authoring is opt-in.
- CLI-only users never need the TS library.
- Push applies the same sync plan whether the source came from TypeScript or JSON.

## Node Matrix

### `start`

Backend:

- `node_type: "start"`
- Stored as a `FlowActionStep` without executable.
- Runtime advances to edge label `next`.

Public API:

```ts
workflow.addEdge("start", "nextNode");
```

Implementation notes:

- Create automatically.
- Compile as a normal node with id `start`.
- Enforce at most one outgoing `next` edge from `start`.

### `send_text`

Backend fields:

- `message`
- `whatsapp_config_id`
- `to_phone_number`
- `delay_seconds`
- `provider_model_id` or `provider_model_name`
- `ai_field_config`

Public API:

```ts
workflow.addNode("sendWelcome", {
  type: "send_text",
  message: "Hi {{vars.name}}",
  phoneNumberId: "15551234567",
  toPhoneNumber: "{{vars.admin_phone}}",
});
```

Compile target:

- `message` -> `config.message`
- `toPhoneNumber` -> `config.to_phone_number`
- `providerModel` -> `config.provider_model_name`
- `aiFields` -> `config.ai_field_config`
- `phoneNumberId` should compile to `phone_number_id`; Cientos import should resolve it to `whatsapp_config_id`.

Needed Cientos/CLI work:

- Add support for `phone_number_id` in `send_text` config import, resolving it to project `whatsapp_config_id`.
- Export `phone_number_id` instead of only `whatsapp_config_id` for source sync.

### `send_template`

Backend fields:

- `whatsapp_config_id`
- `template_id`
- `parameters`
- `to_phone_number`
- `provider_model_id` or `provider_model_name`
- `ai_field_config`

Public API:

```ts
workflow.addNode("sendTemplate", {
  type: "send_template",
  templateId: "remote-template-id",
  parameters: { name: "{{vars.name}}" },
  phoneNumberId: "15551234567",
});
```

Recommendation:

- V1 can support `templateId` as the raw current API field.
- Do not promise cross-project portability for templates yet.
- Later add `templateSlug` or `templateName` only if Cientos exposes a stable template source identifier.

Needed Cientos/CLI work for a nicer V1:

- Resolve `phone_number_id` to `whatsapp_config_id`.
- Decide whether WhatsApp templates have a stable source identifier. If not, keep `templateId` explicit.

### `send_interactive`

Backend fields:

- `whatsapp_config_id`
- `interactive_type`
- `body_text`
- `footer_text`
- `header_type`, `header_text`, `header_media_url`
- button config: `buttons`
- list config: `list_button_text`, `list_sections`
- CTA config: `cta_display_text`, `cta_url`
- WhatsApp Flow config: `flow_id`, `flow_cta`, `flow_token`, `flow_action`, `flow_action_payload`
- location request config: `interactive_type: "location_request_message"`
- `to_phone_number`
- `provider_model_id` or `provider_model_name`
- `ai_field_config`

Public API:

```ts
workflow.addNode("choose", {
  type: "send_interactive",
  interactiveType: "button",
  bodyText: "What do you need?",
  buttons: [
    { id: "sales", title: "Sales" },
    { id: "support", title: "Support" },
  ],
});
```

Important gap:

- The frontend schema lists `product`, `product_list`, and `catalog_message`.
- The backend import mapper currently handles `button`, `list`, `cta_url`, `flow`, and `location_request_message`.
- Do not expose product/catalog variants as first-class helpers until the import job maps them correctly.

Needed Cientos/CLI work:

- Add `phone_number_id` support.
- Either remove unsupported interactive variants from the code library or add backend import support for them first.

### `wait_for_response`

Backend fields:

- `has_timeout`
- `timeout_seconds`
- `save_response_to`

Runtime:

- Enters waiting state.
- On resume, stores input in `vars.last_user_input`.
- If `save_response_to` is present, stores input there too.
- Timeout resumes with `system.last_resume.reason == "timeout"` and clears user input variables.
- Always advances on `next` after resume.

Public API:

```ts
workflow.addNode("waitForReply", {
  type: "wait_for_response",
  timeoutSeconds: 3600,
  saveResponseTo: "reply",
});
```

Compile target:

- `timeoutSeconds` implies `has_timeout: true`.
- Missing `timeoutSeconds` compiles to `has_timeout: false`.

Validation:

- Timeout must be positive.
- Non-decision outgoing edge should be `next`.

### `decide`

Backend fields:

- `decision_type`: `ai` or `function`
- `conditions`: array of `{ label, description }`
- AI mode: `provider_model_id` or `provider_model_name`, `llm_temperature`, `llm_max_tokens`, `llm_configuration`
- Function mode: `function_id`

Runtime:

- Returns an edge label.
- Engine resolves decision edges by `FlowCondition.label`.
- If AI/function returns an invalid label, it falls back to the first condition.

Public API:

```ts
workflow.addNode("classify", {
  type: "decide",
  decisionType: "ai",
  providerModel: "gpt-5-mini",
  conditions: [
    { label: "sales", description: "The user wants pricing or a demo" },
    { label: "support", description: "The user needs help with an existing account" },
  ],
});
```

Function decision:

```ts
workflow.addNode("classify", {
  type: "decide",
  decisionType: "function",
  functionSlug: "classify-message",
  conditions: [
    { label: "sales", description: "Sales path" },
    { label: "support", description: "Support path" },
  ],
});
```

Compile target:

- `functionSlug` -> `function_slug`; Cientos import resolves it to `function_id`.
- `providerModel` -> `provider_model_name`.
- Conditions should never include remote `id`.
- Edges out of this node must use labels matching condition labels.

Recommended source naming cleanup:

- Use `function_slug` in source definitions.
- The local CLI draft now uses `function_slug`; no `function_key` compatibility alias is needed.
- Cientos import should resolve `function_slug` to `function_id`.

### `function`

Backend fields:

- `function_id`
- `save_response_to`

Runtime:

- Invokes the function.
- Merges returned `vars` into execution vars.
- Saves the full response if `save_response_to` is configured.
- Ignores returned `next_edge` for branching today.
- Always advances on `next`.

Public API:

```ts
workflow.addNode("normalize", {
  type: "function",
  functionSlug: "normalize-phone",
  saveResponseTo: "normalized_phone",
});
```

Validation:

- Warn if the node has more than one outgoing edge.
- Warn if the outgoing edge label is not `next`.
- If a user wants branching, tell them to use `decide` with `decisionType: "function"`.

### `webhook`

Backend fields:

- `url`
- `method`
- `headers`
- `body_template`
- `save_response_to`
- `provider_model_id` or `provider_model_name`
- `ai_field_config`

Current export oddity:

- `WebhookAction#to_config` exports `headers` and `body_template` as JSON strings.
- The import job accepts both strings and hashes.

Public API:

```ts
workflow.addNode("lookupCustomer", {
  type: "webhook",
  url: "https://api.example.com/customer",
  method: "POST",
  headers: { Authorization: "Bearer {{vars.api_token}}" },
  bodyTemplate: { phone: "{{vars.phone}}" },
  saveResponseTo: "customer",
});
```

Compile target:

- Emit objects, not JSON strings, from the library.
- The CLI normalizer should canonicalize pulled string values and code-generated object values so diffs are not noisy.

### `pipedream`

Backend fields:

- `action_id`
- `app_slug`
- `account_id`
- `configured_props`
- `save_response_to`
- `provider_model_id` or `provider_model_name`
- `ai_field_config`
- `dynamic_props_id`

Public API:

```ts
workflow.addNode("createTicket", {
  type: "pipedream",
  actionId: "zendesk-create-ticket",
  appSlug: "zendesk",
  accountId: "acct_123",
  configuredProps: {
    subject: "{{vars.subject}}",
  },
  saveResponseTo: "ticket",
});
```

Portability:

- `actionId` and `appSlug` are reasonably portable.
- `accountId` is project/user-specific.
- V1 should support it as explicit raw configuration, but not pretend it is cross-project portable.

### `agent`

Backend fields:

- `system_prompt`
- `provider_model_id` or `provider_model_name`
- `temperature`
- `max_iterations`
- `max_tokens`
- `reasoning_effort`
- `observer_prompt_mode`
- `enabled_default_tools`
- `sandbox_enabled`
- `sandbox_network_mode`
- `sandbox_allowed_outbound_hosts`
- Nested tools:
  - `flow_agent_function_tools`
  - `flow_agent_app_integration_tools`
  - `flow_agent_webhooks`
  - `flow_agent_knowledge_bases`
  - `flow_agent_mcp_servers`
  - `flow_agent_resources`

Default agent tools currently include:

- `send_notification_to_user`
- `send_media`
- `get_execution_metadata`
- `get_whatsapp_context`
- `get_current_datetime`
- `save_variable`
- `get_variable`
- `ask_about_file`
- `complete_task`
- `handoff_to_human`
- `enter_waiting`

Public API:

```ts
workflow.addNode("agent", {
  type: "agent",
  systemPrompt: "Help the user with support requests.",
  providerModel: "gpt-5-mini",
  enabledDefaultTools: [
    "get_whatsapp_context",
    "get_execution_metadata",
    "complete_task",
    "handoff_to_human",
    "enter_waiting",
  ],
  functionTools: [
    {
      name: "lookup_order",
      description: "Lookup an order by id",
      functionSlug: "lookup-order",
      inputSchema: {
        type: "object",
        properties: { order_id: { type: "string" } },
        required: ["order_id"],
      },
    },
  ],
});
```

Compile target:

- `systemPrompt` -> `system_prompt`
- `providerModel` -> `provider_model_name`
- `enabledDefaultTools` -> `enabled_default_tools`
- `functionTools[].functionSlug` -> `flow_agent_function_tools[].function_slug`
- Cientos import resolves `function_slug` to `function_id`.

V1 recommendation:

- First-class support:
  - basic agent fields
  - default tools
  - function tools by function slug
  - webhooks
  - knowledge bases
  - MCP servers
  - GitHub repository resources without secrets
- Raw support:
  - app integration tools by `appIntegrationId`
  - Pipedream/account-backed references

Do not put secrets in workflow source.

### `call`

Backend fields:

- `workflow_id`
- `save_error_to`

Runtime:

- Starts a child workflow execution.
- Waits for it to finish.
- Prevents call cycles and max depth problems.
- On errors, stores error data in `save_error_to` or `subworkflow_error`.

Public API:

```ts
workflow.addNode("callSupportFlow", {
  type: "call",
  workflowSlug: "support-flow",
  saveErrorTo: "support_flow_error",
});
```

Compile target:

- `workflowSlug` -> `workflow_slug`; Cientos import resolves it to `workflow_id`.

Recommended source naming cleanup:

- Use `workflow_slug` in source definitions.
- The local CLI draft now uses `workflow_slug`; no `workflow_key` compatibility alias is needed.
- Cientos import should resolve `workflow_slug` to `workflow_id`.

### `handoff`

Backend fields:

- `reason`
- `context_data`

Runtime:

- Transitions execution to handoff.
- Does not advance to the next edge.

Public API:

```ts
workflow.addNode("human", {
  type: "handoff",
  reason: "needs_human",
  contextData: "High value customer",
});
```

Validation:

- Warn if the node has outgoing edges, because runtime does not use them.

### `set_variable`

Backend fields:

- `variable_name`
- `variable_value`
- `value_type`

Status:

- Backend import/export supports it.
- The current frontend `FlowNodeType` and node schema do not list it.

Recommendation:

- Include the type in internal compiler support because the backend supports it.
- Do not feature it heavily in docs until we decide whether it should be exposed in the UI.

Public API:

```ts
workflow.addNode("setPlan", {
  type: "set_variable",
  variableName: "plan",
  variableValue: "pro",
  valueType: "string",
});
```

## Trigger Matrix

Triggers are not part of `definition.json` today. The CLI stores them in `workflow.yaml`.

Recommended public API:

```ts
workflow.addTrigger({ type: "api_call" });

workflow.addTrigger({
  type: "inbound_message",
  phoneNumberId: "15551234567",
});

workflow.addTrigger({
  type: "whatsapp_event",
  event: "whatsapp.message.received",
  phoneNumberId: "15551234567",
});
```

Compile target in `workflow.yaml`:

```yaml
triggers:
  - triggerType: inbound_message
    phoneNumberId: "15551234567"
    active: true
```

Supported trigger types:

- `api_call`
- `inbound_message`
- `whatsapp_event`

Current Platform API already supports trigger replacement transactionally.

## Reference Strategy

The code library should never ask users to type remote UUIDs when a stable source ref exists.

Recommended public reference names:

- `functionSlug`
- `workflowSlug`
- `providerModel`
- `phoneNumberId`
- `templateId` for now
- `accountId` for now
- `appIntegrationId` for now

Recommended generated source fields:

- Emit `function_slug` and `workflow_slug` in generated source.
- Do not expose "key" terminology in public docs or the TypeScript API.
- The local CLI draft uses `function_slug` and `workflow_slug`; no backward compatibility alias is needed.
- Use `provider_model_name` for model refs.
- Use `phone_number_id` for WhatsApp number refs.

Current portability status:

| Reference | Current state | V1 recommendation |
| --- | --- | --- |
| Function node function | CLI draft maps ID to slug | Keep slug |
| Function decision function | CLI draft maps ID to slug | Keep slug |
| Agent function tool function | CLI draft maps ID to slug | Keep slug |
| Call workflow | CLI draft maps ID to slug | Keep slug |
| Provider model | Backend resolves `provider_model_name` | Use model name |
| Workflow triggers phone number | API supports `phone_number_id` | Use phone number id |
| Send WhatsApp action number | Backend expects `whatsapp_config_id` | Add `phone_number_id` support |
| WhatsApp template | Backend expects `template_id` | Keep raw until stable template refs exist |
| WhatsApp Flow interactive `flow_id` | Meta flow id | Keep raw |
| Pipedream account | Project/user account id | Keep raw |
| App integration tool | Project-specific app integration id | Keep raw until app integrations get slugs |
| Agent GitHub resource PAT | Secret | Never store in workflow source |

## Validation Rules

V1 validation should be light. It should catch obvious broken source, not enforce strong workflow design opinions.

Hard errors:

- Workflow slug is clean.
- Node IDs are unique.
- Node IDs are stable source identifiers, not display names.
- `start` exists.
- Edge source and target nodes exist.
- Decision node condition labels are unique.
- Decision outgoing edge labels must match condition labels.
- `wait_for_response.timeoutSeconds` must be positive.
- Agent `enabledDefaultTools` must be known tool names.
- Agent `reasoningEffort` must be one of `minimal`, `low`, `medium`, `high`.
- Webhook method must be `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- Interactive button/list limits should match the UI schema:
  - buttons: max 3, title max 20 chars
  - list sections: max 10 sections, max 10 total rows
  - row title max 24 chars
  - row description max 72 chars

Warnings only:

- Non-decision nodes with multiple outgoing edges.
- Non-decision outgoing edge labels other than `next`.
- `function` nodes with multiple outgoing edges, because function nodes currently do not branch on `next_edge`.
- `handoff` nodes with outgoing edges, because runtime transitions to handoff instead of advancing.

The compiler should throw structured errors:

```ts
type WorkflowCompileError = {
  code: string;
  message: string;
  path?: string;
};
```

## Compiler Output

`workflow.toSourceFiles()` should return:

```ts
{
  metadata: {
    slug: "inbound-support",
    name: "Inbound Support",
    status: "draft",
    definition: "definition.json",
    triggers: []
  },
  definition: {
    nodes: [],
    edges: []
  }
}
```

`workflow.toDefinition()` should return only the definition object:

```ts
{
  nodes: [
    {
      id: "start",
      type: "flow-node",
      position: { x: 0, y: 0 },
      data: {
        node_type: "start",
        config: {}
      }
    }
  ],
  edges: []
}
```

Output rules:

- Stable sort nodes by insertion order.
- Stable sort edges by insertion order.
- Do not include remote IDs.
- Do not include `display_name` unless needed by the API. The backend does not require it.
- Do include `type: "flow-node"` for compatibility with the canvas.
- Omit empty optional config fields.
- Canonical JSON formatting should match CLI `canonicalJson`.
- Source metadata should use `slug`; folder name should equal slug in V1.

## Cientos/API Changes Needed

Before this becomes a good public authoring experience:

1. Add slug refs for workflow definitions.
   - Source definitions use `function_slug` and `workflow_slug`.
   - Do not support `function_key` or `workflow_key`; this code has not shipped yet.
   - Cientos import resolves slugs to IDs before persistence so Platform API callers and the CLI use the same source shape.

2. Add `phone_number_id` support in workflow node configs.
   - `send_text`
   - `send_template`
   - `send_interactive`
   - Possibly future WhatsApp-specific nodes.

3. Export phone-number refs for WhatsApp action nodes.
   - Current `to_config` exports `whatsapp_config_id`.
   - Source export should prefer `phone_number_id` when possible.

4. Decide template reference strategy.
   - If templates have stable slugs, expose `templateSlug`.
   - If not, keep `templateId`.

5. Decide app integration reference strategy.
   - Current agent app integration tools use `app_integration_id`.
   - Keep raw in V1 unless app integrations get stable source slugs.

6. Fix or limit interactive product/catalog variants.
   - Frontend lists them.
   - Import job does not map their action config today.
   - Either add backend import support or do not expose them in the library.

7. Normalize webhook JSON export.
   - Avoid `headers` and `body_template` flipping between JSON strings and objects.
   - Source files should prefer objects.

8. Add Platform API tests for source refs.
   - Function slug refs.
   - Workflow slug refs.
   - Agent function tool slug refs.
   - WhatsApp phone number refs in action nodes.

## CLI Changes Needed

1. Add workflow code compilation to `kapso push`.
   - Detect `workflows/<slug>/workflow.ts`.
   - Load it with a deterministic TS loader.
   - Compile to source metadata and definition.
   - Write the compiled definition to `workflows/<slug>/definition.json`.
   - Feed the result into the existing push planner.

2. Add a focused build command.
   - `kapso workflows build` or `kapso build`
   - Recommended minimalist command: `kapso build`
   - It compiles workflow code and prints validation errors without pushing.

3. Keep `kapso pull` JSON-only in V1.
   - No remote JSON to TypeScript generation.
   - Later we can add a scaffold command if needed.

4. Update dirty-file behavior.
   - If workflow code is canonical, dirty protection should hash `workflow.ts`, not generated JSON.
   - When `workflow.ts` exists, `definition.json` is generated output and may be overwritten by `kapso push` or `kapso build`.

5. Preserve current dry-run semantics.
   - `kapso push --dry-run` should compile code, validate slug refs exist, and show the same plan without applying.

6. Remove "key" terminology from source files.
   - Source metadata should use `slug`.
   - Folder name equals slug in V1.

## Test Plan

Package tests:

- Creates a workflow with implicit start node.
- Adds nodes and edges in stable order.
- Emits current source definition shape.
- Emits `workflow.yaml` metadata with triggers.
- Rejects duplicate node IDs.
- Rejects edges pointing to missing nodes.
- Rejects decision edges with unknown condition labels.
- Defaults non-decision edge labels to `next`.
- Warns or rejects multiple outgoing edges from non-decision nodes.
- Compiles function refs to slug source refs.
- Compiles call workflow refs to slug source refs.
- Compiles agent function tool refs to slug source refs.
- Compiles provider model name refs.
- Compiles webhook body/header objects without stringifying them.
- Preserves raw nodes.

Cientos tests:

- Import accepts `function_slug` for function nodes.
- Import accepts `function_slug` for function decision nodes.
- Import accepts `function_slug` for agent function tools.
- Import accepts `workflow_slug` for call nodes.
- Import accepts `phone_number_id` for send text/template/interactive nodes.
- Export prefers slugs and phone number IDs in API source definition view.
- Interactive product/catalog variants either import correctly or are explicitly rejected.
- Webhook export/import round-trips objects without noisy string diffs.

CLI tests:

- `kapso push --dry-run` compiles `workflow.ts` and reports planned updates.
- `kapso push` uses code-authored definitions.
- `workflow.ts` wins when both code and `definition.json` exist, and push writes the compiled JSON before upload.
- Pull does not overwrite code-authored workflows unexpectedly.
- Dirty protection works when `workflow.ts` is canonical.
- Missing referenced function/workflow slug fails before applying.
- Push payloads use `function_slug` and `workflow_slug` refs for workflow definitions.

## Implementation Sequence

1. Create `kapso-workflows` package skeleton.
   - TypeScript build.
   - Test runner.
   - Export `Workflow`.

2. Implement graph core.
   - Constructor.
   - `addNode`.
   - `addEdge`.
   - `addTrigger`.
   - insertion-order storage.
   - implicit `start`.

3. Implement compiler.
   - CamelCase public fields to snake_case source definition.
   - Node matrix support.
   - Trigger metadata output.
   - Canonical JSON output.

4. Implement validation.
   - Graph shape.
   - Decision branch labels.
   - Basic field validation.
   - Warnings for runtime footguns.

5. Add tests for every supported node type.

6. Add Cientos source-ref improvements.
   - `function_slug` and `workflow_slug` refs.
   - WhatsApp action `phone_number_id`.
   - webhook config normalization.

7. Add CLI build integration.
   - Compile `workflow.ts` during push.
   - Add `kapso build`.
   - Keep pull JSON-only.

8. Update docs/examples.
   - One realistic inbound support workflow.
   - One agent workflow.
   - One API-triggered workflow.

## V1 Scope

Ship first:

- `Workflow` graph builder.
- Implicit start node.
- `api_call`, `inbound_message`, `whatsapp_event` triggers.
- First-class nodes:
  - `send_text`
  - `send_template`
  - `send_interactive` for button, list, CTA URL, WhatsApp Flow, location request
  - `wait_for_response`
  - `decide`
  - `function`
  - `webhook`
  - `pipedream`
  - `agent`
  - `call`
  - `handoff`
  - `set_variable`
- Raw node escape hatch.
- Function/workflow refs by slug.
- Provider model refs by name.
- Basic validation and canonical output.

Do not ship first:

- JSON to TypeScript generation.
- Local workflow runtime.
- Secrets/env var management.
- Multi-environment workflow overlays.
- Fancy fluent chain API.
- Decorators.
- JSX.
- Product/catalog interactive helpers unless backend import support is completed.

## Decisions Locked

1. Public source fields are `function_slug` and `workflow_slug`.

   Do not support `function_key` or `workflow_key`. No compatibility alias is needed because this source format has not shipped.

2. `definition.json` remains a supported source file.

   CLI-only users can use `workflow.yaml` plus `definition.json`. TS-library users can generate `definition.json` and decide whether to commit it or ignore it.

3. If both `workflow.ts` and `definition.json` exist, `workflow.ts` wins for push.

   `kapso push` compiles `workflow.ts`, writes `definition.json`, and uploads the compiled JSON. `kapso pull` writes JSON only and does not try to generate TypeScript.

4. The public node type for call workflow is `call`.

   Recommendation: use `call` because it matches the existing backend node type. Document it as "Call Workflow". Add `workflow.callWorkflow(...)` later only if users find `call` confusing.

5. `set_variable` is supported but not emphasized.

   Recommendation: support it in the library, mark it as backend-supported. Decide separately whether to expose it in the UI.

6. Raw project-specific IDs are allowed.

   Recommendation: yes, but make stable refs the happy path. Some resources are not portable yet.

## Bottom Line

The right first version is a plain graph builder that compiles to the existing Kapso source definition format. The hard part is not the TypeScript class. The hard part is reference hygiene: using slugs and phone number IDs instead of remote UUIDs wherever the platform can support it.

Keep the library boring and explicit. Let Kapso own execution. Let the CLI own push/pull, dirty checks, and remote concurrency.
