import React from "react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { UserNav } from "@/components/nav/user-nav";

const mockPush = vi.fn();
const mockDispatch = vi.fn();
let mockUser: { username?: string } | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: { auth: { user: typeof mockUser } }) => unknown) =>
    selector({ auth: { user: mockUser } }),
}));

vi.mock("@/lib/features/auth/authSlice", () => ({
  logoutUser: () => ({ type: "auth/logoutUser" }),
}));

vi.mock("./support-dialog", () => ({
  SupportDialog: () => <button type="button">Support</button>,
}));

describe("UserNav", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockDispatch.mockClear();
    mockUser = { username: "alice" };
  });

  it("renders the fallback avatar without fetching a remote image", () => {
    render(<UserNav />);

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
  });
});
