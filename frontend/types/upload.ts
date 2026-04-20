export interface Attachment {
  id: string;
  reference_id: string;
  file_name: string;
  file_size: number;
  bucket: string;
  file_key: string;
  original_file_name: string;
  meta: Record<string, unknown>;
  is_embedded: boolean;
  embedding_status: "pending" | "syncing" | "embedded";
  created_at: string;
  updated_at: string;
}

export interface ListAttachmentsResponse {
  attachments: Attachment[];
}

export interface EmbeddingItem {
  id: string;
  attachment_id: string;
  file_key: string;
  token_count: number;
  model: string;
  is_embedded: boolean;
}

export interface EmbeddingsResponse {
  reference_id: string;
  total: number;
  embeddings: EmbeddingItem[];
  message?: string;
}

export interface EvaluationResponse {
  id: string;
  reference_id: string;
  overall_score: number;
  metrics: import("@/components/agent-builder/data-quality-gauge").MetricResult[];
  status: "pending" | "running" | "completed" | "failed";
  error_message?: string;
  test_cases_count: number;
  created_at: string;
}

// SSE types for evaluation streaming
export interface EvaluationSSEEvent {
  type: "connected" | "evaluation_started" | "status_update" | "completed" | "failed" | "error";
  data: EvaluationStatusData;
  time: string;
}

export interface EvaluationStatusData {
  id: string;
  reference_id: string;
  status: "pending" | "running" | "completed" | "failed";
  overall_score: number;
  error_message?: string;
  test_cases_count: number;
  updated_at: string;
}
