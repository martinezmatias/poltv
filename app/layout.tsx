import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Generative TV",
  description: "A minimal MiniMax H3 Max Director live stream prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
