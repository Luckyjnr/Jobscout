import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { navCounts } from "./db";
import { Shell } from "./shell";
import "./globals.css";

const ui = Geist({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "jobscout",
  description: "A job-finding agent",
};

export const viewport: Viewport = {
  themeColor: "#0A0D14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // the shell shows live counts, so it reads on every navigation
  const counts = await navCounts();

  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>
        <Shell counts={counts}>{children}</Shell>
      </body>
    </html>
  );
}
