// Keycloak client for the controls app. Dev defaults are baked in so it works out of the box
// (next dev AND the docker build); override via NEXT_PUBLIC_KEYCLOAK_* for other environments.
import Keycloak from "keycloak-js";

// Exported so it's unit-testable without initializing Keycloak.
// `||` (not `??`) so an EMPTY string also falls back — a Docker `ENV X=""` bakes "" into the build,
// and "" should still use the dev default rather than break the client.
export const keycloakConfig = {
  url: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "http://localhost:8081",
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "aisc",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "controls",
};

const keycloak = new Keycloak(keycloakConfig);

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!initPromise) {
    initPromise = keycloak.init({
      onLoad: "login-required", // forced login; Keycloak SSO silently logs in if a realm session exists
      pkceMethod: "S256",
    });
  }
  return initPromise;
}

export default keycloak;
