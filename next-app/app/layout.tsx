import './globals.css';
import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

const jakarta = Plus_Jakarta_Sans({ 
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans'
});

export const metadata: Metadata = {
  title: 'Allo | Stock Reservation Hub',
  description: 'An inventory and order-fulfillment platform with concurrency-safe stock reservations.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${jakarta.variable}`}>
      <body className="bg-[#f8fafc] text-[#1e293b] antialiased">
        {children}
      </body>
    </html>
  );
}
