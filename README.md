# PreçoCerto

Aplicação web pessoal para organizar rotas e preços de corridas anotados manualmente. O MVP não consulta Uber ou 99, não usa scraping e não calcula previsões: a tela correspondente informa explicitamente quando os dados são insuficientes e que a análise ainda não está implementada. Os dados ficam no `localStorage` deste navegador; exporte cópias CSV para transferir ou guardar o histórico.

## Requisitos

- Node.js 20.19+ ou 22.12+ (compatibilidade do Vite 7)
- pnpm 9+

Versões principais instaladas e registradas no `pnpm-lock.yaml`: React 19.3.1, TypeScript 5.9.3, Vite 7.3.7, React Router 7.18.4, Vitest 3.2.7, Zod 4.6.7 e ESLint 9.39.5. O `package.json` declara as faixas compatíveis; use `pnpm install --frozen-lockfile` para reproduzir as versões testadas. Dependências abertas sob licenças de código aberto.

## Instalação e execução

```sh
pnpm install
pnpm dev
```

Abra o endereço indicado pelo Vite (normalmente http://localhost:5173). Para conferir a aplicação em uma rede local, use `pnpm dev -- --host 0.0.0.0`.

## Testes e build

```sh
pnpm test
pnpm lint
pnpm build
pnpm preview
```

O build gera os arquivos estáticos em `dist/`. O service worker e o manifesto PWA permitem instalação e cache básico dos recursos servidos pela mesma origem. O desenvolvimento local não registra o service worker; ele é ativado na build de produção.

## Funcionalidades

- Dashboard responsivo em português, navegação desktop e mobile.
- Cadastro, edição e exclusão confirmada de rotas; origem, destino e categoria opcional.
- Registro de preço manual para Uber ou 99, categoria e data/hora interpretadas no fuso `America/Fortaleza` (UTC−3).
- Histórico com filtros por rota, plataforma, categoria e período; exclusão confirmada.
- Exportação CSV e importação com validação de cabeçalho, estrutura e campos via Zod. A importação acrescenta registros ao histórico.
- Dados persistidos localmente no dispositivo. Não há conta, backend, sincronização, preço atual, modo demonstrativo nem API de plataforma.
- Tela de previsões explicita que não há cálculo disponível nesta versão.

## Variáveis de ambiente

Não são necessárias. `.env.example` documenta essa ausência; não há segredos no frontend.
