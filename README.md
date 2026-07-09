# @kapso/workflows

Small TypeScript library for authoring Kapso workflows as code.

It builds a graph, validates obvious mistakes, and compiles to the same source shape used by `kapso pull` and `kapso push`.

```ts
import { START, Workflow } from "@kapso/workflows";

const workflow = new Workflow("inbound-support", {
  name: "Inbound Support",
});

workflow.addTrigger({
  type: "inbound_message",
  phoneNumberId: "15551234567",
});

workflow.addNode(START, {
  position: { x: 100, y: 100 },
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
  ],
});

workflow.addNode("support", {
  type: "call",
  workflowSlug: "support-flow",
});

workflow.addEdge(START, "normalize");
workflow.addEdge("normalize", "classify");
workflow.addEdge("classify", "support", { label: "support" });

const { metadata, definition, definitionJson } = workflow.toSourceFiles();
```

Project Event triggers and `emit_event` nodes are first-class:

```ts
workflow.addTrigger({
  type: "project_event",
  triggerableAttributes: {
    event_name: "conversation.csat_scored",
    property_key: "score",
    operator: "gte",
    property_value: 4,
  },
});

workflow.addNode("recordScore", {
  type: "emit_event",
  eventName: "conversation.csat_scored",
  properties: {
    score: "{{vars.score}}",
    source: "workflow",
  },
});
```

## Commands

```sh
bun install
bun run build
bun test
```

## Scope

This package does not execute workflows locally. It only creates source definitions.
