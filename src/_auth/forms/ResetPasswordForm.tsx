import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useSearchParams } from "react-router-dom";

import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmPasswordRecovery } from "@/lib/appwrite/api";
import { authErrorMessage } from "@/lib/authErrors";
import { ResetPasswordValidation } from "@/lib/validation";

const ResetPasswordForm = () => {
  const [params, setParams] = useSearchParams();
  const [complete, setComplete] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const userId = params.get("userId");
  const secret = params.get("secret");
  const form = useForm<z.infer<typeof ResetPasswordValidation>>({
    resolver: zodResolver(ResetPasswordValidation),
    defaultValues: { password: "", passwordAgain: "" },
  });

  async function onSubmit(values: z.infer<typeof ResetPasswordValidation>) {
    if (!userId || !secret) return;
    setSubmitError("");
    try {
      await confirmPasswordRecovery(userId, secret, values.password, values.passwordAgain);
      form.reset();
      setComplete(true);
      setParams({}, { replace: true });
    } catch (error) {
      setSubmitError(authErrorMessage(error, "reset"));
    }
  }

  if (complete) {
    return (
      <>
        <h1 className="auth-title" id="auth-title">Password updated</h1>
        <p role="status" className="auth-intro">You can now log in with your new password.</p>
        <p className="auth-footer"><Link to="/sign-in">Log in</Link></p>
      </>
    );
  }

  if (!userId || !secret) {
    return (
      <>
        <h1 className="auth-title" id="auth-title">Reset link unavailable</h1>
        <p role="alert" className="auth-intro">Open the full link from your reset email or request a new one.</p>
        <p className="auth-footer"><Link to="/forgot-password">Request a reset link</Link></p>
      </>
    );
  }

  return (
    <Form {...form}>
      <h1 className="auth-title" id="auth-title">Choose a new password</h1>
      <p className="auth-intro">Use at least 8 characters.</p>
      <form className="auth-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" className="auth-input" {...field} />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="passwordAgain"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" className="auth-input" {...field} />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />
        {submitError && <p role="alert" className="auth-error text-sm">{submitError}</p>}
        <Button type="submit" className="auth-submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Updating..." : "Update password"}
        </Button>
      </form>
      <p className="auth-footer"><Link to="/forgot-password">Request a new reset link</Link></p>
    </Form>
  );
};

export default ResetPasswordForm;
