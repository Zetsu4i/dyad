import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dyad Cloud — AI App Builder",
  description:
    "Build full-stack web apps with AI. Cloud sandboxes, MCP tools and skills.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
