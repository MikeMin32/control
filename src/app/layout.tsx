import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VM Control",
  description: "Private VM inventory and lifecycle management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
