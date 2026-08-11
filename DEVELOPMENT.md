# Desenvolvimento e manutenção

Este documento reúne as instruções operacionais do projeto Cartas Duplas. A documentação pública de uso fica em [README.md](README.md); regras permanentes e contratos de compatibilidade ficam em [PROJECT_RULES.md](PROJECT_RULES.md).

## Estado e identidade do projeto

- Nome público: **Cartas Duplas**.
- Repositório público: `Double-Sided-Cards`.
- Plataforma: Owlbear Rodeo.
- Hospedagem pública: GitHub Pages.
- Autoria: DemonRider.
- Manifesto público atual: `https://demonrider0.github.io/Double-Sided-Cards/manifest.json?v=69`.
- Versão pública atual no manifesto: `0.2.69`.

`package.json` identifica o pacote privado de desenvolvimento como `0.1.0`, enquanto `manifest.json` identifica a versão pública como `0.2.69`. Essa diferença foi preservada deliberadamente. Ela deve ser resolvida somente quando houver uma decisão sobre a próxima versão pública; não deve ser normalizada automaticamente para `1.0.0`.

A descrição atual de `manifest.json` é mais antiga e mais estreita que a apresentação pública do README. Ela foi mantida porque esta etapa não altera o manifesto; sua revisão deve ocorrer junto da próxima decisão de versão e cache.

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
| `assets/preset-cards/` | Biblioteca de cartas e seu manifest gerado. |
| `assets/preset-decks/` | Biblioteca de pilhas e seu manifest gerado. |
| `assets/scene-presets/` | Mapas públicos restauráveis e seu índice. |
| `scripts/` | Validação e preparação dos manifests e assets. |
| `manifest.json` | Entrada pública da extensão e versão pública. |
| `index.html` / `background.html` | Entradas do painel e do contexto de background. |

A arquitetura e os fluxos entre módulos estão detalhados em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Comandos disponíveis

| Comando | Finalidade |
| --- | --- |
| `npm run check` | Valida sintaxe, JSONs, package/lockfile, bundles, bibliotecas e referências dos mapas. |
| `npm run build` | Gera os quatro bundles esperados em `dist/`. |
| `npm run build:preset-decks` | Regenera `decks.json` e, em seguida, `cards.json`. |
| `npm run build:preset-cards` | Regenera somente `cards.json`. |
| `npm run build:scene-presets` | Regenera o índice dos mapas públicos. |
| `npm run audit:assets` | Produz o inventário técnico dos assets usado nas auditorias. |
| `npm run prepare:github-assets` | Prepara assets locais para uso pela versão pública. |
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

## Bibliotecas de cartas e pilhas

### Cartas

As cartas individuais ficam em `assets/preset-cards/`. Cada grupo usa `Verso.png` como verso padrão; uma carta pode usar um verso próprio com o nome da frente seguido de ` verso`, como `Thwor.png` e `Thwor verso.png`.

Depois de alterar as imagens ou a configuração das cartas, execute:

```powershell
npm run build:preset-cards
npm run build
```

### Pilhas

As pilhas ficam em `assets/preset-decks/`. A convenção de verso é `Verso.png`. Depois de alterar imagens ou configuração, execute:

```powershell
npm run build:preset-decks
npm run build
```

Os manifests gerados são fontes públicas da extensão. IDs, tamanhos, camadas, ordem de cartas e formatos persistidos não devem ser alterados como parte de uma limpeza documental.

## Mapas salvos e assets locais

Os mapas publicados ficam em `assets/scene-presets/`. O painel público restaura esses arquivos, mas não os grava no GitHub Pages. A preparação ou atualização de mapas deve ser feita pelo fluxo local, preservando os IDs, metadados e URLs necessários à compatibilidade.

Assets incorporados a partir de uma preparação local ficam em `assets/local-assets/`. Antes de publicar um mapa, confirme que ele não depende de `localhost`, `127.0.0.1`, caminhos absolutos do Windows ou arquivos fora do repositório.

Os mapas e as bibliotecas atuais são contratos de compatibilidade. Consulte [PROJECT_RULES.md](PROJECT_RULES.md) antes de modificar qualquer um deles.

## Versão pública e cache

O cache busting é manual. Alterações em JavaScript, HTML, CSS, manifesto ou background precisam seguir as regras de versão e cache descritas em [PROJECT_RULES.md](PROJECT_RULES.md). Não incremente versão ou parâmetros de cache em uma alteração exclusivamente documental.

Antes de uma publicação futura, confirme que:

- `npm run check` e `npm run build` passam;
- `dist/` está atualizado;
- o manifesto usa caminhos `/Double-Sided-Cards/...`;
- versão e parâmetros de cache foram decididos em conjunto;
- os assets e mapas públicos não contêm dependências locais;
- a checklist manual relevante em [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md) foi executada no Owlbear Rodeo.

O repositório já está preparado para hospedagem estática na raiz pelo GitHub Pages, incluindo `.nojekyll`. Publicação, push e alteração da configuração do Pages não fazem parte das validações locais.

Quando houver uma etapa de publicação autorizada, a configuração documentada para o GitHub Pages é **Deploy from a branch**, usando a branch principal e a pasta `/`. Aguarde a atualização do Pages antes de validar o manifesto público.

## Compatibilidade e limites conhecidos

- Metadados de itens, cena e jogador são a fonte de verdade do estado de jogo.
- Campos desconhecidos de metadados devem ser preservados; dados essenciais não devem ser inventados sem fallback seguro.
- O Owlbear SDK não oferece transação distribuída completa entre itens e metadados. Filas e locks locais reduzem corridas, mas não eliminam todas as janelas entre contas.
- O GitHub Pages é estático e não grava novos arquivos em runtime.
- O painel e o background rodam em contextos separados.
- A diferença intencional entre a versão pública e a pasta local está registrada em [PROJECT_RULES.md](PROJECT_RULES.md).

## Documentação técnica

- [PROJECT_RULES.md](PROJECT_RULES.md): regras permanentes, compatibilidade e limites de escopo.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): estrutura, módulos e fluxos técnicos.
- [docs/DESIGN_DECISIONS.md](docs/DESIGN_DECISIONS.md): decisões de produto e arquitetura que devem ser preservadas.
- [docs/AUDIT_HISTORY.md](docs/AUDIT_HISTORY.md): histórico detalhado das revisões técnicas.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): registro histórico do plano S-01 a S-20, já concluído.
- [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md): roteiro de validação manual e regressão.
- [CHANGELOG.md](CHANGELOG.md): histórico cronológico de mudanças relevantes.

Ao alterar o projeto, mantenha a documentação proporcional à mudança e registre fatos verificáveis. Não crie processos, infraestrutura ou garantias que o repositório não possui.
