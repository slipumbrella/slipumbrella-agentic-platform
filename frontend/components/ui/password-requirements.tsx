"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PasswordRule {
    label: string;
    test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
    { label: "At least 8 characters", test: (p) => p.length >= 8 },
    { label: "One uppercase letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
    { label: "One lowercase letter (a–z)", test: (p) => /[a-z]/.test(p) },
    { label: "One number (0–9)", test: (p) => /[0-9]/.test(p) },
];

export function meetsAllRequirements(password: string): boolean {
    return PASSWORD_RULES.every((r) => r.test(password));
}

interface PasswordRequirementsProps {
    password: string;
    className?: string;
}

export function PasswordRequirements({ password, className }: PasswordRequirementsProps) {
    if (!password) return null;

    return (
        <ul className={cn("mt-2 space-y-1", className)}>
            {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(password);
                return (
                    <li key={rule.label} className={cn(
                        "flex items-center gap-1.5 text-xs transition-colors duration-200",
                        passed ? "text-green-600" : "text-destructive"
                    )}>
                        {passed
                            ? <Check className="h-3 w-3 shrink-0" />
                            : <X className="h-3 w-3 shrink-0" />
                        }
                        {rule.label}
                    </li>
                );
            })}
        </ul>
    );
}
