// Dev loop de um app (api ou worker), sem dependências extras: compila os pacotes do
// workspace e o app com SWC, recompila quando src/ muda (fs.watch nativo) e deixa
// `node --watch` reiniciar o processo quando dist/ muda. O .env da raiz é carregado pelo Node.
// Uso: no package.json do app, "dev": "node ../../scripts/dev-app.mjs".
import { execFileSync, spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

// pnpm roda o script no diretório do app e expõe o nome do pacote.
const root = process.cwd();
const name = process.env.npm_package_name;
if (!name) throw new Error('rode via pnpm (ex.: pnpm --filter @mini-banco/api dev)');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const build = () => run('pnpm', ['run', '--silent', 'build']);

run('pnpm', ['--filter', `${name}^...`, 'run', 'build']);
build();

let timer;
watch(resolve(root, 'src'), { recursive: true }, (_event, file) => {
  if (!file || file.endsWith('.spec.ts')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      build();
    } catch {
      // Erro de compilação já apareceu no terminal; o processo anterior segue rodando.
    }
  }, 100);
});

// Só no dev local: JSON do pino → texto colorido (pino-pretty). Em produção a saída é JSON
// cru, que o CloudWatch consulta por campo (PERF-24). LOG_PRETTY=false mostra o JSON aqui.
const pretty = process.env.LOG_PRETTY !== 'false';

const server = spawn(
  process.execPath,
  ['--watch-path=dist', '--enable-source-maps', '--env-file-if-exists=../../.env', 'dist/main.js'],
  { cwd: root, stdio: ['inherit', pretty ? 'pipe' : 'inherit', 'inherit'] },
);

if (pretty) {
  const formatter = spawn(
    resolve(root, 'node_modules/.bin/pino-pretty'),
    ['--translateTime', 'SYS:HH:MM:ss.l', '--ignore', 'pid,hostname,service', '--singleLine'],
    { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] },
  );
  server.stdout.pipe(formatter.stdin);
}

server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
