import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'mini-banco',
  description: 'Laboratório de contas e transferências',
  // Ids de conta na URL: nada de indexação (o site só existe durante o estudo).
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <header>
          <nav>
            <Link href="/" className="brand">
              mini-banco
            </Link>
            <Link href="/accounts/new">Abrir conta</Link>
            <Link href="/transfers/new">Transferir</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer>Laboratório. Não use dados reais: os CPFs aqui devem ser gerados.</footer>
      </body>
    </html>
  );
}
