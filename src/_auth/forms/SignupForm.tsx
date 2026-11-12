import * as z from "zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
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
import { useToast } from "@/components/ui/use-toast";

import {
  useCreateUserAccount,
  useSignInAccount,
} from "@/lib/react-query/queriesAndMutations";
import { SignupValidation } from "@/lib/validation";
import { useUserContext } from "@/context/AuthContext";

const SignupForm = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { checkAuthUser, isLoading: isUserLoading } = useUserContext();

  const form = useForm<z.infer<typeof SignupValidation>>({
    resolver: zodResolver(SignupValidation),
    defaultValues: {
      name: "",
      username: "",
      email: "",
      password: "",
    },
  });

  // Queries
  const { mutateAsync: createUserAccount, isPending: isCreatingAccount } =
    useCreateUserAccount();
  const { mutateAsync: signInAccount, isPending: isSigningInUser } =
    useSignInAccount();

  // Handler
  const handleSignup = async (user: z.infer<typeof SignupValidation>) => {
    try {
      const newUser = await createUserAccount(user);

      if (!newUser) {
        toast({ title: "Sign up failed. Please try again." });

        return;
      }

      const session = await signInAccount({
        email: user.email,
        password: user.password,
      });

      if (!session) {
        toast({ title: "Something went wrong. Please login your new account" });

        navigate("/sign-in");

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
    } catch (error) {
      console.log({ error });
    }
  };

  return (
    <Form {...form}>
      <h1 className="auth-title" id="auth-title">Create your account</h1>
      <p className="auth-intro">Enter your details to join ZeroNet.</p>

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
                  autoComplete="new-password"
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
          {isCreatingAccount || isSigningInUser || isUserLoading ? (
            <div className="flex-center gap-2">
              <Loader /> Loading...
            </div>
          ) : (
            "Sign up"
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
