// UNIT test: the controls Keycloak client uses the right baked dev defaults.
import { describe, it, expect } from "vitest";
import { keycloakConfig } from "@/auth/keycloak";

describe("controls keycloak config", () => {
  it("defaults to the aisc realm, controls client, and dev keycloak url", () => {
    expect(keycloakConfig.realm).toBe("aisc");
    expect(keycloakConfig.clientId).toBe("controls");
    expect(keycloakConfig.url).toBe("http://localhost:8081");
  });
});
