"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppSelector } from "@/lib/hooks";
import { selectUser } from "@/lib/features/auth/authSlice";

export default function ForceResetGuard() {
    const user = useAppSelector(selectUser);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (user && user.mustResetPassword) {
            if (pathname !== "/change-password") {
                router.push("/change-password");
            }
        }
    }, [user, pathname, router]);

    return null;
}
