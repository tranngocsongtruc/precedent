import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Precedent — a context graph for decisions",
  description: "Capture the why behind every pricing exception, approval, and override.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono antialiased">{children}</body>
    </html>
  );
}
