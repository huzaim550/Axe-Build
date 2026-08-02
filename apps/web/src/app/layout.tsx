import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Axe Build — self-hosted Expo Android builds",
  description:
    "A self-hosted alternative to Expo's cloud build service: Android APK/AAB builds, OTA updates and in-app notifications, all on your own machine.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
