import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shakin WhatsApp AI Bridge',
  description: 'WhatsApp to Telegram to AI to WhatsApp bridge',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
