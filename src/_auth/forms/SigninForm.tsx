import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Loader from "@/components/shared/Loader";

import { SigninValidation } from "@/lib/validation";
import { useSignInAccount } from "@/lib/react-query/queriesAndMutations";
import { useUserContext } from "@/context/AuthContext";
import { authErrorMessage } from "@/lib/authErrors";
import { postLoginDestination } from "@/lib/postLoginDestination";

const SigninForm = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { checkAuthUser } = useUserContext();
  const [submitError, setSubmitError] = useState("");
  const [needsProfile, setNeedsProfile] = useState(false);

  // Query
  const { mutateAsync: signInAccount } = useSignInAccount();

  const form = useForm<z.infer<typeof SigninValidation>>({
    resolver: zodResolver(SigninValidation),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleSignin = async (user: z.infer<typeof SigninValidation>) => {
    setSubmitError("");
    setNeedsProfile(false);
    try {
      await signInAccount(user);
      if (await checkAuthUser()) {
        navigate(postLoginDestination(state), { replace: true });
        return;
      }
      setSubmitError("You are signed in, but your profile could not be loaded. Retry or finish your profile.");
      setNeedsProfile(true);
    } catch (error) {
      setSubmitError(authErrorMessage(error, "signin"));
    }
  };

  return (
    <Form {...form}>
      <h1 className="auth-title" id="auth-title">Welcome back</h1>
      <p className="auth-intro">Log in to see what’s new on ZeroNet.</p>
      <form
        onSubmit={form.handleSubmit(handleSignin)}
        className="auth-form"
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  className="auth-input"
                  {...field}
                />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  className="auth-input"
                  {...field}
                />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />

        <Link
          to="/forgot-password"
          state={state}
          className="text-sm text-[#c2b9ff] underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
        {submitError && (
          <p role="alert" className="auth-error text-sm">
            {submitError}{" "}
            {needsProfile && (
              <Link to="/sign-up?complete=1" state={state} className="underline">
                Finish your profile
              </Link>
            )}
          </p>
        )}
        <Button
          type="submit"
          className="auth-submit"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <div className="flex-center gap-2">
              <Loader /> Loading...
            </div>
          ) : (
            "Log in"
          )}
        </Button>
      </form>

      <p className="auth-footer">
        Don&apos;t have an account?{" "}
        <Link to="/sign-up" state={state}>Sign up</Link>
      </p>
    </Form>
  );
};

export default SigninForm;
