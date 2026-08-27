import type { ReactNode } from "react";

export const metadata = { title: "Living room planner" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
