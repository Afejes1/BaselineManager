import type { Metadata } from "next";
import "./globals.css";
import { WorkspaceContextProvider } from "../components/workspace-context";

export const metadata: Metadata = {
  title: "V3 Technical Baseline Manager",
  description: "Maintain the F-35 Working Technical Baseline and exact A2O XLSX exchange.",
  openGraph: {
    title: "V3 Technical Baseline Manager",
    description: "Maintain the Working Technical Baseline and exact A2O XLSX exchange.",
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
      <body>
        <WorkspaceContextProvider>{children}</WorkspaceContextProvider>
      </body>
    </html>
  );
}
