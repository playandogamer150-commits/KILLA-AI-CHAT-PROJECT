# Grok-Style Chat UI (React + TypeScript + Vite + Puter.js)

Interface de chat AI dark premium inspirada no layout do Grok, com backendless AI via Puter.js.

## Stack

- React 18
- TypeScript
- Vite 5
- CSS puro
- Puter.js (`https://js.puter.com/v2/`)

## O que esta funcional

- Conexao com conta Puter (botao `Connect`)
- Carregamento de todos os modelos disponiveis com `puter.ai.listModels()`
- Modelo padrao automatico: **Claude Opus 4.6** (quando disponivel)
- Chat real com `puter.ai.chat()` em streaming
- Historico de conversa enviado como contexto

## Rodar localmente

```bash
npm install
npm run dev
```

## Build de producao

```bash
npm run build
npm run preview
```

## Arquivos principais

- `index.html`: inclui script Puter
- `src/App.tsx`: auth, listModels, default model, envio/streaming
- `src/components/TopBar.tsx`: seletor de modelos dinamico
- `src/components/Composer.tsx`: barra de input e tools
- `src/styles.css`: tema dark e responsividade

## Observacao

Se o navegador bloquear popup, o `signIn` do Puter pode falhar. Nesse caso, permita popups para `localhost`.
