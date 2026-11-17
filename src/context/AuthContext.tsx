import { useLocation, useNavigate } from "react-router-dom";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { IUser } from "@/types";
import { getCurrentUser } from "@/lib/appwrite/api";
import { isAuthPath } from "@/lib/authErrors";

export const INITIAL_USER = {
  id: "",
  name: "",
  username: "",
  email: "",
  imageUrl: "",
  bio: "",
};

const INITIAL_STATE = {
  user: INITIAL_USER,
  isLoading: false,
  isAuthenticated: false,
  setUser: () => {},
  setIsAuthenticated: () => {},
  checkAuthUser: async () => false as boolean,
};

type IContextType = {
  user: IUser;
  isLoading: boolean;
  setUser: React.Dispatch<React.SetStateAction<IUser>>;
  isAuthenticated: boolean;
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean>>;
  checkAuthUser: () => Promise<boolean>;
};

const AuthContext = createContext<IContextType>(INITIAL_STATE);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const currentPath = useRef(pathname);
  const navigateRef = useRef(navigate);
  const authRequest = useRef(0);
  currentPath.current = pathname;
  navigateRef.current = navigate;
  const [user, setUser] = useState<IUser>(INITIAL_USER);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuthUser = useCallback(async () => {
    const request = ++authRequest.current;
    setIsLoading(true);
    try {
      const currentAccount = await getCurrentUser();
      if (request !== authRequest.current) return false;
      if (currentAccount) {
        setUser({
          id: currentAccount.$id,
          name: currentAccount.name,
          username: currentAccount.username,
          email: currentAccount.email,
          imageUrl: currentAccount.imageUrl,
          bio: currentAccount.bio,
        });
        setIsAuthenticated(true);

        return true;
      }

      setUser(INITIAL_USER);
      setIsAuthenticated(false);
      return false;
    } catch {
      if (request === authRequest.current) {
        setUser(INITIAL_USER);
        setIsAuthenticated(false);
      }
      return false;
    } finally {
      if (request === authRequest.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initialRequest = authRequest.current + 1;
    void checkAuthUser().then((authenticated) => {
      if (
        active &&
        authRequest.current === initialRequest &&
        !authenticated &&
        !isAuthPath(currentPath.current)
      ) {
        navigateRef.current("/sign-in", { replace: true });
      }
    });
    return () => { active = false; };
  }, [checkAuthUser]);

  const value = {
    user,
    setUser,
    isLoading,
    isAuthenticated,
    setIsAuthenticated,
    checkAuthUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useUserContext = () => useContext(AuthContext);
