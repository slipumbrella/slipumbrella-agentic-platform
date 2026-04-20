import {
    ExecutionSession,
    fetchBuilderConfig,
    listExecutionSessions,
} from "@/lib/features/chat/builderAPI";
import type {
    Attachment,
    EmbeddingItem,
    EvaluationResponse,
} from "@/types/upload";
import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { Team } from "./teamAPI";
import * as teamAPI from "./teamAPI";
import * as uploadAPI from "./uploadAPI";

export type { ExecutionSession, Team };

export interface ExecutionAgent {
  id?: string;
  role: string;
  goal: string;
  tools?: string[];
  context?: Record<string, unknown>;
  order?: number;
  is_leader?: boolean;
}

// --- Async Thunks ---

export const uploadFileThunk = createAsyncThunk(
  "agent/uploadFile",
  async ({
    file,
    referenceId,
    pages,
  }: {
    file: File;
    referenceId: string;
    pages?: number[];
  }, thunkAPI) => {
    try {
      return await uploadAPI.uploadFile(file, referenceId, pages, thunkAPI.signal);
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } }; message?: string };
      const message = axiosError?.response?.data?.error || axiosError?.message || "Failed to upload file";
      return thunkAPI.rejectWithValue({ message });
    }
  },
);

export const uploadUrlThunk = createAsyncThunk(
  "agent/uploadUrl",
  async ({
    url,
    referenceId,
    crawlBFS,
    maxPages,
  }: {
    url: string;
    referenceId: string;
    crawlBFS?: boolean;
    maxPages?: number;
  }, thunkAPI) => {
    return await uploadAPI.uploadUrl(
      url,
      referenceId,
      crawlBFS,
      maxPages,
      thunkAPI.signal,
    );
  },
);

export const fetchAttachments = createAsyncThunk(
  "agent/fetchAttachments",
  async (referenceId: string) => {
    return await uploadAPI.listAttachments(referenceId);
  },
);

export const deleteAttachmentThunk = createAsyncThunk(
  "agent/deleteAttachment",
  async (id: string) => {
    await uploadAPI.deleteAttachment(id);
    return id;
  },
);

export const deleteAttachmentsBatchThunk = createAsyncThunk(
  "agent/deleteAttachmentsBatch",
  async (ids: string[]) => {
    await uploadAPI.deleteAttachmentsBatch(ids);
    return ids;
  },
);

export const embedAttachments = createAsyncThunk(
  "agent/embedAttachments",
  async ({
    referenceId,
    attachmentIds,
  }: {
    referenceId: string;
    attachmentIds?: string[];
  }) => {
    return await uploadAPI.createEmbeddings(referenceId, attachmentIds);
  },
);

export const fetchEmbeddings = createAsyncThunk(
  "agent/fetchEmbeddings",
  async (referenceId: string) => {
    return await uploadAPI.getEmbeddings(referenceId);
  },
);

export const triggerEvaluationThunk = createAsyncThunk(
  "agent/triggerEvaluation",
  async (referenceId: string) => {
    return await uploadAPI.triggerEvaluation(referenceId);
  },
);

export const fetchEvaluationThunk = createAsyncThunk(
  "agent/fetchEvaluation",
  async (
    {
      referenceId,
      requestedAtMs,
    }: {
      referenceId: string;
      requestedAtMs?: number;
    },
  ) => {
    const evaluation = await uploadAPI.getEvaluation(referenceId);
    return {
      ...evaluation,
      __requestedAtMs: requestedAtMs,
    } as EvaluationResponse & { __requestedAtMs?: number };
  },
);

export const fetchExecutionSessions = createAsyncThunk(
  "agent/fetchExecutionSessions",
  async () => {
    return await listExecutionSessions();
  },
);

// --- Team Thunks ---

export const fetchTeams = createAsyncThunk("agent/fetchTeams", async () => {
  return await teamAPI.listTeams();
});

export const createTeamThunk = createAsyncThunk(
  "agent/createTeam",
  async ({ name, description }: { name: string; description?: string }) => {
    return await teamAPI.createTeam(name, description);
  },
);

export const updateTeamThunk = createAsyncThunk(
  "agent/updateTeam",
  async ({
    id,
    name,
    description,
  }: {
    id: string;
    name: string;
    description?: string;
  }) => {
    return await teamAPI.updateTeam(id, name, description);
  },
);

export const deleteTeamThunk = createAsyncThunk(
  "agent/deleteTeam",
  async (id: string) => {
    await teamAPI.deleteTeam(id);
    return id;
  },
);

export const assignSessionThunk = createAsyncThunk(
  "agent/assignSession",
  async ({ teamId, sessionId }: { teamId: string; sessionId: string }) => {
    await teamAPI.assignSession(teamId, sessionId);
    return { teamId, sessionId };
  },
);

export const unassignSessionThunk = createAsyncThunk(
  "agent/unassignSession",
  async ({ teamId, sessionId }: { teamId: string; sessionId: string }) => {
    await teamAPI.unassignSession(teamId, sessionId);
    return { teamId, sessionId };
  },
);

export const fetchLineConfig = createAsyncThunk(
  "agent/fetchLineConfig",
  async (teamId: string) => {
    return await teamAPI.getLineConfig(teamId);
  },
);

export const fetchAgentConfig = createAsyncThunk(
  "agent/fetchConfig",
  async () => {
    return await fetchBuilderConfig();
  },
);

export const saveLineConfig = createAsyncThunk(
  "agent/saveLineConfig",
  async ({
    teamId,
    accessToken,
    channelSecret,
  }: {
    teamId: string;
    accessToken: string;
    channelSecret: string;
  }) => {
    await teamAPI.saveLineConfig(teamId, accessToken, channelSecret);
    return await teamAPI.getLineConfig(teamId);
  },
);

export const deleteLineConfig = createAsyncThunk(
  "agent/deleteLineConfig",
  async (teamId: string) => {
    await teamAPI.deleteLineConfig(teamId);
  },
);

// --- State ---

interface AttachmentState {
  items: Attachment[];
  selectedIds: string[];
  isLoading: boolean;
  isUploading: boolean;
  isCrawling: boolean;
  isEmbedding: boolean;
  syncingIds: string[];
  error: string | null;
  embeddings: EmbeddingItem[];
  isDeletingIds: string[];
}

interface EvaluationState {
  data: EvaluationResponse | null;
  isEvaluating: boolean;
  error: string | null;
  requestedAtMs: number | null;
}

interface LineConfigState {
  configured: boolean;
  tokenPreview: string;
  secretPreview: string;
  status: "idle" | "saving" | "saved" | "error";
}

interface AgentState {
  selectedSpecialists: string[];
  selectedTeamId: string | null;
  activeSessionId: string | null;
  teams: Team[];
  attachments: AttachmentState;
  evaluation: EvaluationState;
  executionSessions: ExecutionSession[];
  executionAgents: ExecutionAgent[];
  lineConfig: LineConfigState;
  createTeamError: string | null;
  googleSaEmail: string | null;
}

const initialState: AgentState = {
  selectedSpecialists: [],
  selectedTeamId: null,
  activeSessionId: null,
  attachments: {
    items: [],
    selectedIds: [],
    isLoading: false,
    isUploading: false,
    isCrawling: false,
    isEmbedding: false,
    syncingIds: [],
    error: null,
    embeddings: [],
    isDeletingIds: [],
  },
  evaluation: {
    data: null,
    isEvaluating: false,
    error: null,
    requestedAtMs: null,
  },
  executionSessions: [],
  executionAgents: [],
  teams: [],
  lineConfig: {
    configured: false,
    tokenPreview: "",
    secretPreview: "",
    status: "idle",
  },
  createTeamError: null,
  googleSaEmail: null,
};

const agentSlice = createSlice({
  name: "agent",
  initialState,
  reducers: {
    toggleSpecialist: (state, action: PayloadAction<string>) => {
      const specialistIdx = state.selectedSpecialists.indexOf(action.payload);
      if (specialistIdx !== -1) {
        state.selectedSpecialists.splice(specialistIdx, 1);
      } else {
        state.selectedSpecialists.push(action.payload);
      }
    },
    setSelectedTeam: (state, action: PayloadAction<string | null>) => {
      state.selectedTeamId = action.payload;
    },
    setActiveSessionId: (state, action: PayloadAction<string | null>) => {
      state.activeSessionId = action.payload;
    },
    toggleAttachmentSelection: (state, action: PayloadAction<string>) => {
      const idx = state.attachments.selectedIds.indexOf(action.payload);
      if (idx !== -1) {
        state.attachments.selectedIds.splice(idx, 1);
      } else {
        state.attachments.selectedIds.push(action.payload);
      }
    },
    selectAllAttachments: (state) => {
      const unembeddedIds = state.attachments.items
        .filter((a) => !a.is_embedded)
        .map((a) => a.id);
      state.attachments.selectedIds = unembeddedIds;
    },
    clearAttachmentSelection: (state) => {
      state.attachments.selectedIds = [];
    },
    setExecutionAgents: (state, action: PayloadAction<ExecutionAgent[]>) => {
      state.executionAgents = action.payload;
    },
    setExecutionSessions: (
      state,
      action: PayloadAction<ExecutionSession[]>,
    ) => {
      state.executionSessions = action.payload;
    },
    resetAgentState: (state) => {
      state.selectedSpecialists = [];
      state.selectedTeamId = null;
      state.activeSessionId = null;
      state.attachments = initialState.attachments;
      state.evaluation = initialState.evaluation;
    },
    setSpecialistSelection: (state, action: PayloadAction<string[]>) => {
      state.selectedSpecialists = action.payload;
    },
    clearSessionData: (state) => {
      state.attachments = initialState.attachments;
      state.evaluation = initialState.evaluation;
    },
  },
  extraReducers: (builder) => {
    builder
      // Upload file
      .addCase(uploadFileThunk.pending, (state) => {
        state.attachments.isUploading = true;
        state.attachments.error = null;
      })
      .addCase(uploadFileThunk.fulfilled, (state, action) => {
        state.attachments.isUploading = false;
        state.attachments.items.unshift(action.payload);
      })
      .addCase(uploadFileThunk.rejected, (state, action) => {
        state.attachments.isUploading = false;
        state.attachments.error = action.meta.aborted
          ? null
          : action.error.message || "Upload failed";
      })

      // Upload URL
      .addCase(uploadUrlThunk.pending, (state) => {
        state.attachments.isCrawling = true;
        state.attachments.error = null;
      })
      .addCase(uploadUrlThunk.fulfilled, (state, action) => {
        state.attachments.isCrawling = false;
        const newItems = action.payload.attachments || [];
        state.attachments.items.unshift(...newItems);
      })
      .addCase(uploadUrlThunk.rejected, (state, action) => {
        state.attachments.isCrawling = false;
        state.attachments.error = action.meta.aborted
          ? null
          : action.error.message || "URL scrape failed";
      })

      // Fetch attachments
      .addCase(fetchAttachments.pending, (state) => {
        state.attachments.isLoading = true;
        state.attachments.error = null;
      })
      .addCase(fetchAttachments.fulfilled, (state, action) => {
        state.attachments.isLoading = false;
        state.attachments.items = action.payload.attachments || [];
        state.attachments.selectedIds = [];
        
        // Clear syncingIds for items that are now embedded
        if (state.attachments.syncingIds.length > 0) {
          state.attachments.syncingIds = state.attachments.syncingIds.filter(id => {
            const att = state.attachments.items.find(a => a.id === id);
            return !att || !att.is_embedded;
          });
          
          if (state.attachments.syncingIds.length === 0) {
            state.attachments.isEmbedding = false;
          }
        }
      })
      .addCase(fetchAttachments.rejected, (state, action) => {
        state.attachments.isLoading = false;
        state.attachments.error =
          action.error.message || "Failed to load attachments";
      })

      // Delete attachment
      .addCase(deleteAttachmentThunk.pending, (state, action) => {
        state.attachments.isDeletingIds.push(action.meta.arg);
      })
      .addCase(deleteAttachmentThunk.fulfilled, (state, action) => {
        state.attachments.isDeletingIds = state.attachments.isDeletingIds.filter(
          (id) => id !== action.meta.arg,
        );
        state.attachments.items = state.attachments.items.filter(
          (a) => a.id !== action.payload,
        );
      })
      .addCase(deleteAttachmentThunk.rejected, (state, action) => {
        state.attachments.isDeletingIds = state.attachments.isDeletingIds.filter(
          (id) => id !== action.meta.arg,
        );
      })
      .addCase(deleteAttachmentsBatchThunk.pending, (state, action) => {
        state.attachments.isDeletingIds = [
          ...state.attachments.isDeletingIds,
          ...action.meta.arg,
        ];
      })
      .addCase(deleteAttachmentsBatchThunk.fulfilled, (state, action) => {
        const deletedIds = action.payload;
        state.attachments.isDeletingIds = state.attachments.isDeletingIds.filter(
          (id) => !deletedIds.includes(id),
        );
        state.attachments.items = state.attachments.items.filter(
          (a) => !deletedIds.includes(a.id),
        );
        state.attachments.selectedIds = state.attachments.selectedIds.filter(
          (id) => !deletedIds.includes(id),
        );
      })
      .addCase(deleteAttachmentsBatchThunk.rejected, (state, action) => {
        const attemptedIds = action.meta.arg;
        state.attachments.isDeletingIds = state.attachments.isDeletingIds.filter(
          (id) => !attemptedIds.includes(id),
        );
      })

      // Embed all
      .addCase(embedAttachments.pending, (state, action) => {
        state.attachments.isEmbedding = true;
        state.attachments.syncingIds =
          action.meta.arg.attachmentIds ||
          state.attachments.items
            .filter((a) => !a.is_embedded)
            .map((a) => a.id);
        state.attachments.error = null;
        // New embeddings imply a new evaluation cycle; discard stale scores immediately.
        state.evaluation.data = null;
        state.evaluation.error = null;
        state.evaluation.isEvaluating = true;
        state.evaluation.requestedAtMs = Date.now();
      })
      .addCase(embedAttachments.fulfilled, (state, action) => {
        // Keep syncingIds if background processing is active, they will be cleared via polling
        const isAsync = !!action.payload.message;
        if (!isAsync) {
          state.attachments.syncingIds = [];
          state.attachments.isEmbedding = false;
        } else {
          state.attachments.isEmbedding = true;
        }
        
        state.attachments.embeddings = action.payload.embeddings;
        for (const emb of action.payload.embeddings || []) {
          const att = state.attachments.items.find(
            (a) => a.id === emb.attachment_id,
          );
          if (att) att.is_embedded = true;
        }
        state.attachments.selectedIds = [];
      })
      .addCase(embedAttachments.rejected, (state, action) => {
        state.attachments.isEmbedding = false;
        state.attachments.syncingIds = [];
        state.attachments.error = action.error.message || "Embedding failed";
        state.evaluation.isEvaluating = false;
        state.evaluation.requestedAtMs = null;
      })

      // Fetch embeddings
      .addCase(fetchEmbeddings.fulfilled, (state, action) => {
        state.attachments.embeddings = action.payload.embeddings;
      })

      // Trigger evaluation
      .addCase(triggerEvaluationThunk.pending, (state) => {
        state.evaluation.isEvaluating = true;
        state.evaluation.error = null;
        state.evaluation.requestedAtMs = Date.now();
      })
      .addCase(triggerEvaluationThunk.fulfilled, (state, action) => {
        state.evaluation.data = action.payload;
        state.evaluation.requestedAtMs = null;
        const status = action.payload?.status?.toLowerCase();
        // If status is terminal, set isEvaluating to false. Otherwise, keep it true.
        if (status === "completed" || status === "failed") {
          state.evaluation.isEvaluating = false;
        } else {
          state.evaluation.isEvaluating = true;
        }
      })
      .addCase(triggerEvaluationThunk.rejected, (state, action) => {
        state.evaluation.isEvaluating = false;
        state.evaluation.error = action.error.message || "Evaluation failed";
        state.evaluation.requestedAtMs = null;
      })

      // Fetch evaluation (polling)
      .addCase(fetchEvaluationThunk.fulfilled, (state, action) => {
        const status = action.payload?.status?.toLowerCase();
        const createdAtMs = Date.parse(action.payload?.created_at ?? "");
        const requestStartedAtMs =
          action.payload?.__requestedAtMs ?? state.evaluation.requestedAtMs ?? null;
        const isTerminalStatus = status === "completed" || status === "failed";
        const isStaleTerminalResult =
          !!requestStartedAtMs &&
          isTerminalStatus &&
          Number.isFinite(createdAtMs) &&
          createdAtMs < requestStartedAtMs;

        // Ignore old terminal evaluations from a previous run while waiting for fresh output.
        if (isStaleTerminalResult) {
          state.evaluation.isEvaluating = true;
          return;
        }

        state.evaluation.data = action.payload;
        state.evaluation.requestedAtMs = null;
        if (!status) return;
        
        if (status === "completed" || status === "failed") {
          state.evaluation.isEvaluating = false;
        } else {
          // If status exists and is not terminal (pending, running, analyzing, etc.), we are evaluating
          state.evaluation.isEvaluating = true;
        }
      })
      .addCase(fetchEvaluationThunk.rejected, () => {
        // Polling failure is not critical — keep current state
      })

      // Fetch execution sessions
      .addCase(fetchExecutionSessions.fulfilled, (state, action) => {
        state.executionSessions = action.payload;
      })

      // Teams
      .addCase(fetchTeams.fulfilled, (state, action) => {
        state.teams = action.payload;
      })
      .addCase(createTeamThunk.fulfilled, (state, action) => {
        state.teams.push(action.payload);
      })
      .addCase(updateTeamThunk.fulfilled, (state, action) => {
        const idx = state.teams.findIndex((t) => t.id === action.payload.id);
        if (idx !== -1) {
          state.teams[idx] = {
            ...state.teams[idx],
            ...action.payload,
          };
        }
      })
      .addCase(deleteTeamThunk.fulfilled, (state, action) => {
        state.teams = state.teams.filter((t) => t.id !== action.payload);
        if (state.selectedTeamId === action.payload)
          state.selectedTeamId = null;
      })
      .addCase(assignSessionThunk.fulfilled, (state) => {
        // Re-fetch teams to get updated session lists
      })
      .addCase(assignSessionThunk.pending, (state) => {
        state.createTeamError = null;
      })
      .addCase(assignSessionThunk.rejected, (state, action) => {
        state.createTeamError = action.error.message ?? "Failed to assign session to team";
      })
      .addCase(unassignSessionThunk.fulfilled, (state) => {
        // Re-fetch teams to get updated session lists
      })

      // LINE config
      .addCase(fetchLineConfig.fulfilled, (state, action) => {
        state.lineConfig.configured = action.payload.configured;
        state.lineConfig.tokenPreview = action.payload.token_preview ?? "";
        state.lineConfig.secretPreview = action.payload.secret_preview ?? "";
        state.lineConfig.status = "idle";
      })
      .addCase(saveLineConfig.pending, (state) => {
        state.lineConfig.status = "saving";
      })
      .addCase(saveLineConfig.fulfilled, (state, action) => {
        state.lineConfig.configured = action.payload.configured;
        state.lineConfig.tokenPreview = action.payload.token_preview ?? "";
        state.lineConfig.secretPreview = action.payload.secret_preview ?? "";
        state.lineConfig.status = "saved";
      })
      .addCase(saveLineConfig.rejected, (state) => {
        state.lineConfig.status = "error";
      })
      .addCase(deleteLineConfig.fulfilled, (state) => {
        state.lineConfig = {
          configured: false,
          tokenPreview: "",
          secretPreview: "",
          status: "idle",
        };
      })
      .addCase(fetchAgentConfig.fulfilled, (state, action) => {
        state.googleSaEmail = action.payload.google_sa_email;
      });
  },
});

export const {
  toggleSpecialist,
  setSelectedTeam,
  toggleAttachmentSelection,
  selectAllAttachments,
  clearAttachmentSelection,
  setExecutionAgents,
  setExecutionSessions,
  resetAgentState,
  setSpecialistSelection,
  clearSessionData,
  setActiveSessionId,
} = agentSlice.actions;
export default agentSlice.reducer;
