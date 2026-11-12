import { Outlet, Navigate } from "react-router-dom";

const AuthLayout = () => {
  const isAuthenticated = false;

  return (
    <>
      {isAuthenticated ? (
        <Navigate to="/" />
      ) : (
        <>
          <section className="flex flex-1 justify-center items-center flex-col py-10">
            <Outlet />
          </section>

          <div
            aria-hidden="true"
            className="hidden h-screen w-1/2 shrink-0 bg-cover bg-center xl:block xl:bg-[url('/assets/images/auth-neon.webp')]"
          />
        </>
      )}
    </>
  );
};

export default AuthLayout;
