import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "mybuild — local Expo Android builds",
  description: "Self-hosted, localhost-only Android build service for Expo apps",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#0b0e14",
          color: "#e6e6e6",
          minHeight: "100vh",
        }}
      >
        {children}
      </body>
    </html>
  );
}
