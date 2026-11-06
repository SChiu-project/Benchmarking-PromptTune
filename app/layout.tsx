import { isVercel } from "@/lib/runtime";
import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import "./globals.css";
export const metadata: Metadata = {
  title: "Doc Search Benchmark",
  description: "Run, inspect, and evaluate document search answers.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell hosted={isVercel()}>{children}</Shell>
      </body>
    </html>
  );
}
