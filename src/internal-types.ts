import type { NodeOptions, StartNode, WorkflowNode } from './types.js';

export type StoredNode = {
  id: string;
  node: StartNode | WorkflowNode;
  options: NodeOptions;
};

export type StoredEdge = {
  label: string;
  source: string;
  target: string;
};
