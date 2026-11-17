export class SignupProfileError extends Error {
  readonly accountId: string;

  constructor(accountId: string) {
    super("Your account was created, but your profile could not be saved. Retry to finish setting up your profile.");
    this.name = "SignupProfileError";
    this.accountId = accountId;
  }
}

export function authErrorMessage(
  error: unknown,
  action: "signin" | "signup" | "recovery" | "reset"
): string {
  if (error instanceof SignupProfileError) return error.message;

  const code =
    error && typeof error === "object" && "code" in error ? error.code : undefined;
  const type =
    error && typeof error === "object" && "type" in error ? error.type : undefined;

  if (code === 429) return "Too many attempts. Wait a moment and try again.";
  if (error instanceof TypeError || code === 0) {
    return "Could not connect. Check your connection and try again.";
  }
  if (type === "user_session_already_exists") {
    return "You are already signed in to another account. Log out before switching accounts.";
  }
  if (action === "signin" && code === 401) {
    return "The email or password is incorrect. Try again or reset your password.";
  }
  if (action === "signup" && code === 409) {
    return "An account with this email already exists. Log in or reset your password.";
  }
  if (action === "reset" && (type === "user_invalid_token" || code === 401)) {
    return "This reset link has expired or has already been used. Request a new link.";
  }
  if (typeof type === "string" && type.startsWith("user_password")) {
    return "Choose a different password. Use at least 8 characters and avoid common or previously used passwords.";
  }

  const messages = {
    signin: "Could not log in. Please try again.",
    signup: "Could not create your account. Please try again.",
    recovery: "Could not send a reset link. Please try again.",
    reset: "Could not reset your password. Try another password or request a new link.",
  };
  return messages[action];
}

export function isAuthPath(pathname: string): boolean {
  return ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"].includes(
    pathname.toLowerCase().replace(/\/+$/, "")
  );
}
