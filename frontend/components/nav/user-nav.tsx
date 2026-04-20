"use client";


import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { logoutUser } from "@/lib/features/auth/authSlice";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SupportDialog } from "./support-dialog";


export function UserNav() {
  const router = useRouter();
  const dispatch = useAppDispatch();

  const user = useAppSelector((state) => state.auth.user);

  const handleLogout = () => {
    dispatch(logoutUser()); // clears backend HttpOnly cookie + Redux state
    router.push("/login");
  };

  if (!user) {
    return (
      <Button asChild variant="default" size="sm" className="bg-linear-to-r from-gradient-purple to-gradient-blue">
        <Link href="/login">Sign In</Link>
      </Button>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full relative h-8 w-8 ring-1 ring-purple-200/50 hover:ring-purple-300/60 transition-all cursor-pointer">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-gradient-to-br from-purple-100 to-blue-100 text-purple-700 text-xs font-bold">
                {user?.username ? user.username.charAt(0).toUpperCase() : "U"}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium leading-none">{"My Account"}</p>
              <p className="text-xs leading-none text-muted-foreground">{user?.username || "User"}</p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="p-0">
            <SupportDialog />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-600 cursor-pointer focus:bg-red-50 focus:text-red-600"
            onClick={handleLogout}
          >
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>


    </>
  );
}
