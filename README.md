# PreçoCerto

App pessoal para manter rotas e observações de preços de corridas. Com o Supabase configurado, autenticação e persistência são feitas no PostgreSQL. Sem configuração ou sessão, o app mostra uma tela de erro/configuração e não grava dados localmente.

Nenhum preço é consultado automaticamente; não há scraping nem API privada. O navegador usa somente a chave publicável (ou a chave legada `anon`) e as tabelas têm Row Level Security (RLS). A chave `service_role` nunca deve ser colocada no cliente.

## Stack

- React 19, TypeScript strict, Vite 7, React Router 7, Zod 4.
- Supabase JS, PostgreSQL, Supabase Auth.
- Vitest 4, Testing Library e PGlite para executar testes RLS sobre PostgreSQL.
- Supabase CLI para aplicar migrações e testes pgTAP locais.

Versões resolvidas e verificadas pelo `package-lock.json`: React/React DOM 19.3.1, TypeScript 5.9.3, Vite 7.3.7, React Router 7.18.4, Zod 4.6.7, Supabase JS 2.109.0, Vitest 4.1.12 e PGlite 0.5.11. `npm ci` instala as versões travadas; `supabase` CLI é instalada separadamente conforme os comandos de migração abaixo.

## Requisitos

- Node.js 20.19+ ou 22.12+ e npm 10+.
- Para `supabase start` / `supabase test db`: Supabase CLI e Docker Desktop (com integração WSL ativa).

## Rodar pelo WSL

No terminal Ubuntu/WSL:

```sh
cd /mnt/c/Users/devid/Documents/ChatGPT/HoraCertaApp
npm ci
cp .env.example .env.local
npm run dev -- --host 0.0.0.0
```

Preencha `.env.local` antes de usar a aplicação. Abra o endereço do Vite no navegador Windows (normalmente http://localhost:5173). Não versione `.env.local`.

## Configurar Supabase

1. Crie um projeto Supabase, inclusive no plano Free se couber nas suas necessidades e nos limites atuais.
2. No Dashboard, habilite cadastro/autenticação por e-mail e configure confirmação de e-mail e URLs de redirecionamento para o endereço usado no app. O SMTP padrão tem limites; para uso fora de testes, configure um provedor de e-mail confiável.
3. Em **Project Settings → API Keys**, copie a URL do projeto e a chave **publishable** (ou a chave `anon` legada) para `.env.local`:

   ```dotenv
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sua-chave-sb_publishable_
   ```

4. Aplique a migração conforme a seção abaixo, depois reinicie `npm run dev` e crie sua conta na tela do PreçoCerto.

Variáveis `VITE_*` são incluídas no bundle do navegador. Configure somente a chave publishable/anon. **Nunca** use `service_role`, uma secret key, senha do banco ou credencial privilegiada em `.env.local` do frontend. Não há valor real em `.env.example`.

## Aplicar migrações

As migrações versionadas ficam em `supabase/migrations/`.

### Projeto Supabase hospedado

No WSL, instale a CLI como dependência de desenvolvimento uma vez:

```sh
npm install --save-dev supabase
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Confirme o `project-ref` antes de `db push`; o comando aplica as migrações pendentes ao projeto vinculado.

### Banco Supabase local

Requer Docker Desktop com integração WSL habilitada:

```sh
npm install --save-dev supabase
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset` recria o banco local e aplica todas as migrações e testes definidos em `supabase/tests/`. Use-o apenas no stack local descartável; para manter dados locais, prefira `npx supabase migration up`.

## Persistência e autorização

- `profiles` é criado por trigger a partir de `auth.users`.
- `routes`, `price_observations`, `prediction_results`, `user_preferences` e `integration_status` possuem UUIDs, `timestamptz`, integridade referencial e índices por usuário.
- RLS está habilitada nas seis tabelas. Policies separam `select`, `insert`, `update` e `delete` quando a operação é permitida; a propriedade é determinada por `auth.uid()`. `user_id` usa default do banco e o app não envia esse campo.
- Chaves estrangeiras compostas impedem vincular observações ou previsões à rota de outra pessoa.
- Clientes autenticados só podem inserir observações `manual`. Registros `authorized_api` e `demo` ficam reservados a código confiável no servidor; não existe integração com Uber/99 nesta fase.
- A view `real_valid_price_observations` usa `security_invoker` e filtra `demo` e observações inválidas. `prediction_results` também rejeita qualquer conjunto de fontes que contenha `demo`; gravação de previsões não é exposta ao navegador.
- Exclusão confirmada de uma rota apaga observações e resultados associados por `ON DELETE CASCADE`. “Apagar meus registros” remove todas as rotas do usuário e seus dados dependentes, mas mantém sua conta Supabase.
- Exportação JSON inclui as rotas (inclusive sem observações) e observações carregadas; o histórico também pode ser exportado/importado em CSV, mantendo a categoria da rota e a categoria da corrida separadas. CSV importado é tratado como dado manual e arquivos que tentem declarar `authorized_api` ou `demo` são recusados.

## Testes, lint e build

```sh
npm test
npm run lint
npm run build
npm run preview
npm audit
```

`npm test` executa os testes de domínio/interface e uma suíte de autorização que carrega a migração real em PGlite, cria papéis PostgreSQL (`anon`/`authenticated`) e testa isolamento entre duas identidades, manipulação de `user_id`, restrições de origem/preço, CRUD próprio, fontes `demo` e a projeção sem dados demonstrativos. O arquivo `supabase/tests/rls.test.sql` contém também a suíte pgTAP para `npx supabase test db`.

Os testes PGlite verificam a semântica das políticas SQL em PostgreSQL, com `auth.uid()` simulado pelo claim JWT do Supabase. Eles não verificam um projeto hospedado, o fluxo real de emissão de JWT/e-mail, configuração do Dashboard ou implantação remota. Execute `npx supabase test db` com Docker e, depois, testes no projeto de destino antes de considerar sua configuração remota validada.

## Plano gratuito e limites

O projeto não requer Edge Functions, armazenamento de arquivos nem processamento contínuo. O plano Free do Supabase pode servir para uso pessoal dentro das quotas vigentes; projetos gratuitos inativos podem ser pausados, e exceder limites pode restringir o serviço. Confira [preços e quotas atuais](https://supabase.com/pricing) e [regras de pausa do plano Free](https://supabase.com/docs/guides/platform/free-project-pausing) antes de colocar dados importantes. O app não promete backup, disponibilidade, sincronização offline ou recuperação de conta além dos recursos configurados no Supabase.

## Escopo não implementado

- Cálculo ou exibição de previsões.
- Integração autorizada com plataformas de corrida.
- Modo demonstrativo e inserção de dados `demo` pelo cliente.
- Exclusão da própria conta de autenticação.
