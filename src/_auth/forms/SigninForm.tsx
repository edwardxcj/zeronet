import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";

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
import { useToast } from "@/components/ui/use-toast";

import { SigninValidation } from "@/lib/validation";
import { useSignInAccount } from "@/lib/react-query/queriesAndMutations";
import { useUserContext } from "@/context/AuthContext";

const SigninForm = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { checkAuthUser, isLoading: isUserLoading } = useUserContext();

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
    const session = await signInAccount(user);

    if (!session) {
      toast({ title: "Login failed. Please try again." });

      return;
    }

    const isLoggedIn = await checkAuthUser();

    if (isLoggedIn) {
      form.reset();

      navigate("/");
    } else {
      toast({ title: "Login failed. Please try again." });

      return;
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

        <Button
          type="submit"
          className="auth-submit"
          disabled={form.formState.isSubmitting}
        >
          {isUserLoading ? (
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
        <Link to="/sign-up">Sign up</Link>
      </p>
    </Form>
  );
};

export default SigninForm;
