import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import { Issue, CreateIssueRequest } from "@/types/issue";
import { submitIssue, fetchIssues, updateIssueStatus } from "./issueAPI";

export interface IssueState {
    issues: Issue[];
    status: "idle" | "loading" | "succeeded" | "failed";
    error: string | null;
}

const initialState: IssueState = {
    issues: [],
    status: "idle",
    error: null,
};

export const createIssue = createAsyncThunk(
    "issue/create",
    async (data: CreateIssueRequest) => {
        return await submitIssue(data);
    }
);

export const getIssues = createAsyncThunk(
    "issue/getIssues",
    async () => {
        return await fetchIssues();
    }
);

export const resolveIssue = createAsyncThunk(
    "issue/resolve",
    async (id: string) => {
        await updateIssueStatus(id, "resolved");
        return id;
    }
);

export const reopenIssue = createAsyncThunk(
    "issue/reopen",
    async (id: string) => {
        await updateIssueStatus(id, "active");
        return id;
    }
);

const issueSlice = createSlice({
    name: "issue",
    initialState,
    reducers: {
        clearIssueError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            // Create Issue
            .addCase(createIssue.pending, (state) => {
                state.status = "loading";
            })
            .addCase(createIssue.fulfilled, (state) => {
                state.status = "succeeded";
                state.error = null;
            })
            .addCase(createIssue.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.error.message || "Failed to submit issue";
            })
            // Get Issues
            .addCase(getIssues.pending, (state) => {
                state.status = "loading";
            })
            .addCase(getIssues.fulfilled, (state, action: PayloadAction<Issue[]>) => {
                state.status = "succeeded";
                state.issues = action.payload;
            })
            .addCase(getIssues.rejected, (state, action) => {
                state.status = "failed";
                state.error = action.error.message || "Failed to fetch issues";
            })
            // Resolve Issue
            .addCase(resolveIssue.fulfilled, (state, action: PayloadAction<string>) => {
                const issue = state.issues.find(i => i.id === action.payload);
                if (issue) {
                    issue.status = "resolved";
                }
            })
            // Reopen Issue
            .addCase(reopenIssue.fulfilled, (state, action: PayloadAction<string>) => {
                const issue = state.issues.find(i => i.id === action.payload);
                if (issue) {
                    issue.status = "active";
                }
            });
    },
});

export const { clearIssueError } = issueSlice.actions;
export default issueSlice.reducer;
