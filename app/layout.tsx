import type { Metadata } from "next";
import { Geist, Geist_Mono, Mona_Sans } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { lime, bg, radius } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Used by the homepage. The width axis lets headlines use the extra-wide cut.
const monaSans = Mona_Sans({
  variable: "--font-mona",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: "Margin Hero",
  description: "See your true profit margin on every SKU and sales channel. Margin tracking for UK e-commerce sellers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${monaSans.variable} h-full antialiased`}
    >
      {/* Brand colours as CSS variables, for styles that can't be inline (e.g. file pickers in globals.css) */}
      <body
        className="min-h-full flex flex-col"
        style={{ "--mh-lime": lime, "--mh-bg": bg, "--mh-radius": radius } as React.CSSProperties}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
