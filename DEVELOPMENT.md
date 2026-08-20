# Desenvolvimento e manutenção

Este documento reúne as instruções operacionais do projeto Cartas Duplas. A documentação pública de uso fica em [README.md](README.md); regras permanentes e contratos de compatibilidade ficam em [PROJECT_RULES.md](PROJECT_RULES.md).

## Estado e identidade do projeto

- Nome público: **Cartas Duplas**.
- Repositório público: `Double-Sided-Cards`.
- Plataforma: Owlbear Rodeo.
- Hospedagem pública: GitHub Pages.
- Autoria: DemonRider.
- Manifesto público da versão 1.0.0: `https://demonrider0.github.io/Double-Sided-Cards/manifest.json?v=101`.
- Versão pública atual no manifesto: `1.0.0`.

`package.json`, `package-lock.json` e `manifest.json` usam `1.0.0`. A unificação foi adotada para a primeira versão pública estável; versões históricas permanecem registradas no changelog e no histórico de auditorias.

A descrição de `manifest.json` resume o escopo funcional. Bibliotecas e mapas pessoais são opcionais e não fazem parte do conteúdo hospedado pelo Core.

O repositório não possui `LICENSE`. Uma licença não deve ser inferida: qualquer decisão de licenciamento público precisa ser tomada explicitamente por DemonRider.

## Pré-requisitos e instalação local

- Node.js 18 ou superior;
- npm;
- dependências instaladas a partir do lockfile com `npm ci`.

O projeto é uma aplicação frontend estática. Não possui banco de dados nem backend público. O servidor local existe apenas para preparação e teste.

## Estrutura essencial

| Caminho | Responsabilidade |
| --- | --- |
| `src/` | Código-fonte do painel, background e regras da extensão. |
| `dist/` | Bundles gerados e distribuídos; não editar manualmente. |
| `src/asset-resolver.js` | Registro canônico, aliases, resolução e persistência local dos vínculos privados. |
| `src/private-asset-pack.js` | Leitura do pack, upload e vínculo pela API de assets do Owlbear. |
| `scripts/` | Build, validação do Core e geração/verificação opcional do pack privado. |
| `manifest.json` | Entrada pública da extensão e versão pública. |
| `index.html` / `background.html` | Entradas do painel e do contexto de background. |

Os diretórios `assets/preset-cards`, `assets/preset-decks`, `assets/scene-presets` e `assets/local-assets` não pertencem ao Core e não devem ser recriados para publicação.

A arquitetura e os fluxos entre módulos estão detalhados em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Comandos disponíveis

| Comando | Finalidade |
| --- | --- |
| `npm run check` | Valida sintaxe, JSONs, package/lockfile, bundles e a ausência de conteúdo privado no Core. |
| `npm run build` | Gera os quatro bundles esperados em `dist/`. |
| `npm run test:regressions` | Executa regressões de pilhas, resolução canônica, aliases, persistência e ausência de pack. |
| `npm run build:private-asset-pack -- --source <origem> --output <destino>` | Migra uma árvore privada antiga para o formato canônico; origem e destino devem ficar fora do Core. |
| `npm run optimize:private-asset-pack -- --source-pack <canônico> --output <runtime>` | Gera sem sobrescrever a fonte um pack runtime v2, testando PNG → WebP em qualidade 95. |
| `npm run check:private-asset-pack -- --pack <diretório>` | Verifica hashes, aliases, manifests, bibliotecas e mapas de um pack privado. |
| `node dev-server.mjs 5180` | Inicia o servidor administrativo em `127.0.0.1:5180`. |

## Build e validação

Sempre que arquivos em `src/` mudarem, execute:

```powershell
npm run build
npm run check
git diff --check
```

Use `node --check <arquivo>` para uma verificação pontual de JavaScript ou MJS quando aplicável. `npm run check` já percorre os arquivos do projeto e valida os JSONs conhecidos.

Os arquivos de `dist/` fazem parte da entrega pública e devem corresponder ao código em `src/`. O build limpa artefatos gerados obsoletos antes de escrever os bundles atuais.

## Private Asset Pack

O pack é uma pasta local e privada com esta estrutura:

```text
private-asset-pack.json
assets/<sha256>.<extensão>
presets/cards.json
presets/decks.json
presets/scenes/<mapa>.json
```

O manifesto externo contém o catálogo de assets canônicos, aliases legados e os caminhos dos manifests/presets. Os JSONs privados usam `assetId` em vez de uma URL física. Arquivos de conteúdo idêntico compartilham o mesmo ID `sha256:<hash>` e um único binário em `assets/`.

O fluxo no painel é:

1. **Selecionar pack** lê a pasta e persiste manifests, presets e aliases no armazenamento do navegador.
2. **Enviar ao Owlbear** usa `OBR.assets.uploadImages` para copiar os arquivos canônicos para a biblioteca privada do usuário.
3. **Vincular assets** usa `OBR.assets.downloadImages(true, ...)`; o usuário seleciona os assets e a extensão persiste o mapa `assetId → ImageContent` retornado pelo Owlbear.
4. Bibliotecas, criação de cenas no Atlas e o reparo de cenas antigas passam a resolver IDs e aliases para essas URLs do Owlbear.

O SDK `3.1.0` retorna `Promise<void>` em `uploadImages`: o upload não informa o ID/URL criado. Por isso, envio e vínculo são duas ações separadas. O vínculo persiste no `localStorage` da origem da extensão; outro navegador, perfil ou origem precisa selecionar os assets novamente. Os binários permanecem na conta do usuário no Owlbear mesmo se a configuração local do pack for removida.

Para gerar um pack a partir de uma árvore privada compatível com o layout histórico, use um destino fora deste repositório:

```powershell
npm run build:private-asset-pack -- --source <raiz-privada> --output <novo-pack> --previous <pack-anterior>\private-asset-pack.json
npm run check:private-asset-pack -- --pack <novo-pack>
npm run optimize:private-asset-pack -- --source-pack <novo-pack> --output <runtime-pack-v2>
npm run check:private-asset-pack -- --pack <runtime-pack-v2>
```

O gerador canônico copia os bytes originais, calcula SHA-256 e não recomprime imagens. O otimizador é uma segunda etapa: nunca altera a fonte, mantém o `assetId` lógico e registra o hash da representação runtime em `blobSha256`. `--previous` preserva aliases do pack anterior cujo hash canônico ainda exista. Cenas, ordem de cartas, IDs, tamanhos, camadas e metadados continuam sendo contratos de compatibilidade.

## Versão pública e cache

O cache busting é manual. Alterações em JavaScript, HTML, CSS, manifesto ou background precisam seguir as regras de versão e cache descritas em [PROJECT_RULES.md](PROJECT_RULES.md). Não incremente versão ou parâmetros de cache em uma alteração exclusivamente documental.

Na preparação final da versão `1.0.0`, o valor público adotado foi `v=101`. O mesmo valor invalida manifesto, entradas HTML, bundles, carregamento alternativo do SDK, estilos, ícones e URLs públicas montadas pelo background. Não altere caminhos ou IDs ao incrementar esse parâmetro em versões futuras.

Antes de uma publicação futura, confirme que:

- `npm run check` e `npm run build` passam;
- `dist/` está atualizado;
- o manifesto usa caminhos `/Double-Sided-Cards/...`;
- versão e parâmetros de cache foram decididos em conjunto;
- os quatro diretórios privados não existem no Core e o pack foi validado separadamente;
- a checklist manual relevante em [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md) foi executada no Owlbear Rodeo.

O repositório já está preparado para hospedagem estática na raiz pelo GitHub Pages, incluindo `.nojekyll`. Publicação, push e alteração da configuração do Pages não fazem parte das validações locais.

Quando houver uma etapa de publicação autorizada, a configuração documentada para o GitHub Pages é **Deploy from a branch**, usando a branch principal e a pasta `/`. Aguarde a atualização do Pages antes de validar o manifesto público.

## Compatibilidade e limites conhecidos

- Metadados de itens, cena e jogador são a fonte de verdade do estado de jogo.
- Campos desconhecidos de metadados devem ser preservados; dados essenciais não devem ser inventados sem fallback seguro.
- O Owlbear SDK não oferece transação distribuída completa entre itens e metadados. Filas e locks locais reduzem corridas, mas não eliminam todas as janelas entre contas.
- O GitHub Pages é estático e não grava novos arquivos em runtime.
- O Core não hospeda presets nem imagens privadas; sem pack, as bibliotecas e os mapas pessoais ficam vazios, mas a extensão continua carregando.
- URLs do Owlbear são obtidas exclusivamente pela seleção do usuário na API de assets e são persistidas por origem do navegador.
- O painel e o background rodam em contextos separados.
- A diferença intencional entre a versão pública e a pasta local está registrada em [PROJECT_RULES.md](PROJECT_RULES.md).

### Devolução simultânea entre clientes

Em uma condição de corrida rara, dois clientes tentando devolver simultaneamente a mesma instância de carta podem duplicar sua entrada na pilha.

- A operação normal de devolução permanece protegida por trava local, releituras e rollback condicional.
- O campo `returnedSceneItemId` fornece idempotência para retries e repetições locais da mesma instância.
- A janela residual exige concorrência distribuída, com clientes diferentes atualizando a mesma pilha praticamente ao mesmo tempo.
- O SDK não fornece uma transação distribuída ou compare-and-swap que elimine completamente essa janela.

## Documentação técnica

- [PROJECT_RULES.md](PROJECT_RULES.md): regras permanentes, compatibilidade e limites de escopo.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): estrutura, módulos e fluxos técnicos.
- [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md): decisões de produto e arquitetura que devem ser preservadas.
- [docs/AUDIT_HISTORY.md](docs/AUDIT_HISTORY.md): histórico detalhado das revisões técnicas.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): registro histórico do plano S-01 a S-20, já concluído.
- [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md): roteiro de validação manual e regressão.
- [CHANGELOG.md](CHANGELOG.md): histórico cronológico de mudanças relevantes.

Ao alterar o projeto, mantenha a documentação proporcional à mudança e registre fatos verificáveis. Não crie processos, infraestrutura ou garantias que o repositório não possui.
