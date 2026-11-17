import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router-dom";

import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordRecovery } from "@/lib/appwrite/api";
import { authErrorMessage } from "@/lib/authErrors";
import { ForgotPasswordValidation } from "@/lib/validation";

const ForgotPasswordForm = () => {
  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const form = useForm<z.infer<typeof ForgotPasswordValidation>>({
    resolver: zodResolver(ForgotPasswordValidation),
    defaultValues: { email: "" },
  });

  async function onSubmit({ email }: z.infer<typeof ForgotPasswordValidation>) {
    setSubmitError("");
    try {
      await requestPasswordRecovery(email);
      setSent(true);
    } catch (error) {
      setSubmitError(authErrorMessage(error, "recovery"));
    }
  }

  return (
    <Form {...form}>
      <h1 className="auth-title" id="auth-title">Reset your password</h1>
      <p className="auth-intro">Enter your email to receive a password reset link.</p>
      {sent ? (
        <div className="mt-6 space-y-4">
          <p role="status" className="text-sm text-light-2">
            If an account uses this email, a reset link will arrive shortly.
            Check your inbox and spam folder.
          </p>
          <Button
            type="button"
            className="shad-button_dark_4"
            onClick={() => setSent(false)}
          >
            Try another email
          </Button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="auth-label">Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" className="auth-input" {...field} />
                </FormControl>
                <FormMessage className="auth-error" />
              </FormItem>
            )}
          />
          {submitError && <p role="alert" className="auth-error text-sm">{submitError}</p>}
          <Button type="submit" className="auth-submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="auth-footer"><Link to="/sign-in">Back to log in</Link></p>
    </Form>
  );
};

export default ForgotPasswordForm;
