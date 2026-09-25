"use client";

import {
  matchRealtimeEventSchema,
  uuidV7Schema,
  type MatchRealtimeEvent,
} from "@arquibancada-viva/contracts";
import {
  ActionButton,
  InlineNotice,
  StatusIndicator,
  type StatusTone,
} from "@arquibancada-viva/ui";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  acceptRealtimeEvent,
  acceptSnapshot,
  beginConnection,
  beginReconciliation,
  canSubmitCompetitiveCommand,
  failConnection,
  initialMatchConnectionState,
  markOffline,
  type MatchConnectionState,
} from "../lib/connection-state";
import { createMatchSocket, requestAuthoritativeSnapshot } from "../lib/match-socket";
import { createRestClient } from "../lib/rest-client";

const actions = [
  {
    description: "Cadência, presença e pressão sonora.",
    key: "battery",
    label: "Bateria",
    symbol: "B",
  },
  {
    description: "Coordenação visual em toda a arquibancada.",
    key: "mosaic",
    label: "Mosaico",
    symbol: "M",
  },
  {
    description: "Impacto luminoso no momento certo.",
    key: "fireworks",
    label: "Fogos",
    symbol: "F",
  },
  {
    description: "Cores em movimento nas arquibancadas.",
    key: "flag",
    label: "Bandeira",
    symbol: "A",
  },
] as const;

function endpoints() {
  const fallback = window.location.origin;
  return {
    api: process.env.NEXT_PUBLIC_API_URL || fallback,
    socket: process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || fallback,
  };
}

function connectionCopy(state: MatchConnectionState): {
  detail: string;
  label: string;
  tone: StatusTone;
} {
  switch (state.phase) {
    case "ready":
      return {
        detail: `Sequence ${state.cursor.latestSequence}`,
        label: "Placar sincronizado",
        tone: "online",
      };
    case "offline":
      return { detail: "Ações bloqueadas", label: "Sem conexão", tone: "offline" };
    case "connecting":
      return { detail: "Abrindo canal seguro", label: "Conectando", tone: "syncing" };
    case "reconciling":
      return { detail: "Ações bloqueadas", label: "Reconciliando placar", tone: "syncing" };
    case "error":
      return { detail: "Ações bloqueadas", label: "Sincronização falhou", tone: "offline" };
    default:
      return {
        detail: "Informe uma partida técnica",
        label: "Aguardando partida",
        tone: "neutral",
      };
  }
}

export function ConnectedArena() {
  const [state, setState] = useState<MatchConnectionState>(initialMatchConnectionState);
  const [matchInput, setMatchInput] = useState("");
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string; title: string }>();
  const stateRef = useRef(state);
  const socketRef = useRef<Socket | undefined>(undefined);
  const synchronizationRef = useRef<Promise<void> | undefined>(undefined);
  const synchronizationVersionRef = useRef(0);
  const attemptRef = useRef(0);

  const updateState = useCallback((next: MatchConnectionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const synchronize = useCallback(
    (socket: Socket, matchId: string): Promise<void> => {
      if (synchronizationRef.current) {
        return synchronizationRef.current;
      }
      const synchronizationVersion = ++synchronizationVersionRef.current;
      updateState(beginReconciliation({ ...stateRef.current, matchId }));
      let operation: Promise<void>;
      operation = requestAuthoritativeSnapshot(socket, matchId)
        .then((snapshot) => {
          if (synchronizationVersion !== synchronizationVersionRef.current) {
            return;
          }
          if (!navigator.onLine || !socket.connected) {
            updateState(
              navigator.onLine
                ? { ...stateRef.current, phase: "connecting" }
                : markOffline(stateRef.current),
            );
            return;
          }
          updateState(acceptSnapshot(stateRef.current, snapshot));
          setNotice(undefined);
        })
        .catch(() => {
          if (synchronizationVersion !== synchronizationVersionRef.current) {
            return;
          }
          updateState(failConnection(stateRef.current));
          setNotice({
            kind: "error",
            text: "Confira sua sessão e tente novamente. Nenhuma ação foi confirmada.",
            title: "Não foi possível sincronizar",
          });
        })
        .finally(() => {
          if (synchronizationRef.current === operation) {
            synchronizationRef.current = undefined;
          }
        });
      synchronizationRef.current = operation;
      return operation;
    },
    [updateState],
  );

  const connect = useCallback(
    async (matchId: string) => {
      const attempt = ++attemptRef.current;
      synchronizationVersionRef.current += 1;
      socketRef.current?.disconnect();
      socketRef.current = undefined;
      synchronizationRef.current = undefined;
      setNotice(undefined);

      if (!navigator.onLine) {
        updateState(markOffline(beginConnection(matchId)));
        return;
      }
      updateState(beginConnection(matchId));
      try {
        const urls = endpoints();
        await createRestClient(urls.api).getSession();
        if (attempt !== attemptRef.current) {
          return;
        }
        const socket = createMatchSocket(urls.socket);
        socketRef.current = socket;
        socket.on("connect", () => void synchronize(socket, matchId));
        socket.on("disconnect", () => {
          synchronizationVersionRef.current += 1;
          synchronizationRef.current = undefined;
          const current = stateRef.current;
          updateState(
            navigator.onLine
              ? {
                  ...current,
                  message: "Conexão interrompida. Aguardando reconciliação.",
                  phase: "connecting",
                }
              : markOffline(current),
          );
        });
        socket.on("connect_error", () => {
          synchronizationVersionRef.current += 1;
          synchronizationRef.current = undefined;
          updateState(failConnection(stateRef.current));
        });
        socket.on("match:event.v1", (payload: unknown) => {
          const parsed = matchRealtimeEventSchema.safeParse(payload);
          if (!parsed.success) {
            updateState(beginReconciliation(stateRef.current));
            void synchronize(socket, matchId);
            return;
          }
          const next = acceptRealtimeEvent(stateRef.current, parsed.data as MatchRealtimeEvent);
          updateState(next);
          if (next.phase === "reconciling") {
            void synchronize(socket, matchId);
          }
        });
        socket.connect();
      } catch {
        if (attempt !== attemptRef.current) {
          return;
        }
        updateState(failConnection(stateRef.current));
        setNotice({
          kind: "error",
          text: "Entre na sua conta antes de abrir uma partida. Nenhuma ação foi confirmada.",
          title: "Sessão necessária",
        });
      }
    },
    [synchronize, updateState],
  );

  useEffect(() => {
    if (!navigator.onLine) {
      updateState(markOffline(stateRef.current));
    }
    const onOffline = () => {
      synchronizationVersionRef.current += 1;
      synchronizationRef.current = undefined;
      updateState(markOffline(stateRef.current));
    };
    const onOnline = () => {
      const matchId = stateRef.current.matchId;
      if (matchId && socketRef.current) {
        updateState({ ...stateRef.current, phase: "connecting" });
        socketRef.current.connect();
      } else {
        updateState(initialMatchConnectionState);
      }
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      attemptRef.current += 1;
      synchronizationVersionRef.current += 1;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      socketRef.current?.disconnect();
    };
  }, [updateState]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = uuidV7Schema.safeParse(matchInput.trim());
    if (!parsed.success) {
      setNotice({
        kind: "error",
        text: "Use o identificador UUIDv7 fornecido para a partida técnica.",
        title: "Partida inválida",
      });
      return;
    }
    void connect(parsed.data);
  }

  function explainTechnicalAction(label: string) {
    setNotice({
      kind: "info",
      text: `${label} está pronta para integração, mas este shell não fabrica confirmação local. A aceitação virá da API autoritativa.`,
      title: "Comando não enviado",
    });
  }

  const presentation = connectionCopy(state);
  const actionsEnabled = canSubmitCompetitiveCommand(state);

  return (
    <section className="arena" id="arena" aria-labelledby="arena-title" tabIndex={-1}>
      <div className="arena__topline">
        <div>
          <p className="section-kicker">Central da partida</p>
          <h2 id="arena-title">Arquibancada conectada</h2>
        </div>
        <StatusIndicator {...presentation} />
      </div>

      <form className="match-form" onSubmit={submit}>
        <label htmlFor="match-id">ID da partida técnica</label>
        <div className="match-form__controls">
          <input
            id="match-id"
            name="match-id"
            value={matchInput}
            onChange={(event) => setMatchInput(event.target.value)}
            placeholder="00000000-0000-7000-8000-000000000000"
            autoComplete="off"
            spellCheck="false"
          />
          <button className="primary-button" type="submit">
            Sincronizar
          </button>
        </div>
        <p>
          O placar só libera comandos depois de substituir o estado local por um snapshot válido.
        </p>
      </form>

      {notice ? (
        <InlineNotice kind={notice.kind} title={notice.title}>
          {notice.text}
        </InlineNotice>
      ) : null}

      <fieldset className="scoreboard">
        <legend className="sr-only">Placar técnico por ação</legend>
        {actions.map((action) => (
          <article className="scoreboard__item" key={action.key}>
            <span className="scoreboard__label">{action.label}</span>
            <strong className="scoreboard__value">
              {String(state.projection[action.key] ?? "—")}
            </strong>
          </article>
        ))}
      </fieldset>

      <fieldset className="action-grid">
        <legend className="sr-only">Ações da arquibancada</legend>
        {actions.map((action) => (
          <ActionButton
            key={action.key}
            description={action.description}
            disabled={!actionsEnabled}
            label={action.label}
            symbol={action.symbol}
            onClick={() => explainTechnicalAction(action.label)}
          />
        ))}
      </fieldset>
      <p className="safety-note">
        <span className="safety-note__symbol" aria-hidden="true">
          ◇
        </span>{" "}
        Sem conexão, reconciliação ou sessão válida: comandos permanecem bloqueados.
      </p>
    </section>
  );
}
