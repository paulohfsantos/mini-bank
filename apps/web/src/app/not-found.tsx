import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>Página não encontrada</h1>
      <p>A conta ou transferência não existe, ou o endereço está incorreto.</p>
      <Link href="/">Voltar ao início</Link>
    </>
  );
}
