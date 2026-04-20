import axios from "axios";
import api from "@/lib/axios";
import { Issue, CreateIssueRequest, UpdateIssueStatusRequest } from "@/types/issue";

export const submitIssue = async (data: CreateIssueRequest): Promise<Issue> => {
    try {
        const response = await api.post<Issue>("/issues", data);
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            throw new Error((error.response.data as { error: string }).error || "Failed to submit issue");
        }
        throw new Error("Network Error: Unable to reach the server");
    }
};

export const fetchIssues = async (): Promise<Issue[]> => {
    try {
        const response = await api.get<Issue[]>("/issues/admin");
        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            throw new Error((error.response.data as { error: string }).error || "Failed to fetch issues");
        }
        throw new Error("Network Error: Unable to reach the server");
    }
};

export const updateIssueStatus = async (id: string, status: string): Promise<void> => {
    try {
        await api.patch(`/issues/admin/${id}/status`, { status });
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            throw new Error((error.response.data as { error: string }).error || "Failed to update status");
        }
        throw new Error("Network Error: Unable to reach the server");
    }
};
