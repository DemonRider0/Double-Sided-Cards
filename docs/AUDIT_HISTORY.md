# Audit History - Cartas Duplas

Este arquivo consolida auditorias realizadas durante o desenvolvimento. Use-o como historico tecnico e como entrada para planos de correcao.

## 2026-08-10 - Reprodutibilidade e higiene tecnica

### Auditado

- `package.json`, `package-lock.json`, arvore instalada, imports, scripts npm,
  `build.mjs`, `dev-server.mjs`, `scripts/`, `src/`, `dist/`, `.gitignore`,
  `.nojekyll`, arquivos tecnicos da raiz e manifests JSON gerados.
- A correspondencia entre fontes e bundles, a regeneracao das bibliotecas, a
  existencia dos assets referenciados e a ausencia de caminhos locais nos dois
  presets publicos foram verificadas sobre o estado atual do repositorio.
- As alteracoes estruturais anteriores foram preservadas; S-01 a S-20, UX,
  metadata, IDs, presets, assets e logica transacional nao foram reabertos.

### Inconsistencias encontradas e corrigidas

- `esbuild` estava declarado e instalado, mas nenhum fonte ou script o usava.
  A dependencia e suas entradas do lockfile foram removidas; Rollup e
  `@rollup/plugin-node-resolve` continuam sendo todo o ferramental do build.
- O projeto nao declarava a versao minima do Node, embora o servidor local use
  `fetch` nativo e o ferramental instalado exija Node moderno. `package.json`
  agora declara Node 18 ou superior.
- O build sobrescrevia os quatro bundles conhecidos, mas podia preservar
  arquivos obsoletos em `dist/`. A pasta gerada agora e limpa antes da escrita;
  erros continuam propagando codigo de saida diferente de zero.
- Os geradores de cartas e pilhas dependiam da localidade padrao da maquina para
  ordenar nomes e tratavam qualquer falha de leitura do manifest como arquivo
  ausente. A ordenacao foi fixada em `pt-BR`, e somente `ENOENT` inicia um
  manifest vazio; JSON corrompido ou erro de leitura agora interrompe o script.
- Nao havia um comando unico para repetir as verificacoes mecanicas basicas.
  `npm run check`, implementado apenas com Node padrao, valida sintaxe JS/MJS,
  JSONs, coerencia entre package e lockfile, conteudo esperado de `dist/`,
  assets das bibliotecas e URLs/assets dos mapas publicos.

### Verificacoes executadas

- `npm install` atualizou o lockfile e `npm ci` refez a instalacao limpa com 24
  pacotes instalados; `npm ls --all` nao encontrou dependencias ausentes ou
  extraneas.
- `npm run build:preset-decks` regenerou `decks.json` e `cards.json` sem alterar
  seus hashes ou deixar diff.
- `npm run build` removeu um artefato residual controlado, produziu somente os
  quatro bundles esperados e foi repetido duas vezes com hashes identicos. O
  primeiro resultado tambem coincidiu com os bundles distribuidos antes do
  teste.
- `npm run check` passou em 7 JSONs, 26 arquivos JS/MJS, 191 referencias de
  assets das bibliotecas e 1455 referencias de assets dos mapas. Isso inclui
  `node --check` em fontes, scripts, vendor e bundles.
- Os dois presets usam apenas `https://demonrider0.github.io`; nenhuma URL
  local, caminho absoluto ou referencia publica sem arquivo correspondente foi
  encontrada. `git diff --check` passou.

### Mantido deliberadamente

- `@owlbear-rodeo/sdk` 3.1.0, Rollup 4 e o plugin de resolucao permaneceram nas
  versoes ja travadas pelo lockfile; nao houve atualizacao ampla.
- `sdk-boot.js` e `sdk-client.js` parecem semelhantes, mas atendem ao bootstrap
  antecipado e ao fallback explicito do painel. `vendor/events.js` e usado pelo
  alias do build. Nenhum deles foi removido sem evidência de obsolescencia.
- As referencias a `localhost` e `.local-assets` em `dev-server.mjs` e nos
  ramos de deteccao/migracao sao parte do fluxo local intencional. A versao
  publica nao depende delas.
- `.gitignore` ja cobre `node_modules/`, `.npm-cache/`, `.local-assets/`, logs e
  backups; `.nojekyll` vazio e necessario para a hospedagem estatica. O backup
  local ignorado `assets/preset-decks/decks.json.bak` nao integra o repositorio
  e nao foi apagado sem confirmacao de que seja descartavel.
- A versao privada do pacote npm e a versao publica do manifesto continuam
  separadas. README, changelog, versao/cache publico e documentacao de autoria
  nao foram alterados nesta etapa.

### Limitacoes e divida residual

- `npm audit` informa duas ocorrencias moderadas da mesma vulnerabilidade em
  `uuid`, dependencia transitiva do SDK, sem correcao disponivel para a arvore
  atual. O SDK instalado importa apenas `v4`; o alerta reportado trata das APIs
  `v3`, `v5` e `v6` com buffer fornecido pelo chamador. O SDK foi mantido para
  preservar compatibilidade e evitar atualizacao fora de escopo.
- Os avisos conhecidos do Rollup sobre `this` no topo dos modulos do SDK
  continuam aparecendo, sem falha ou variacao nos bundles.
- Disponibilidade real das URLs por rede, integracao no Owlbear, mobile e duas
  contas continuam dependendo de ambiente real. Nenhum teste manual no Owlbear
  foi considerado realizado.

## 2026-08-07 - Revisao de maturidade tecnica e estrutura

### Analisado

- Fronteiras e dependencias dos modulos, tamanho e responsabilidade das funcoes,
  duplicacao, caminhos mortos, estado global, listeners, leituras do SDK,
  normalizacao, tratamento de erros e fluxo de build.
- `app.js`, `background.js`, `card-data.js`, `deck.js`, `selection-board.js` e
  `scene-preset.js` foram tratados como areas criticas; S-01 a S-20 nao foram
  reabertos sem evidencia de regressao.

### Alterado

- O caminho de importacao manual local, inalcancavel no HTML da versao publica,
  foi removido de `app.js`. O fonte caiu de 2474 para 1888 linhas e o bundle do
  painel de 197742 para 178972 bytes, sem remover controles publicos.
- A memoria de selecao do painel passou a classificar cartas e pilhas depois de
  uma unica leitura dos itens, eliminando a busca duplicada no SDK.
- A normalizacao e leitura de assets repetida entre as bibliotecas de cartas e
  pilhas foi centralizada em `preset-assets.js`, mantendo paths, camadas,
  dimensoes, MIME e mensagens existentes.

### Adequado e mantido intacto

- As responsabilidades transacionais de `deck.js`, `selection-board.js` e
  `scene-preset.js` continuam extensas, mas a complexidade observada corresponde
  a locks, releituras, verificacoes e rollbacks necessarios. Simplifica-las agora
  elevaria o risco sem beneficio concreto demonstrado.
- Metadata, IDs, presets, contratos de compatibilidade, comandos, atalhos, UX,
  assets, dependencias, manifesto e versionamento nao foram alterados.

### Risco deliberadamente adiado

- `app.js` ainda concentra o fluxo de migracao/publicacao de assets alem da UI e
  das bibliotecas. Uma separacao adicional exige validacao de Canvas, rede,
  servidor local e mutacoes reais de cena; por isso deve ser uma etapa futura
  especifica, com teste manual no Owlbear, se essa manutencao for priorizada.
- Nenhum teste manual no Owlbear foi considerado realizado nesta revisao.

### Validacao automatica

- `node --check` nos fontes e bundles, verificacoes focadas dos presets e dos
  seletores do painel, `npm.cmd run build` e `git diff --check` passaram.
- O build manteve apenas os avisos conhecidos do SDK sobre `this` no topo de
  modulos ES. `dist/app.js` foi regenerado pelo processo normal de build.

## 2026-07-13 - Auditoria geral de qualidade

### Resumo

A auditoria geral avaliou performance, arquitetura, codigo, seguranca, boas praticas, escalabilidade, dependencias e manutenibilidade. A conclusao foi que o projeto esta funcional e relativamente bem separado por dominio, mas carrega riscos naturais de extensoes Owlbear baseadas em metadados compartilhados.

### Pontos gerais encontrados

| ID | Descricao | Impacto | Prioridade | Situacao em 2026-07-13 |
| --- | --- | --- | --- | --- |
| G-01 | `src/app.js` concentra muitas responsabilidades de UI, assets, presets e acoes. | Medio | Media | Pendente |
| G-02 | `assets/local-assets/` contem muitas imagens pesadas e duplicadas. | Alto em mobile/Git | Alta | Parcialmente tratado em otimizacoes anteriores, ainda requer limpeza cuidadosa |
| G-03 | O projeto depende de cache busting manual no manifesto e URLs. | Medio | Media | Pendente |
| G-04 | Metadados antigos/incompletos podem passar por validadores permissivos. | Medio | Alta | Pendente |
| G-05 | Operacoes SDK dentro de fluxos complexos podem deixar estado parcial se falharem. | Alto | Alta | Pendente |
| G-06 | Documentacao tecnica era insuficiente para continuidade entre sessoes. | Medio | Alta | Corrigido pela pasta `docs/` e consolidado em `CONTRIBUTING_AI.md` |
| G-07 | Publico e local exigem disciplina manual para nao misturar recursos. | Medio | Alta | Mitigado por `PROJECT_RULES.md` e docs |
| G-08 | Restauracao de mapas atua em muitos itens e precisa ser tratada como area de risco. | Alto | Alta | Pendente |
| G-09 | Registros repetidos de comandos podem gerar lentidao ou botoes inconsistentes. | Medio | Media | Pendente |
| G-10 | Testes manuais ainda sao a principal forma de validacao. | Medio | Alta | Pendente |

## 2026-07-13 - Auditoria especializada Owlbear/metadados

### Escopo

A auditoria especializada analisou bugs reais de uso no Owlbear:

- consistencia de cartas e pilhas;
- corridas multiplayer;
- metadados orfaos;
- restauracao de cena;
- selecao por cor;
- mobile;
- chamadas caras do SDK;
- codigo legado.

### Problemas encontrados

| ID | Descricao | Impacto | Prioridade | Situacao em 2026-07-13 |
| --- | --- | --- | --- | --- |
| S-01 | Compra concorrente pode duplicar a carta do topo se dois fluxos usam metadata antiga. | Alto para jogadores; alto para mestre | Critica | Pendente |
| S-02 | Compra pode remover carta da pilha e falhar ao adicionar a carta sacada. | Alto | Critica | Pendente |
| S-03 | Devolucao pode duplicar carta se a pilha for atualizada e `deleteItems` falhar. | Alto | Critica | Pendente |
| S-04 | A mesma carta pode ser devolvida duas vezes em operacoes simultaneas. | Alto | Alta | Pendente |
| S-05 | Compra e embaralhamento simultaneos podem sobrescrever ordem. | Medio/alto | Alta | Pendente |
| S-06 | `flipSelectedItems` pode usar fallback antigo antes da selecao atual. | Medio | Alta | Pendente |
| S-07 | Criar pilha de missao pode duplicar cartas se adicionar pilha e falhar ao apagar originais. | Alto | Alta | Pendente |
| S-08 | Pilha de missao pode perder versos individuais ao usar um unico verso de pilha. | Medio | Media | Pendente |
| S-09 | Restaurar mapa pode deixar cena parcialmente destruida em falha intermediaria. | Alto | Critica | Pendente |
| S-10 | Dois usuarios restaurando mapa simultaneamente podem conflitar. | Alto | Alta | Pendente |
| S-11 | Dois jogadores podem tentar assumir a mesma cor em corrida. | Medio | Alta | Pendente |
| S-12 | Dois jogadores podem mover a mesma raca/classe/divindade ao mesmo tempo. | Medio/alto | Alta | Pendente |
| S-13 | `Devolver origem` pode deixar metadata de slot orfa se update do item e da cena divergirem. | Medio | Media | Pendente |
| S-14 | Marcacoes locais de cor/categoria podem criar metadata parcial. | Medio | Media | Pendente |
| S-15 | Deteccao por texto pode classificar cor errada por substring em nome/URL. | Medio | Media | Pendente |
| S-16 | Multiselecao pode acionar auto-place na primeira imagem por engano. | Medio | Media | Pendente |
| S-17 | Reparo de URLs usa clone raso e pode mutar metadata fora de `updateItems`. | Medio | Alta | Pendente |
| S-18 | Registro repetido de comandos pode causar lentidao e inconsistencias apos F5. | Medio | Alta | Pendente |
| S-19 | Atualizacao frequente de `Jogadores e cores` pode pesar no mobile. | Baixo/medio | Media | Pendente |
| S-20 | Validadores aceitam metadata antiga/incompleta, causando grid/dimensoes invalidas. | Medio | Alta | Pendente |

## 2026-07-17 - Encerramento do plano de correcoes S-01 a S-20

As situacoes `Pendente` acima registram o estado original da auditoria em 13 de
julho de 2026. Depois da implementacao em oito etapas e da aprovacao dos testes
manuais no Owlbear Rodeo, a situacao final e:

| ID | Etapa responsavel | Situacao final | Observacao ou risco residual |
| --- | --- | --- | --- |
| S-01 | Etapa 3 | Concluido e validado manualmente | Filas e releituras mitigam compras concorrentes; nao existe atomicidade absoluta entre contas. |
| S-02 | Etapa 3 | Concluido e validado manualmente | Criacao da carta e rollback condicional preservam a pilha; alteracoes posteriores nao sao sobrescritas. |
| S-03 | Etapa 4 | Concluido e validado manualmente | Rollback condicional reduz duplicacao; falhas concorrentes respeitam o estado mais recente. |
| S-04 | Etapa 4 | Concluido e validado manualmente | Trava por carta e releituras mitigam devolucao dupla; a trava atua por instancia. |
| S-05 | Etapas 3 e 4 | Concluido e validado manualmente | Compra, devolucao e embaralhamento compartilham coordenacao local; nao ha transacao distribuida entre contas. |
| S-06 | Etapa 1 | Concluido e validado manualmente | A selecao atual prevalece e fallback antigo nao age sobre selecao atual valida. |
| S-07 | Etapa 5 | Concluido e validado manualmente | Criacao e reconciliacao preservam cada carta uma vez; simultaneidade entre contas mantem janela residual do SDK. |
| S-08 | Etapa 5 | Concluido e validado manualmente | Versos e dados individuais das cartas sao preservados na pilha de missao. |
| S-09 | Etapa 7 | Concluido e validado manualmente | Ordem segura, verificacao final e rollback condicional reduzem cenas parciais. |
| S-10 | Etapa 7 | Concluido e validado manualmente | Marcador de restauracao coordena contas, mas e consultivo e nao oferece compare-and-swap. |
| S-11 | Etapa 6 | Concluido e validado manualmente | Revalidacao reduz disputa de cor; locks locais nao garantem exclusao absoluta entre contas. |
| S-12 | Etapa 6 | Concluido e validado manualmente | Reservas e releituras protegem slots; permanece uma pequena janela distribuida. |
| S-13 | Etapa 6 | Concluido e validado manualmente | `Devolver origem` usa reconciliacao localizada e preserva mudancas posteriores. |
| S-14 | Etapa 6 | Concluido e validado manualmente | Marcacoes validam valores e preservam campos desconhecidos de metadata. |
| S-15 | Etapa 1 | Concluido e validado manualmente | Metadata explicita e sinais inequivocos substituem classificacao ambigua por substring. |
| S-16 | Etapa 1 | Concluido e validado manualmente | Auto-place exige exatamente um item elegivel. |
| S-17 | Etapa 2 | Concluido e validado manualmente | Inspecao de URL e pura; mutacao ocorre somente pelo fluxo oficial de atualizacao. |
| S-18 | Etapa 2 | Concluido e validado manualmente | Solicitacoes de registro sao agrupadas sem bloquear recuperacao apos F5 ou falha. |
| S-19 | Etapa 1 | Concluido e validado manualmente | Atualizacao por eventos com debounce substitui polling frequente. |
| S-20 | Etapa 8 | Concluido e validado manualmente | Normalizacao conservadora preserva dados; metadata sem fallback seguro tem a operacao recusada. |

### Consolidacao dos problemas gerais G-01 a G-10

| ID | Situacao consolidada | Evidencia ou risco residual |
| --- | --- | --- |
| G-01 | Pendente | `src/app.js` ainda concentra UI, assets, presets e acoes. |
| G-02 | Parcial | Otimizacoes anteriores reduziram parte do impacto, mas assets grandes continuam exigindo trabalho especifico. |
| G-03 | Pendente | Cache busting continua manual. |
| G-04 | Tratado | A Etapa 8 introduziu normalizacao conservadora de metadata em leitura. |
| G-05 | Amplamente mitigado | Etapas 3, 4, 5, 6 e 7 adicionaram filas, releituras, verificacoes e rollbacks; o SDK continua sem transacoes distribuidas completas. |
| G-06 | Concluido | A documentacao permanente em `docs/` e o guia de contribuicao registram arquitetura, regras e historico. |
| G-07 | Mitigado | `PROJECT_RULES.md` e a documentacao preservam as diferencas entre as versoes publica e local. |
| G-08 | Tratado | A Etapa 7 tornou a restauracao mais segura; o marcador permanece consultivo pelas limitacoes do SDK. |
| G-09 | Tratado | A Etapa 2 agrupou registros e preservou a recuperacao de comandos. |
| G-10 | Pendente/estrutural | Testes integrados ainda dependem principalmente do Owlbear real, de duas contas e de mobile. |

## Situacao consolidada

| Categoria | Status geral |
| --- | --- |
| Funcionalidades principais | S-01 a S-20 concluidos e validados manualmente; riscos residuais permanecem documentados. |
| Mobile | Validado no fechamento do plano; ainda sensivel ao peso de assets grandes. |
| Multiplayer | Validado em uso normal e com duas contas; sem atomicidade distribuida absoluta no SDK. |
| Documentacao | Consolidada na pasta `docs/`; deve ser mantida junto com futuras mudancas. |
| Build/publicacao | Funciona por GitHub Pages, com cache busting manual. |

## Observacao importante

O encerramento de S-01 a S-20 nao torna o sistema infalivel. Locks e filas em
memoria atuam por instancia; o marcador de restauracao e consultivo; rollbacks
podem ser recusados para preservar mudancas posteriores; metadata sem fallback
seguro nao e inventada; nao existe migracao automatica em massa; cache busting
continua manual; testes integrados dependem do Owlbear; e assets grandes
continuam sendo uma area separada de performance.
