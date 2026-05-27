import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FN OS",
  description: "온라인 판매, 수입관리, 광고분석, 회계/비용, 아카이브를 자체 DB로 통합 관리하는 운영 OS",
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
