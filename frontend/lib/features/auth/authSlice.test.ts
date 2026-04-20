import reducer, { login, logoutUser } from "./authSlice";

describe("authSlice cookie-only auth", () => {
  it("hydrates user state without storing a JWT from login responses", () => {
    const state = reducer(
      undefined,
      login.fulfilled(
        {
          user_id: "user-1",
          username: "alice",
          role: "admin",
          must_reset_password: false,
          is_active: true,
          last_login: null,
          deleted_at: null,
        } as never,
        "req-1",
        { email: "alice@example.com", password: "secret" },
      ),
    );

    expect(state.user).toMatchObject({
      id: "user-1",
      username: "alice",
      role: "admin",
    });
  });

  it("clears user state on logout completion", () => {
    const seeded = reducer(
      undefined,
      login.fulfilled(
        {
          user_id: "user-1",
          username: "alice",
          role: "admin",
          must_reset_password: false,
          is_active: true,
          last_login: null,
          deleted_at: null,
        } as never,
        "req-1",
        { email: "alice@example.com", password: "secret" },
      ),
    );

    const next = reducer(seeded, logoutUser.fulfilled(undefined, "req-2", undefined));

    expect(next.user).toBeNull();
  });
});
