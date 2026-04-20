import { describe, expect, it } from "vitest";

import type { ExecutionSession } from "@/lib/features/chat/builderAPI";

import { getTeamIdForSession } from "./teamSessionUtils";

describe("getTeamIdForSession", () => {
  it("prefers the team membership list over a stale session.team_id", () => {
    const session = {
      session_id: "session-1",
      team_id: "stale-team",
      planning_session_id: null,
      created_at: "2026-04-04T00:00:00Z",
    } satisfies ExecutionSession;

    const teamId = getTeamIdForSession(session, [
      {
        id: "real-team",
        name: "Real Team",
        sessions: [
          {
            session_id: "session-1",
            title: "Agent Session",
            type: "execution",
            created_at: "2026-04-04T00:00:00Z",
          },
        ],
        created_at: "2026-04-04T00:00:00Z",
        updated_at: "2026-04-04T00:00:00Z",
      },
    ]);

    expect(teamId).toBe("real-team");
  });

  it("falls back to session.team_id when the membership list has no match", () => {
    const session = {
      session_id: "session-2",
      team_id: "inline-team",
      planning_session_id: null,
      created_at: "2026-04-04T00:00:00Z",
    } satisfies ExecutionSession;

    const teamId = getTeamIdForSession(session, []);

    expect(teamId).toBe("inline-team");
  });

  it("returns null when the session is unassigned in both sources", () => {
    const session = {
      session_id: "session-3",
      planning_session_id: null,
      created_at: "2026-04-04T00:00:00Z",
    } satisfies ExecutionSession;

    const teamId = getTeamIdForSession(session, []);

    expect(teamId).toBeNull();
  });
});
