# @kapso/workflows

Small TypeScript library for authoring Kapso workflows as code.

It builds a graph, validates obvious mistakes, and compiles to the same source shape used by `kapso pull` and `kapso push`.

```ts
import { Workflow } from "@kapso/workflows";

const workflow = new Workflow("inbound-support", {
  name: "Inbound Support",
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
  ],
});

workflow.addNode("support", {
  type: "call",
  workflowSlug: "support-flow",
});

workflow.addEdge("start", "normalize");
workflow.addEdge("normalize", "classify");
workflow.addEdge("classify", "support", { label: "support" });

const { metadata, definition, definitionJson } = workflow.toSourceFiles();
```

## Commands

```sh
bun install
bun run build
bun test
```

## Scope

This package does not execute workflows locally. It only creates source definitions.
