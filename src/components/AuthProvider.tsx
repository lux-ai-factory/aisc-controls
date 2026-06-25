"use client";
// Initializes Keycloak on the client (login-required) and exposes auth state to the app.
// keycloak-js is browser-only, so this is a Client Component; it renders nothing until init
// resolves, which means the app stays hidden until the user is logged in.
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import keycloak, { initKeycloak } from "@/auth/keycloak";

type AuthState = {
  ready: boolean;
  authenticated: boolean;
  username?: string;
  roles: string[];
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    initKeycloak()
      .then((auth) => setAuthenticated(auth))
      .catch(() => setAuthenticated(false))
      .finally(() => setReady(true));

    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).catch(() => setAuthenticated(false));
    };
  }, []);

  const value: AuthState = {
    ready,
    authenticated,
    username: keycloak.tokenParsed?.preferred_username as string | undefined,
    roles: (keycloak.tokenParsed?.realm_access?.roles as string[]) ?? [],
    login: () => keycloak.login(),
    logout: () => keycloak.logout({ redirectUri: window.location.origin }),
  };

  if (!ready) return null; // hide the app until Keycloak init finishes (forced login)

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
