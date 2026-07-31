import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";

export const metadata: Metadata = {
  title: "MedBuddy local fictional demo",
  description: "Local-only browser host for the fictional MedBuddy prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <strong>MedBuddy</strong>
          <span>Local fictional prototype</span>
        </header>
        {children}
      </body>
    </html>
  );
}
