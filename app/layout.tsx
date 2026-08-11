import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GARMENT BURO / Рабочее пространство",
  description: "Персональное рабочее пространство и карта зависимостей Commercial MVP."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
