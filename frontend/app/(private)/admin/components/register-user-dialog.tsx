"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { createUser } from "@/lib/features/admin/adminAPI";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PasswordRequirements, meetsAllRequirements } from "@/components/ui/password-requirements";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, UserPlus } from "lucide-react";

const formSchema = z.object({
    username: z.string().min(1, { message: "Username is required" }),
    email: z.email({ message: "Invalid email address" }),
    password: z
        .string()
        .min(8, { message: "Password must be at least 8 characters" })
        .refine((p) => /[A-Z]/.test(p), { message: "Must contain an uppercase letter" })
        .refine((p) => /[a-z]/.test(p), { message: "Must contain a lowercase letter" })
        .refine((p) => /[0-9]/.test(p), { message: "Must contain a number" }),
    role: z.enum(["user", "admin"]),
    must_reset_password: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export function RegisterUserDialog() {
    const [open, setOpen] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
            email: "",
            password: "",
            role: "user",
            must_reset_password: true,
        },
    });

    const password = form.watch("password");
    const isLoading = form.formState.isSubmitting;

    const handleOpenChange = (val: boolean) => {
        setOpen(val);
        if (!val) {
            form.reset();
            setShowPassword(false);
        }
    };

    async function onSubmit(values: FormValues) {
        try {
            await createUser(values);
            toast.success("User created successfully");
            handleOpenChange(false);
            window.location.reload();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Failed to create user";
            toast.error(msg);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button className="bg-linear-to-r from-purple-600 to-blue-600 hover:opacity-90 shadow-md flex items-center gap-2 rounded-xl transition-all duration-300">
                    <UserPlus className="h-4 w-4" />
                    <span className="hidden sm:inline font-bold">Register New User</span>
                    <span className="sm:hidden font-bold">Add</span>
                </Button>
            </DialogTrigger>

            <DialogContent className="w-full max-w-[425px] glass-strong border-white/20 shadow-2xl rounded-2xl">
                <DialogHeader className="pb-4 border-b border-white/10">
                    <DialogTitle className="text-2xl font-bold bg-clip-text text-transparent bg-linear-to-r from-purple-600 to-blue-600">
                        Create Identity
                    </DialogTitle>
                    <DialogDescription className="text-gray-500 font-medium">
                        Initialize a new participant in the platform ecosystem.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
                    {/* Username */}
                    <Controller
                        control={form.control}
                        name="username"
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="username">Username</FieldLabel>
                                <Input
                                    {...field}
                                    id="username"
                                    autoComplete="username"
                                    disabled={isLoading}
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        )}
                    />

                    {/* Email */}
                    <Controller
                        control={form.control}
                        name="email"
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="reg-email">Email</FieldLabel>
                                <Input
                                    {...field}
                                    id="reg-email"
                                    type="email"
                                    autoComplete="email"
                                    disabled={isLoading}
                                    aria-invalid={fieldState.invalid}
                                />
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                            </Field>
                        )}
                    />

                    {/* Password */}
                    <Controller
                        control={form.control}
                        name="password"
                        render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor="reg-password">Password</FieldLabel>
                                <div className="relative">
                                    <Input
                                        {...field}
                                        id="reg-password"
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="new-password"
                                        disabled={isLoading}
                                        aria-invalid={fieldState.invalid}
                                        className="pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none cursor-pointer"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    </button>
                                </div>
                                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                                <PasswordRequirements password={password} />
                            </Field>
                        )}
                    />

                    {/* Role */}
                    <Controller
                        control={form.control}
                        name="role"
                        render={({ field }) => (
                            <Field>
                                <FieldLabel htmlFor="reg-role">Role</FieldLabel>
                                <Select value={field.value} onValueChange={field.onChange} disabled={isLoading}>
                                    <SelectTrigger id="reg-role">
                                        <SelectValue placeholder="Select a role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="user">User</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                        )}
                    />

                    {/* Must Reset Password */}
                    <Controller
                        control={form.control}
                        name="must_reset_password"
                        render={({ field }) => (
                            <div className="flex items-start gap-2">
                                <Checkbox
                                    id="mustResetPassword"
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                    disabled={isLoading}
                                    className="mt-0.5"
                                />
                                <Label htmlFor="mustResetPassword" className="text-sm leading-snug cursor-pointer">
                                    Require password reset on first login
                                </Label>
                            </div>
                        )}
                    />

                    <div className="flex pt-4">
                        <Button
                            type="submit"
                            disabled={isLoading || !meetsAllRequirements(password)}
                            className="w-full bg-linear-to-r from-purple-600 to-blue-600 hover:opacity-90 text-white font-bold h-11 rounded-xl shadow-lg transition-all duration-300"
                        >
                            {isLoading ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Initialing...</>
                            ) : (
                                "Confirm Registration"
                            )}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
