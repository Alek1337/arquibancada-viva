export interface AuthIdentity {
  readonly sessionId: string;
  readonly userId: string;
}

interface SessionIdentitySource {
  readonly session: { readonly id: string };
  readonly user: { readonly id: string };
}

export function toAuthIdentity(source: SessionIdentitySource): AuthIdentity {
  return {
    sessionId: source.session.id,
    userId: source.user.id,
  };
}
