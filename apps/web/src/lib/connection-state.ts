import {
  type MatchRealtimeEvent,
  type MatchSnapshot,
  type RealtimeCursor,
  reconcileRealtimeEvent,
  realtimeCursorFromSnapshot,
} from "@arquibancada-viva/contracts";

export type ConnectionPhase = "connecting" | "error" | "idle" | "offline" | "ready" | "reconciling";

export interface MatchConnectionState {
  readonly cursor: RealtimeCursor;
  readonly matchId?: string;
  readonly message?: string;
  readonly phase: ConnectionPhase;
  readonly projection: Readonly<Record<string, unknown>>;
}

export const initialMatchConnectionState: MatchConnectionState = {
  cursor: { latestSequence: 0, recentEventIds: [] },
  phase: "idle",
  projection: {},
};

export function beginConnection(matchId: string): MatchConnectionState {
  return {
    cursor: { latestSequence: 0, recentEventIds: [] },
    matchId,
    phase: "connecting",
    projection: {},
  };
}

export function beginReconciliation(state: MatchConnectionState): MatchConnectionState {
  return {
    ...state,
    message: "Buscando o estado autoritativo antes de liberar ações.",
    phase: "reconciling",
  };
}

export function acceptSnapshot(
  state: MatchConnectionState,
  snapshot: MatchSnapshot,
): MatchConnectionState {
  if (state.phase !== "reconciling") {
    return state;
  }
  if (state.matchId && state.matchId !== snapshot.matchId) {
    return failConnection(state, "A partida recebida não corresponde à solicitada.");
  }
  return {
    cursor: realtimeCursorFromSnapshot(snapshot),
    matchId: snapshot.matchId,
    message: "Snapshot autoritativo aplicado. Ações podem ser enviadas ao servidor.",
    phase: "ready",
    projection: snapshot.projection,
  };
}

export function acceptRealtimeEvent(
  state: MatchConnectionState,
  event: MatchRealtimeEvent,
): MatchConnectionState {
  if (state.phase !== "ready" || state.matchId !== event.matchId) {
    return state;
  }
  const decision = reconcileRealtimeEvent(state.cursor, event);
  if (decision.kind === "duplicate") {
    return state;
  }
  if (decision.kind === "gap") {
    return {
      ...state,
      message: "Uma lacuna foi detectada. As ações foram bloqueadas durante a reconciliação.",
      phase: "reconciling",
    };
  }
  return {
    ...state,
    cursor: decision.cursor,
    projection: { ...state.projection, ...event.payload },
  };
}

export function markOffline(state: MatchConnectionState): MatchConnectionState {
  return {
    ...state,
    message: "Sem conexão. Nenhuma ação competitiva será confirmada neste dispositivo.",
    phase: "offline",
  };
}

export function failConnection(
  state: MatchConnectionState,
  message = "Não foi possível sincronizar a partida.",
): MatchConnectionState {
  return { ...state, message, phase: "error" };
}

export function canSubmitCompetitiveCommand(state: MatchConnectionState): boolean {
  return state.phase === "ready";
}
