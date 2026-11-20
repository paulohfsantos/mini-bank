import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type Request, test } from '@playwright/test';
import { API_URL } from '../../playwright.config';
import { randomCpf } from '../support/cpf';

const API_KEY = process.env.API_KEY ?? '';
const nbsp = (s: string) => s.replace(/\u00a0/g, ' ');

// WEB-AC-08: toda requisição feita pelo navegador, em todos os testes, é inspecionada.
let browserRequests: Request[] = [];
test.beforeEach(({ page }) => {
  browserRequests = [];
  page.on('request', (request) => browserRequests.push(request));
});
test.afterEach(async () => {
  for (const request of browserRequests) {
    const headers = await request.allHeaders();
    expect(headers, request.url()).not.toHaveProperty('x-api-key');
    const raw = `${request.url()} ${JSON.stringify(headers)} ${request.postData() ?? ''}`;
    expect(raw.includes(API_KEY), `API key em ${request.url()}`).toBe(false);
  }
});

/** Chamada direta à API pelo runner (Node), não pelo navegador: preparar dados. */
async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; key?: string } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': API_KEY,
      'content-type': 'application/json',
      ...(init.key ? { 'idempotency-key': init.key } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

async function openAccount(page: Page, name: string, balance: string): Promise<string> {
  await page.goto('/accounts/new');
  await page.getByLabel('Nome do titular').fill(name);
  await page.getByLabel('CPF').fill(randomCpf());
  await page.getByLabel('Saldo inicial (R$)').fill(balance);
  await page.getByRole('button', { name: 'Abrir conta' }).click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  return page.url().split('/').at(-1)!;
}

async function fillTransfer(page: Page, from: string, to: string, amount: string): Promise<void> {
  await page.goto('/transfers/new');
  await page.getByLabel('Conta de origem (id)').fill(from);
  await page.getByLabel('Conta de destino (id)').fill(to);
  await page.getByLabel('Valor (R$)').fill(amount);
}

interface StatementPage {
  items: { type: string }[];
}

test('[WEB-AC-01] [WEB-AC-05] abrir duas contas, transferir e ver o comprovante e o extrato', async ({
  page,
}) => {
  const a = await openAccount(page, 'Ana Teste', '1.500,00');
  await expect(page.getByRole('heading', { name: 'Ana Teste' })).toBeVisible();
  expect(nbsp(await page.getByTestId('balance').innerText())).toBe('R$ 1.500,00');
  await expect(page.getByText(/CPF \*\*\*\.\d{3}\.\d{3}-\*\*/)).toBeVisible();

  const b = await openAccount(page, 'Bruno Teste', '0');

  await fillTransfer(page, a, b, '150,00');
  await page.getByRole('button', { name: 'Transferir' }).click();
  await page.waitForURL(/\/transfers\/[0-9a-f-]{36}$/);
  expect(nbsp(await page.getByTestId('amount').innerText())).toBe('R$ 150,00');
  await expect(page.getByRole('link', { name: a })).toBeVisible();
  await expect(page.getByRole('link', { name: b })).toBeVisible();

  await page.getByRole('link', { name: a }).click();
  expect(nbsp(await page.getByTestId('balance').innerText())).toBe('R$ 1.350,00');
  await expect(page.getByTestId('statement-entry')).toHaveCount(2);
  await expect(page.getByTestId('statement-entry').first()).toContainText('Transferência enviada');
});

test('[WEB-AC-05] saldo insuficiente: mensagem no formulário e nada muda', async ({ page }) => {
  const a = await openAccount(page, 'Pobre Teste', '10,00');
  const b = await openAccount(page, 'Destino Teste', '0');
  await fillTransfer(page, a, b, '10,01');
  await page.getByRole('button', { name: 'Transferir' }).click();

  // Escopo em <main>: o Next tem o próprio role=alert (anunciador de rota).
  await expect(page.locator('main').getByRole('alert')).toContainText('Saldo insuficiente');
  await expect(page.getByLabel('Valor (R$)')).toHaveValue('10,01');
  const statement = await api<StatementPage>(`/v1/accounts/${a}/statement`);
  expect(statement.items.map((i) => i.type)).toEqual(['OPENING']);
});

test.describe('[WEB-AC-06] envio duplicado gera uma única transferência', () => {
  async function debits(accountId: string): Promise<number> {
    const statement = await api<StatementPage>(`/v1/accounts/${accountId}/statement`);
    return statement.items.filter((i) => i.type === 'DEBIT').length;
  }

  function countActionPosts(page: Page): Request[] {
    const posts: Request[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/transfers/new') posts.push(r);
    });
    return posts;
  }

  test('[WEB-AC-06] o mesmo formulário reenviado ao servidor (retry de rede, envio sem JS)', async ({
    page,
  }) => {
    const a = await openAccount(page, 'Reenvio Teste', '100,00');
    const b = await openAccount(page, 'Reenvio Destino', '0');
    await fillTransfer(page, a, b, '1,00');
    const posts = countActionPosts(page);

    // No navegador, o React enfileira o 2º envio e o descarta quando o 1º redireciona:
    // só um POST sai. Proteção extra, mas não a garantia.
    await page.locator('main form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/transfers\/[0-9a-f-]{36}$/);
    expect(posts).toHaveLength(1);
    const receipt = page.url();

    // A garantia: o MESMO POST da action (mesmo Next-Action, mesmo corpo, mesma chave)
    // chegando de novo ao servidor, como num retry de rede ou duplo envio sem JavaScript.
    const original = posts[0]!;
    const headers = await original.allHeaders();
    const replay = await page.request.post(original.url(), {
      headers: Object.fromEntries(
        Object.entries(headers).filter(([k]) => k === 'content-type' || k.startsWith('next-')),
      ),
      data: original.postDataBuffer() ?? undefined,
      maxRedirects: 0,
    });
    expect(replay.status()).toBeLessThan(400);
    // Redirect de Server Action vem no header x-action-redirect: o MESMO comprovante (replay).
    expect(replay.headers()['x-action-redirect']).toContain(new URL(receipt).pathname);
    expect(await debits(a)).toBe(1);
  });

  test('[WEB-AC-06] duplo clique no botão', async ({ page }) => {
    const a = await openAccount(page, 'Clique Teste', '100,00');
    const b = await openAccount(page, 'Clique Destino', '0');
    await fillTransfer(page, a, b, '1,00');

    await page.getByRole('button', { name: 'Transferir' }).dblclick();
    await expect(page).toHaveURL(/\/transfers\/[0-9a-f-]{36}$/);
    expect(await debits(a)).toBe(1);
  });
});

test('[WEB-AC-02] CPF inválido e CPF já cadastrado aparecem junto do campo', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByLabel('CPF').fill('52998224724');
  await page.getByLabel('CPF').blur();
  await expect(page.getByText('CPF inválido')).toBeVisible();

  const cpf = randomCpf();
  await api('/v1/accounts', {
    method: 'POST',
    body: { holderName: 'Existente', document: cpf, initialBalanceCents: 0 },
  });
  await page.goto('/accounts/new');
  await page.getByLabel('Nome do titular').fill('Outra Pessoa');
  await page.getByLabel('CPF').fill(cpf);
  await page.getByRole('button', { name: 'Abrir conta' }).click();
  await expect(page.getByText('Já existe uma conta para este CPF.')).toBeVisible();
  expect(page.url()).toMatch(/\/accounts\/new$/);
});

test('[WEB-AC-04] extrato com 25 lançamentos: 20 na primeira página, 5 em "ver mais"; 404s', async ({
  page,
}) => {
  const a = await api<{ id: string }>('/v1/accounts', {
    method: 'POST',
    body: { holderName: 'Extrato Teste', document: randomCpf(), initialBalanceCents: 10_000 },
  });
  const b = await api<{ id: string }>('/v1/accounts', {
    method: 'POST',
    body: { holderName: 'Contraparte Teste', document: randomCpf(), initialBalanceCents: 0 },
  });
  for (let i = 0; i < 24; i++) {
    await api('/v1/transfers', {
      method: 'POST',
      key: crypto.randomUUID(),
      body: { sourceAccountId: a.id, destinationAccountId: b.id, amountCents: 100 },
    });
  }

  await page.goto(`/accounts/${a.id}`);
  expect(nbsp(await page.getByTestId('balance').innerText())).toBe('R$ 76,00');
  await expect(page.getByTestId('statement-entry')).toHaveCount(20);
  await expect(page.getByTestId('statement-entry').first()).toContainText('- R$');
  await expect(
    page.getByTestId('statement-entry').first().getByRole('link', { name: /para / }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Ver mais' }).click();
  await expect(page.getByTestId('statement-entry')).toHaveCount(5);
  await expect(page.getByTestId('statement-entry').last()).toContainText('Abertura');
  await expect(page.getByRole('link', { name: 'Ver mais' })).toHaveCount(0);

  for (const path of [
    `/accounts/${crypto.randomUUID()}`,
    '/accounts/nao-e-uuid',
    '/transfers/nao-e-uuid',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  }
});

test.describe('sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('[WEB-NFR-01] abrir conta funciona só com HTML (Server Action com <form action>)', async ({
    page,
  }) => {
    const id = await openAccount(page, 'Sem JS Teste', '5,00');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(nbsp(await page.getByTestId('balance').innerText())).toBe('R$ 5,00');
  });
});

test('[WEB-AC-08] nenhum arquivo do bundle do cliente (.next/static) contém a API key', () => {
  expect(API_KEY.length).toBeGreaterThanOrEqual(16);
  const root = new URL('../../.next/static', import.meta.url).pathname;
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((f) =>
    f.isFile(),
  );
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    expect(readFileSync(path, 'utf8').includes(API_KEY), path).toBe(false);
  }
});
