import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "墨落 INKFALL — 水墨下坡",
  description: "一筆入山，一路向下。程序生成的水墨山水 BMX 賽車遊戲。",
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
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
