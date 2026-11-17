import { useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";

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

import {
  useCreateUserAccount,
  useSignInAccount,
} from "@/lib/react-query/queriesAndMutations";
import { CompleteProfileValidation, SignupValidation } from "@/lib/validation";
import { useUserContext } from "@/context/AuthContext";
import { completeSignupProfile, getAccount } from "@/lib/appwrite/api";
import { authErrorMessage, SignupProfileError } from "@/lib/authErrors";

const SignupForm = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const completeMode = params.get("complete") === "1";
  const { checkAuthUser } = useUserContext();
  const [createdAccountId, setCreatedAccountId] = useState<string>();
  const [accountReady, setAccountReady] = useState(!completeMode);
  const [accountLoadAttempt, setAccountLoadAttempt] = useState(0);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const form = useForm<z.infer<typeof SignupValidation>>({
    resolver: zodResolver(completeMode ? CompleteProfileValidation : SignupValidation),
    defaultValues: {
      name: "",
      username: "",
      email: "",
      password: "",
    },
  });

  // Queries
  const { mutateAsync: createUserAccount } =
    useCreateUserAccount();
  const { mutateAsync: signInAccount } =
    useSignInAccount();

  useEffect(() => {
    if (!completeMode) return;
    setAccountReady(false);
    setSubmitError("");
    setRequiresLogin(false);
    let active = true;
    void getAccount()
      .then((currentAccount) => {
        if (!active) return;
        form.setValue("email", currentAccount.email);
        if (!form.getFieldState("name").isDirty) {
          form.setValue("name", currentAccount.name ?? "");
        }
        setAccountReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const needsLogin =
          error && typeof error === "object" && "code" in error && error.code === 401;
        setRequiresLogin(!!needsLogin);
        setSubmitError(
          needsLogin
            ? "Log in first to finish setting up your profile."
            : authErrorMessage(error, "signin")
        );
      });
    return () => { active = false; };
  }, [accountLoadAttempt, completeMode, form]);

  const handleSignup = async (user: z.infer<typeof SignupValidation>) => {
    setSubmitError("");
    try {
      if (completeMode) {
        await completeSignupProfile(user);
      } else if (createdAccountId) {
        await signInAccount(user);
        await completeSignupProfile(user, createdAccountId);
      } else {
        const newUser = await createUserAccount(user);
        setCreatedAccountId(newUser.accountId);
      }

      if (await checkAuthUser()) {
        navigate("/");
      } else {
        setSubmitError("Your account is ready, but your profile could not be loaded. Retry to continue.");
      }
    } catch (error) {
      if (error instanceof SignupProfileError) {
        setCreatedAccountId(error.accountId);
      }
      setSubmitError(authErrorMessage(error, "signup"));
    }
  };

  return (
    <Form {...form}>
      <h1 className="auth-title" id="auth-title">
        {completeMode || createdAccountId ? "Finish your profile" : "Create your account"}
      </h1>
      <p className="auth-intro">
        {completeMode || createdAccountId
          ? "Choose how you appear on ZeroNet."
          : "Enter your details to join ZeroNet."}
      </p>

      <form
        onSubmit={form.handleSubmit(handleSignup)}
        className="auth-form"
        noValidate
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Name</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="name"
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
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Username</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  autoComplete="username"
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  autoComplete="email"
                  readOnly={completeMode || !!createdAccountId}
                  className="auth-input"
                  {...field}
                />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />

        {!completeMode && <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="auth-label">Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="new-password"
                  className="auth-input"
                  {...field}
                />
              </FormControl>
              <FormMessage className="auth-error" />
            </FormItem>
          )}
        />}

        {completeMode && !accountReady && !submitError && (
          <p role="status" className="text-sm text-light-2">Loading your account...</p>
        )}
        {submitError && <p role="alert" className="auth-error text-sm">{submitError}</p>}
        {completeMode && !accountReady && submitError && (
          requiresLogin ? (
            <Link to="/sign-in" className="text-sm text-[#c2b9ff] underline">
              Log in to continue
            </Link>
          ) : (
            <Button
              type="button"
              className="shad-button_dark_4"
              onClick={() => setAccountLoadAttempt((attempt) => attempt + 1)}
            >
              Retry loading your account
            </Button>
          )
        )}
        <Button
          type="submit"
          className="auth-submit"
          disabled={form.formState.isSubmitting || !accountReady}
        >
          {form.formState.isSubmitting ? (
            <div className="flex-center gap-2">
              <Loader /> Loading...
            </div>
          ) : (
            completeMode || createdAccountId ? "Finish profile" : "Sign up"
          )}
        </Button>
      </form>

      <p className="auth-footer">
        Already have an account?{" "}
        <Link to="/sign-in">Log in</Link>
      </p>
    </Form>
  );
};

export default SignupForm;
