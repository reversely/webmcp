import type { ReactNode } from "react";
import { Inter, Zilla_Slab } from "next/font/google";
import { shop } from "../domain/store";
import "./globals.css";

const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });
const display = Zilla_Slab({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });

export const metadata = { title: shop().name };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
