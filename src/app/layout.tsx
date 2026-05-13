import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FN OS",
  description: "온라인 판매 운영을 통합 관리하는 브랜드 운영 OS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
