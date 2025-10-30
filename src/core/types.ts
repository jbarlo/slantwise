// --- Type Definitions for Embedding ---
export interface EmbeddingInputData {
  contentHash: string;
  content: string;
}

export interface EmbeddingOutput {
  embedding: string; // JSON stringified embedding vector
  usage: {
    promptTokens: number;
  };
  modelName: string;
}

export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
