import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MerchFlow · ICM",
  description: "Apparel merchandising workspace · Công việc, hồ sơ và tri thức ngành may.",
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
    <html lang="vi">
      <body className="antialiased">{children}</body>
    </html>
  );
}
