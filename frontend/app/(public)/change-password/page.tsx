"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector, useAppDispatch } from "@/lib/hooks";
import { selectUser, logoutUser } from "@/lib/features/auth/authSlice";
import { changePassword } from "@/lib/features/admin/adminAPI";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { PasswordRequirements, meetsAllRequirements } from "@/components/ui/password-requirements";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

const formSchema = z.object({
    oldPassword: z.string().min(1, { message: "Current password is required" }),
    newPassword: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" })
        .refine((p) => /[A-Z]/.test(p), { message: "Must contain an uppercase letter" })
        .refine((p) => /[a-z]/.test(p), { message: "Must contain a lowercase letter" })
        .refine((p) => /[0-9]/.test(p), { message: "Must contain a number" }),
    confirmPassword: z.string().min(1, { message: "Please confirm your new password" }),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

type FormValues = z.infer<typeof formSchema>;

export default function ChangePasswordPage() {
    const user = useAppSelector(selectUser);
    const router = useRouter();
    const dispatch = useAppDispatch();
    const [isMounted, setIsMounted] = useState(false);
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    useEffect(() => { setIsMounted(true); }, []);

    useEffect(() => {
        if (isMounted && !user) router.push("/login");
    }, [user, router, isMounted]);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: { oldPassword: "", newPassword: "", confirmPassword: "" },
    });

    const newPassword = form.watch("newPassword");
    const isLoading = form.formState.isSubmitting;

    if (!isMounted || !user) return null;

    async function onSubmit(values: FormValues) {
        try {
            await changePassword(values.oldPassword, values.newPassword);
            toast.success("Password updated. Please sign in again.");
            dispatch(logoutUser());
            router.push("/login");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to update password";
            toast.error(msg);
        }
    }

    return (
        <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center mesh-auth px-4 py-8">
            <Card className="w-full max-w-md">
                <CardHeader className="space-y-1 text-center">
                    <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
                        <ShieldCheck className="h-6 w-6 text-purple-600" />
                    </div>
                    <CardTitle className="text-2xl">Change Password</CardTitle>
                    <CardDescription>
                        {user.mustResetPassword
                            ? "Security update required before continuing"
                            : "Update your account password"}
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    {user.mustResetPassword && (
                        <div className="mb-6 rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium text-center">
                            You must change your password before continuing.
                        </div>
                    )}

                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        {/* Current Password */}
                        <Controller
                            control={form.control}
                            name="oldPassword"
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="oldPassword">Current Password</FieldLabel>
                                    <div className="relative">
                                        <Input
                                            {...field}
                                            id="oldPassword"
                                            type={showOld ? "text" : "password"}
                                            placeholder="Enter current password"
                                            disabled={isLoading}
                                            aria-invalid={fieldState.invalid}
                                            className="pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowOld(!showOld)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer"
                                            tabIndex={-1}
                                        >
                                            {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        {/* New Password */}
                        <Controller
                            control={form.control}
                            name="newPassword"
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="newPassword">New Password</FieldLabel>
                                    <div className="relative">
                                        <Input
                                            {...field}
                                            id="newPassword"
                                            type={showNew ? "text" : "password"}
                                            placeholder="Enter new password"
                                            disabled={isLoading}
                                            aria-invalid={fieldState.invalid}
                                            className="pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowNew(!showNew)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer"
                                            tabIndex={-1}
                                        >
                                            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                    <PasswordRequirements password={newPassword} />
                                </Field>
                            )}
                        />

                        {/* Confirm Password */}
                        <Controller
                            control={form.control}
                            name="confirmPassword"
                            render={({ field, fieldState }) => (
                                <Field data-invalid={fieldState.invalid}>
                                    <FieldLabel htmlFor="confirmPassword">Confirm New Password</FieldLabel>
                                    <div className="relative">
                                        <Input
                                            {...field}
                                            id="confirmPassword"
                                            type={showConfirm ? "text" : "password"}
                                            placeholder="Repeat new password"
                                            disabled={isLoading}
                                            aria-invalid={fieldState.invalid}
                                            className="pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirm(!showConfirm)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer"
                                            tabIndex={-1}
                                        >
                                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                </Field>
                            )}
                        />

                        <Button
                            type="submit"
                            className="w-full bg-linear-to-r from-gradient-purple to-gradient-blue hover:cursor-pointer"
                            disabled={isLoading || !meetsAllRequirements(newPassword)}
                        >
                            {isLoading ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>
                            ) : (
                                "Update Password"
                            )}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
