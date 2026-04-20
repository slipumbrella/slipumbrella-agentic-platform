import api from "@/lib/axios";
import type {
  Attachment,
  ListAttachmentsResponse,
  EmbeddingsResponse,
  EvaluationResponse,
  EvaluationSSEEvent,
} from "@/types/upload";

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function uploadFile(
  file: File,
  referenceId: string,
  pages?: number[],
  signal?: AbortSignal,
): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("reference_id", referenceId);
  if (pages && pages.length > 0) {
    formData.append("pages", JSON.stringify(pages));
  }

  // Content-Type for FormData is handled automatically by Axios/Browser
  const response = await api.post<Attachment>("/uploads/file", formData, {
    signal,
  });
  return response.data;
}

export async function uploadUrl(
  url: string,
  referenceId: string,
  crawlBFS?: boolean,
  maxPages?: number,
  signal?: AbortSignal,
): Promise<ListAttachmentsResponse> {
  const formData = new URLSearchParams();
  formData.append("url", url);
  formData.append("reference_id", referenceId);
  if (crawlBFS) {
    formData.append("crawl_bfs", "true");
  }
  if (maxPages && maxPages > 0) {
    formData.append("max_pages", String(maxPages));
  }

  const response = await api.post<ListAttachmentsResponse>("/uploads/url", formData, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal,
  });
  return response.data;
}

export async function listAttachments(
  referenceId: string,
): Promise<ListAttachmentsResponse> {
  const response = await api.get<ListAttachmentsResponse>("/uploads", {
    params: { reference_id: referenceId },
  });
  return response.data;
}

export async function deleteAttachment(id: string): Promise<void> {
  await api.delete(`/uploads/${id}`);
}

export async function deleteAttachmentsBatch(ids: string[]): Promise<void> {
  await api.post("/uploads/delete-batch", { ids });
}

export async function createEmbeddings(
  referenceId: string,
  attachmentIds?: string[],
): Promise<EmbeddingsResponse> {
  const body: Record<string, unknown> = { reference_id: referenceId };
  if (attachmentIds && attachmentIds.length > 0) {
    body.attachment_ids = attachmentIds;
  }
  const response = await api.post<EmbeddingsResponse>("/embeddings", body);
  return response.data;
}

export async function getEmbeddings(
  referenceId: string,
): Promise<EmbeddingsResponse> {
  const response = await api.get<EmbeddingsResponse>("/embeddings", {
    params: { reference_id: referenceId },
  });
  return response.data;
}

export async function triggerEvaluation(
  referenceId: string,
): Promise<EvaluationResponse> {
  const requestId = createRequestId();
  const response = await api.post<EvaluationResponse>("/evaluations", {
    reference_id: referenceId,
  }, {
    headers: {
      "X-Request-ID": requestId,
    },
  });
  return response.data;
}

export async function getEvaluation(
  referenceId: string,
): Promise<EvaluationResponse> {
  const requestId = createRequestId();
  const response = await api.get<EvaluationResponse>("/evaluations", {
    params: { reference_id: referenceId },
    headers: {
      "X-Request-ID": requestId,
    },
  });
  return response.data;
}

export async function getAttachmentContent(id: string): Promise<string> {
  const response = await api.get<{ content: string }>(`/uploads/${id}/content`);
  return response.data.content;
}

/**
 * Connect to SSE stream for real-time evaluation updates
 * Returns a cleanup function to close the connection
 * 
 * Note: Uses withCredentials for cookie-based auth
 */
export function connectEvaluationStream(
  referenceId: string,
  onEvent: (event: EvaluationSSEEvent) => void,
): () => void {
  const baseURL = api.defaults.baseURL || "http://localhost:8080";
  const requestId = createRequestId();
  
  // Use reference_id to look up the evaluation
  const url = `${baseURL}/evaluations/${referenceId}/stream?request_id=${encodeURIComponent(requestId)}`;
  
  const eventSource = new EventSource(url, {
    withCredentials: true,
  });
  
  eventSource.onmessage = (event) => {
    try {
      const data: EvaluationSSEEvent = JSON.parse(event.data);
      onEvent(data);
    } catch (err) {
      console.error("Failed to parse SSE event:", err);
    }
  };
  
  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      console.log("SSE connection closed");
    }
  };
  
  // Return cleanup function
  return () => {
    eventSource.close();
  };
}
