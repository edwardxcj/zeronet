import { Outlet } from "react-router-dom";

import "./auth.css";

const AuthLayout = () => (
  <div className="auth-shell">
    <div className="auth-scene" aria-hidden="true" />
    <div className="auth-scroll">
      <div className="auth-content">
        <section className="auth-panel" aria-labelledby="auth-title">
          <img
            className="auth-logo"
            src="/assets/images/zeronet-logo.svg"
            alt="ZeroNet"
            width={160}
            height={36}
          />
          <Outlet />
        </section>
      </div>
    </div>
  </div>
);

export default AuthLayout;
