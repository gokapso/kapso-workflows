import { START } from './constants.js';
import { compileDefinition, compileTrigger } from './compiler.js';
import { canonicalJson } from './json.js';
import { validateWorkflow } from './validator.js';

import type { StoredEdge, StoredNode } from './internal-types.js';
import type {
  EdgeOptions,
  FlowDefinition,
  NodeOptions,
  SourceFiles,
  StartNodeOptions,
  Trigger,
  ValidationIssue,
  ValidationResult,
  WorkflowMetadata,
  WorkflowNode,
  WorkflowOptions,
  WorkflowStatus,
} from './types.js';

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
  readonly status: WorkflowStatus;

  #edges: StoredEdge[] = [];
  #nodes = new Map<string, StoredNode>();
  #triggers: Trigger[] = [];

  constructor(slug: string, options: WorkflowOptions = {}) {
    this.slug = slug;
    this.name = options.name ?? slug;
    this.status = options.status ?? 'draft';
  }

  addEdge(source: string, target: string, options: EdgeOptions = {}): this {
    this.#edges.push({
      label: options.label ?? 'next',
      source,
      target,
    });

    return this;
  }

  addNode(id: typeof START, options?: StartNodeOptions): this;
  addNode(id: string, node: WorkflowNode, options?: NodeOptions): this;
  addNode(id: string, nodeOrOptions?: StartNodeOptions | WorkflowNode, options: NodeOptions = {}): this {
    if (id === START) {
      if (isWorkflowNode(nodeOrOptions)) {
        throw new Error('Use workflow.addNode(START, options) for the start node.');
      }

      return this.addStartNode(nodeOrOptions ?? {});
    }

    if (this.#nodes.has(id)) {
      throw new Error(`Node "${id}" already exists.`);
    }

    if (!isWorkflowNode(nodeOrOptions)) {
      throw new Error(`Node "${id}" requires a node config with a type.`);
    }

    this.#nodes.set(id, {
      id,
      node: nodeOrOptions,
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
    return compileDefinition(this.#edges, this.#nodes.values());
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
    return validateWorkflow({
      edges: this.#edges,
      nodes: this.#nodes.values(),
      slug: this.slug,
      triggers: this.#triggers,
    });
  }

  private addStartNode(options: StartNodeOptions): this {
    if (this.#nodes.has(START)) {
      throw new Error(`Node "${START}" already exists.`);
    }

    this.#nodes.set(START, {
      id: START,
      node: { type: START },
      options,
    });

    return this;
  }

  #assertValid(): void {
    const result = this.validate();
    if (result.errors.length > 0) {
      throw new WorkflowValidationError(result.errors);
    }
  }
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}
