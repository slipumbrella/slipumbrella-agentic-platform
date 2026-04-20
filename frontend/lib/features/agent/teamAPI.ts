import api from "@/lib/axios";

export interface Team {
  id: string;
  name: string;
  description?: string;
  sessions: ExecutionSessionSummary[];
  created_at: string;
  updated_at: string;
}

export interface ExecutionSessionSummary {
  session_id: string;
  title: string;
  type: string;
  planning_session_id?: string;
  team_id?: string;
  created_at: string;
  plans?: {
    id: number;
    agents: { id: string; role: string; goal: string }[];
  }[];
}

export async function createTeam(
  name: string,
  description?: string,
): Promise<Team> {
  const response = await api.post<Team>("/teams", { name, description });
  return response.data;
}

export async function listTeams(): Promise<Team[]> {
  const response = await api.get<{ teams: Team[] }>("/teams");
  return response.data.teams ?? [];
}

export async function getTeam(id: string): Promise<Team> {
  const response = await api.get<Team>(`/teams/${id}`);
  return response.data;
}

export async function updateTeam(
  id: string,
  name: string,
  description?: string,
): Promise<Team> {
  const response = await api.put<Team>(`/teams/${id}`, { name, description });
  return response.data;
}

export async function deleteTeam(id: string): Promise<void> {
  await api.delete(`/teams/${id}`);
}

export async function assignSession(
  teamId: string,
  sessionId: string,
): Promise<void> {
  await api.post(`/teams/${teamId}/sessions`, { session_id: sessionId });
}

export async function unassignSession(
  teamId: string,
  sessionId: string,
): Promise<void> {
  await api.delete(`/teams/${teamId}/sessions/${sessionId}`);
}

export interface LineConfig {
  configured: boolean;
  token_preview?: string;
  secret_preview?: string;
}

export async function getLineConfig(teamId: string): Promise<LineConfig> {
  const response = await api.get<LineConfig>(`/teams/${teamId}/line`);
  return response.data;
}

export async function saveLineConfig(
  teamId: string,
  accessToken: string,
  channelSecret: string,
): Promise<void> {
  await api.put(`/teams/${teamId}/line`, {
    access_token: accessToken,
    channel_secret: channelSecret,
  });
}

export async function deleteLineConfig(teamId: string): Promise<void> {
  await api.delete(`/teams/${teamId}/line`);
}
