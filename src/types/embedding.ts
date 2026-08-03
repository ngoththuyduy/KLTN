export interface KnowledgeChunk {
  id: string;
  sourceFile: string;
  text: string;
  embedding: number[];
  createdAt: any;
}
