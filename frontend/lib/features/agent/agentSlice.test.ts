import reducer, { setSelectedTeam, updateTeamThunk } from "@/lib/features/agent/agentSlice";

describe("agentSlice team updates", () => {
  it("does not overwrite the active session when only the selected team changes", () => {
    const previousState = {
      selectedSpecialists: [],
      selectedTeamId: "team-1",
      activeSessionId: "session-2",
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
      },
      executionSessions: [],
      executionAgents: [],
      teams: [
        {
          id: "team-1",
          name: "Team One",
          description: null,
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
          sessions: [
            {
              session_id: "session-1",
              title: "First Session",
              type: "execution",
              created_at: "2026-04-05T00:00:00Z",
            },
          ],
        },
        {
          id: "team-2",
          name: "Team Two",
          description: null,
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
          sessions: [
            {
              session_id: "session-3",
              title: "Third Session",
              type: "execution",
              created_at: "2026-04-05T00:00:00Z",
            },
          ],
        },
      ],
      lineConfig: {
        configured: false,
        tokenPreview: "",
        secretPreview: "",
        status: "idle" as const,
      },
      createTeamError: null,
      googleSaEmail: null,
    };

    const nextState = reducer(previousState, setSelectedTeam("team-2"));

    expect(nextState.selectedTeamId).toBe("team-2");
    expect(nextState.activeSessionId).toBe("session-2");
  });

  it("preserves existing sessions when the update response only contains renamed fields", () => {
    const previousState = {
      selectedSpecialists: [],
      selectedTeamId: "team-1",
      activeSessionId: "session-1",
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
      },
      executionSessions: [],
      executionAgents: [],
      teams: [
        {
          id: "team-1",
          name: "Old Team",
          description: "Old description",
          created_at: "2026-04-05T00:00:00Z",
          updated_at: "2026-04-05T00:00:00Z",
          sessions: [
            {
              session_id: "session-1",
              title: "Sales Ops Session",
              type: "execution",
              created_at: "2026-04-05T00:00:00Z",
            },
          ],
        },
      ],
      lineConfig: {
        configured: false,
        tokenPreview: "",
        secretPreview: "",
        status: "idle" as const,
      },
      createTeamError: null,
      googleSaEmail: null,
    };

    const nextState = reducer(
      previousState,
      updateTeamThunk.fulfilled(
        {
          id: "team-1",
          name: "Renamed Team",
          description: "New description",
        } as never,
        "request-id",
        {
          id: "team-1",
          name: "Renamed Team",
          description: "New description",
        },
      ),
    );

    expect(nextState.teams).toHaveLength(1);
    expect(nextState.teams[0].name).toBe("Renamed Team");
    expect(nextState.teams[0].description).toBe("New description");
    expect(nextState.teams[0].sessions).toHaveLength(1);
    expect(nextState.teams[0].sessions[0].session_id).toBe("session-1");
  });
});
