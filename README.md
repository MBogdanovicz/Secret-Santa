# Amigo Secreto da Família (PWA)

Site simples para organizar o amigo secreto:

- **Organizador** (`/#admin`, protegido por senha): cadastra participantes, faz o sorteio
  (ninguém tira a si mesmo nem o próprio par; os casais são marcados no painel) e envia o link individual de cada um pelo WhatsApp.
  O organizador **não** vê quem tirou quem, então pode participar também.
- **Participante** (`/#p=<código>`): toca para revelar o amigo, vê as sugestões dele e
  escreve as próprias sugestões de presente.
- Os links continuam os mesmos se o sorteio for refeito.
- Instalável no celular (PWA).

Tecnologia: Cloudflare Workers (site + API) e Workers KV (dados). Plano gratuito.

## Publicar (uma vez, ~10 minutos)

Pré-requisito: Node.js instalado e uma conta gratuita na Cloudflare.

```bash
npm install
npx wrangler login                     # abre o navegador para entrar na Cloudflare
npx wrangler kv namespace create DB    # copie o "id" que aparecer para o wrangler.toml
npx wrangler secret put ADMIN_PASSWORD # escolha a senha do organizador
npx wrangler deploy                    # publica em https://secret-santa.<sua-conta>.workers.dev
```

Depois abra `https://secret-santa.<sua-conta>.workers.dev/#admin` e entre com a senha.

## Rodar localmente

```bash
echo 'ADMIN_PASSWORD=teste123' > .dev.vars
npm run dev   # http://localhost:8787/#admin
```

## Deploy automático

O Worker está conectado a este repositório pela Cloudflare (Workers Builds): cada push no `main` publica o site.
Se aparecer o aviso "disconnected from your Git account", libere o repositório no app
"Cloudflare Workers and Pages" em https://github.com/settings/installations.
