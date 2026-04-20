import type { ExecutionSession } from "@/lib/features/chat/builderAPI";

import type { Team } from "./teamAPI";

export function getTeamIdForSession(
  session: Pick<ExecutionSession, "session_id" | "team_id">,
  teams: Team[],
): string | null {
  const matchingTeam = teams.find((team) =>
    (team.sessions ?? []).some(
      (teamSession) => teamSession.session_id === session.session_id,
    ),
  );

  return matchingTeam?.id ?? session.team_id ?? null;
}
