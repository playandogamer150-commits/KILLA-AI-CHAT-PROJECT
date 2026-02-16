import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./styles.css";

const clerkPublishableKey =
  (import.meta as any).env?.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || (import.meta as any).env?.VITE_CLERK_PUBLISHABLE_KEY;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {clerkPublishableKey ? (
      <ClerkProvider publishableKey={String(clerkPublishableKey)}>
        <App />
      </ClerkProvider>
    ) : (
      <div style={{ padding: 24, color: "#fff", background: "#000", fontFamily: "system-ui" }}>
        Missing Clerk key. Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> in <code>.env</code>.
      </div>
    )}
  </React.StrictMode>
);
