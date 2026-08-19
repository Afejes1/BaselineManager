import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "V3 Technical Baseline Manager",
  description: "Manage the F-35 technical baseline from the required 24-column workbook.",
  openGraph: {
    title: "V3 Technical Baseline Manager",
    description: "Manage the required 24-column workbook as a technical baseline.",
    type: "website",
    images: [{ url: "/og.png", width: 1739, height: 907, alt: "V3 Technical Baseline data transformation" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "V3 Technical Baseline Manager",
    description: "A spreadsheet-familiar technical baseline application.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
