import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto min-h-screen max-w-[1100px] px-4 py-8 sm:px-6">
          {children}
        </div>
      </body>
    </html>
  );
}
