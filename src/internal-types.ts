import type { NodeOptions, WorkflowNode } from './types.js';

export type StoredNode = {
  id: string;
  node: WorkflowNode;
  options: NodeOptions;
};

export type StoredEdge = {
  label: string;
  source: string;
  target: string;
};
