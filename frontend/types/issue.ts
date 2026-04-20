import { User } from "./auth";

export interface Issue {
    id: string;
    user_id: string;
    user?: User;
    type: "bug" | "feature" | "general";
    subject: string;
    description: string;
    status: "active" | "resolved";
    created_at: string;
    updated_at: string;
}

export interface CreateIssueRequest {
    type: string;
    subject: string;
    description: string;
}

export interface UpdateIssueStatusRequest {
    status: string;
}
