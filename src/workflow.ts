import { compileDefinition, compileTrigger } from './compiler.js';
import { canonicalJson } from './json.js';
import { validateWorkflow } from './validator.js';

import type { StoredEdge, StoredNode } from './internal-types.js';
import type {
  EdgeOptions,
  FlowDefinition,
  NodeOptions,
  Position,
  SourceFiles,
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
    return compileDefinition(this.#edges, this.#nodes.values(), this.startPosition);
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

  #assertValid(): void {
    const result = this.validate();
    if (result.errors.length > 0) {
      throw new WorkflowValidationError(result.errors);
    }
  }
}
