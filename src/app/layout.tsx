import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Living room planner" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
