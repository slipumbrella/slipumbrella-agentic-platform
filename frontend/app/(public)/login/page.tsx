"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useAppDispatch, useAppSelector } from "@/lib/hooks";
import { login } from "@/lib/features/auth/authSlice";
import Link from "next/link";
import React, { useEffect, Suspense } from "react";

// 1. React Hook Form & Zod
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

// 2. UI Components
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Field, FieldLabel, FieldError } from "@/components/ui/field";
import { BorderBeam } from "@/components/ui/border-beam";

const formSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters" }),
});

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const [showPassword, setShowPassword] = React.useState(false);

  const isLoading = useAppSelector((state) => state.auth.status === "loading");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "unauthorized") {
      toast.warning("Unauthorized!", {
        description: "Please login first!",
      });
      // Optional: Clear the param
      router.replace("/login");
    }
  }, [searchParams, router]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const result = await dispatch(login(values));

      if (login.fulfilled.match(result)) {
        toast.success("Welcome back!", {
          description: "Redirecting you to the dashboard...",
        });
        // Full page navigation ensures the cookie is sent with the request
        // (router.push does a soft nav where middleware may not see the freshly-set cookie)
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 500);
      } else {
        toast.error("Login Failed", {
          description: result.error.message || "Invalid credentials",
        });
      }
    } catch (error) {
      toast.error("Network Error");
      console.error("Login error:", error);
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center mesh-auth px-4 relative overflow-hidden">
      {/* Animated orbs (soft pastel) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/3 left-1/4 w-[300px] h-[300px] rounded-full bg-purple-300/30 blur-[120px]"
          style={{ animation: "orbFloat 10s ease-in-out infinite" }}
        />
        <div
          className="absolute bottom-1/3 right-1/4 w-[250px] h-[250px] rounded-full bg-blue-300/25 blur-[120px]"
          style={{ animation: "orbFloat 12s ease-in-out infinite 3s" }}
        />
      </div>
      <Card className="w-full max-w-md glass-strong rounded-2xl relative z-10">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold text-gray-900">Sign in</CardTitle>
          <CardDescription>
            Enter your email to access Slipumbrella platforms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* EMAIL FIELD */}
            <Controller
              control={form.control}
              name="email"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-gray-700">Email</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    disabled={isLoading}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {/* PASSWORD FIELD */}
            <Controller
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name} className="text-gray-700">Password</FieldLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      id={field.name}
                      type={showPassword ? "text" : "password"}
                      disabled={isLoading}
                      aria-invalid={fieldState.invalid}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Button type="submit" className="w-full bg-linear-to-r from-gradient-purple to-gradient-blue hover:cursor-pointer shadow-[0_4px_20px_rgba(139,92,246,0.35)]" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
          <CardFooter className="mt-2 justify-center">
            <p className="text-sm text-gray-500 text-center">
              Don&apos;t have an account? <br /> Please contact the{" "}
              <Link
                href="mailto:ryw.jakkraphat@gmail.com"
                className="inline-block text-gray-400 transition-all duration-300 hover:scale-110 hover:text-gray-700 hover:underline"
              >
                administrator
              </Link>
              .
            </p>
          </CardFooter>
        </CardContent>
        <BorderBeam
          duration={6}
          size={400}
          className="from-transparent via-purple-500 to-transparent"
        />
        <BorderBeam
          duration={6}
          delay={3}
          size={400}
          borderWidth={2}
          className="from-transparent via-blue-500 to-transparent"
        />
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
