"use client";
// Login / Logout button + username, shown in the site header. Uses the auth context.
import { useAuth } from "./AuthProvider";

export default function AuthButtons() {
  const { authenticated, username, login, logout } = useAuth();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {authenticated ? (
        <>
          <span data-testid="auth-username">{username}</span>
          <button data-testid="logout-button" onClick={() => logout()}>
            Logout
          </button>
        </>
      ) : (
        <button data-testid="login-button" onClick={() => login()}>
          Login
        </button>
      )}
    </span>
  );
}
