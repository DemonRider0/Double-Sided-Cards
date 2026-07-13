# Changelog AI - Cartas Duplas

Este changelog registra alteracoes realizadas com auxilio de IA. Ele deve ser atualizado em futuras implementacoes, auditorias ou documentacoes.

## 2026-07-13 - Correcao da regressao de compra da Etapa 3

### Sessao

Correcao pontual da regressao critica encontrada nos testes manuais da Etapa 3. Ao comprar qualquer carta, a extensao mostrava "Nao consegui criar a carta; a pilha foi restaurada." e a carta nao aparecia na cena.

### Arquivos modificados

- `src/deck.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Causa tecnica

O item da carta comprada estava sendo montado dentro da callback de `OBR.scene.items.updateItems`. O SDK do Owlbear usa Immer nessa callback; por isso, partes da metadata da carta capturavam objetos de rascunho. Quando `addItems` tentava serializar o item depois da callback, a referencia ja estava revogada.

A simulacao permissiva anterior nao detectou o erro porque o mock nao usava o mesmo ciclo de vida de rascunho do SDK e aceitava qualquer objeto em `addItems`.

### Correcao aplicada

- A callback de `updateItems` agora calcula apenas dados clonados e serializaveis da carta comprada.
- O item real enviado a `addItems` e criado fora do rascunho do SDK.
- Foi adicionado log tecnico objetivo para diferenciar falha de montagem do item, falha de `addItems`, falha de rollback e falha ao apagar pilha temporaria.
- O rollback da Etapa 3 foi preservado.
- A trava local por pilha foi preservada.

### Testes executados

- Simulacao local com `produceWithPatches` do Immer reproduzindo o erro original `TypeError: Cannot perform 'get' on a proxy that has been revoked`.
- Simulacao local corrigida validando que `addItems` recebe array com exatamente um item `IMAGE`, serializavel e com metadata de carta.
- `node --check` em `src/deck.js`.
- `npm.cmd run build`.
- Verificacoes de sintaxe nos arquivos principais e bundles.
- `git diff --check`.
- Buscas por `localhost`, `127.0.0.1`, caminhos absolutos do Windows, chamadas de `addItems`, comandos e atalhos.

### Testes manuais pendentes

- Teste minimo: comprar uma carta de pilha comum, confirmar que aparece, contador diminui em um, virar a carta, devolver com `R` e confirmar retorno ao fundo.
- Se o teste minimo passar: repetir compra pelo menu, por `C`, compras rapidas, compra e embaralhamento, pilha em frente e verso, pilha temporaria, duas contas e mobile.

### Observacoes

- A Etapa 3 permanece `Em teste`.
- A Etapa 4 nao foi iniciada.
- A versao/cache publico foi atualizado de `0.2.63`/`v=63` para `0.2.64`/`v=64`.

## 2026-07-13 - Etapa 3: compra de pilha robusta

### Sessao

Implementacao da Etapa 3 do plano oficial de correcoes, limitada a S-01, S-02 e a parte de S-05 sobre concorrencia local entre compra e embaralhamento.

O mantenedor informou que os testes manuais pendentes das Etapas 1 e 2 foram aprovados no Owlbear Rodeo. Por isso, `docs/IMPLEMENTATION_PLAN.md` foi atualizado para marcar as Etapas 1 e 2 como `Concluido`.

### Arquivos modificados

- `src/deck.js`
- `src/background.js`
- `src/app.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Diagnostico

- S-01: `drawFromDecks` calculava a carta comprada a partir dos itens recebidos pelo chamador. Esse snapshot podia estar antigo em cliques rapidos ou chamadas simultaneas locais.
- S-02: a pilha podia ser atualizada removendo a carta antes de `addItems`; se a criacao da carta falhasse, nao havia rollback conservador.
- S-05 parcial: compra e embaralhamento locais da mesma pilha podiam atualizar a lista usando snapshots diferentes.
- O contrato instalado do Owlbear SDK mostra que `updateItems` gera patches a partir dos itens obtidos/recebidos, mas nao documenta transacao distribuida entre clientes, nem atomicidade entre `updateItems`, `addItems` e `deleteItems`.

### Solucao aplicada

- S-01: compra agora usa uma fila local curta por ID de pilha e rele a pilha dentro de `OBR.scene.items.updateItems([deckId], ...)` antes de escolher o topo.
- S-02: se `addItems` falhar depois da pilha ser atualizada, a extensao rele a pilha e devolve a carta ao topo somente se a lista ainda corresponder ao estado pos-compra esperado.
- S-02: pilha temporaria vazia so e apagada depois de a carta comprada ser criada com sucesso. Se a remocao da pilha falhar, a carta permanece e a pilha vazia pode ser limpa depois.
- S-05 parcial: embaralhamento usa a mesma fila local por pilha, evitando escrita local simultanea entre compra e embaralhamento.

### Estrategia de trava

A trava e local, em memoria, por ID de pilha. Ela impede duplo clique rapido e chamadas concorrentes do mesmo cliente sobre a mesma pilha, mas nao bloqueia outras pilhas e e sempre liberada em `finally`.

### Estrategia de rollback

O rollback compara a lista atual da pilha com a lista pos-compra esperada. Se corresponder, a carta removida e recolocada no topo preservando campos desconhecidos da metadata atual. Se nao corresponder, o rollback automatico e abortado para nao sobrescrever compra, embaralhamento, devolucao ou alteracao feita por outro jogador.

### Riscos

- A trava nao e distribuida entre contas. Duas contas ainda dependem das garantias reais do Owlbear e precisam ser testadas manualmente.
- Se `addItems` falhar e outro cliente alterar a pilha antes do rollback, a extensao preserva o estado mais recente e reporta falha parcial.
- Se `deleteItems` falhar apos comprar a ultima carta de uma pilha temporaria, a carta nao e apagada; a pilha pode ficar vazia ate a sincronizacao posterior ou limpeza manual.

### Testes executados

- Simulacoes locais de compra simples, cliques rapidos, rollback por falha em `addItems`, pilha temporaria, face da pilha e compra versus embaralhamento local.
- `node --check` em `src/deck.js` e `src/background.js`.
- `npm.cmd run build`.
- `node --check` nos arquivos principais apos build.
- `git diff --check`.
- `git diff --stat`.
- Buscas por `localhost`, `127.0.0.1`, caminhos absolutos do Windows, `.local-assets`, IDs de comandos e chamadores de compra/embaralhamento.

### Testes manuais pendentes

- Comprar pelo botao, menu e atalho `C`.
- Comprar rapidamente pelo botao e pelo atalho.
- Comprar e embaralhar rapidamente com `C` e `E`.
- Comprar a ultima carta de pilha temporaria.
- Testar duas contas comprando ou embaralhando a mesma pilha quase ao mesmo tempo.
- Repetir em mobile.

### Observacoes

- A Etapa 3 foi marcada como `Em teste`, nao como concluida.
- A Etapa 4 nao foi iniciada.
- S-03 e S-04 nao foram implementados.
- A versao/cache publico foi atualizado de `0.2.62`/`v=62` para `0.2.63`/`v=63`.

## 2026-07-13 - Etapa 2: registro de comandos e reparo seguro de URLs

### Sessao

Implementacao da Etapa 2 do plano oficial de correcoes, limitada a S-17 e S-18.

### Arquivos modificados

- `src/background.js`
- `src/app.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Diagnostico

- S-17: a deteccao de itens reparaveis usava `repairSceneAssetUrlsForItem({ ...item })`; esse clone era raso e mantinha `metadata` compartilhado com o item original retornado pelo SDK.
- S-18: o registro de comandos era serializado por promise, mas cada gatilho ainda executava um registro completo. Inicializacao, mensagens do painel, retries, foco e visibilidade podiam enfileirar registros repetidos.

### Solucao aplicada

- S-17: o reparo de URLs passou a calcular patches puros com `getSceneAssetUrlRepair`; a mutacao final fica restrita a `applySceneAssetUrlRepair`, chamado dentro de `OBR.scene.items.updateItems`.
- S-18: o registro de comandos passou a usar fila pequena com debounce, coalescencia de solicitacoes e protecao contra registros concorrentes.
- S-18: os retries automaticos apos carregamento foram reduzidos de quatro para dois pontos espaçados, preservando uma tentativa inicial imediata e recuperacao tardia.

### Riscos

- O fluxo de reparo continua dependendo dos mesmos criterios de URL anteriores; exemplos antigos muito especificos devem ser validados visualmente no Owlbear.
- A reducao de retries precisa ser validada com F5 e reabertura de painel em desktop, mobile e segunda conta.
- Falhas parciais internas de criacao de comandos ainda sao registradas por warning nos helpers atuais, preservando o comportamento anterior.

### Testes executados

- `npm.cmd run build`.
- `node --check` nos arquivos principais alterados.
- `git diff --check`.
- `git diff --stat`.
- Buscas por `localhost`, `127.0.0.1`, caminhos absolutos do Windows e cache/versionamento.
- Buscas por IDs e atalhos dos comandos.
- Simulacoes locais de reparo puro de URL e de coalescencia da fila de registro.

### Testes manuais pendentes

- Confirmar comandos apos abrir a extensao, abrir/fechar painel e dar F5.
- Confirmar ausencia de duplicacao visual de comandos.
- Confirmar atalhos `V`, `C`, `E` e `R`.
- Confirmar reparo de URL em um item antigo seguro.
- Repetir em segunda conta e mobile.

### Observacoes

- A Etapa 2 foi marcada como `Em teste`, nao como concluida.
- A Etapa 1 permaneceu `Em teste`.
- Nenhuma Etapa 3 ou posterior foi iniciada.
- A versao/cache publico foi atualizado de `0.2.61`/`v=61` para `0.2.62`/`v=62`.

## 2026-07-13 - Revisao tecnica de fechamento da Etapa 1

### Sessao

Revisao tecnica da Etapa 1 apos testes manuais provisoriamente aprovados pelo mantenedor.

### Arquivos modificados

- `src/flip.js`
- `src/selection-board.js`
- `src/background.js`
- `src/app.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Problemas corrigidos

- S-06: `flipSelectedItems` deixou de acionar fallback antigo quando a selecao atual existe, mas nao contem carta ou pilha viravel.
- S-15: a deteccao textual de cor deixou de atuar sobre cartas, pilhas ou itens categorizados; metadados explicitos de cor continuam sendo priorizados.

### Riscos

- Cenas antigas que tenham usado uma carta dupla sem metadata de cor como identificador textual podem precisar receber metadata explicita de identificador de cor.
- Como houve ajuste no fluxo de virar e de deteccao de cor, os testes manuais de S-06 e S-15 devem ser repetidos antes de marcar a etapa como concluida.

### Testes executados

- Revisao dos chamadores de `flipSelectedItems`.
- Inspecao dos presets `tutorial.json` e `missao-0-5.json` para confirmar que os identificadores de cor atuais usam metadata explicita.
- `npm.cmd run build`.
- Validacoes de sintaxe e buscas por referencias locais indevidas.
- `git diff --check`.

### Observacoes

- A Etapa 1 permanece `Em teste` ate a repeticao dos testes manuais afetados por esta revisao.
- A versao/cache publico foi atualizado de `0.2.60`/`v=60` para `0.2.61`/`v=61`.

## 2026-07-13 - Etapa 1: selecao e acoes sem estado complexo

### Sessao

Implementacao da Etapa 1 do plano oficial de correcoes.

### Arquivos modificados

- `src/flip.js`
- `src/selection-board.js`
- `src/background.js`
- `src/app.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Problemas corrigidos

- S-06: `flipSelectedItems` agora prioriza a selecao atual do Owlbear antes de usar fallback antigo.
- S-15: a deteccao textual de cor foi restringida para sinais explicitos em nome, descricao ou texto do item; URLs deixam de ativar cor por substring.
- S-16: o auto-place de raca, classe e divindade passa a exigir exatamente uma imagem selecionada.
- S-19: a atualizacao de `Jogadores e cores` deixou de usar intervalo fixo de 2,5 segundos e passou a usar atualizacao por eventos com debounce curto.

### Riscos

- Identificadores de cor antigos que dependiam exclusivamente de URL sem metadata podem deixar de ativar cor automaticamente. Metadados explicitos continuam funcionando e sao a fonte de verdade.
- A atualizacao de `Jogadores e cores` depende dos eventos `player.onChange` e `party.onChange`; precisa ser validada em duas contas reais.
- Testes reais no Owlbear ainda sao necessarios para confirmar atalhos, botoes e mobile.

### Testes executados

- `npm.cmd run build`
- `node --check` nos arquivos principais alterados e dependencias diretas relevantes.
- Busca por referencias a `localhost`, `127.0.0.1`, `.local-assets` e caminhos absolutos do Windows fora de `node_modules`, `dist` e `assets/local-assets`.
- Revisao do diff para confirmar que compra, devolucao, embaralhamento, mapas, presets e assets nao foram alterados deliberadamente.

### Observacoes

- `npm run build` via `npm.ps1` falhou por politica local de execucao do PowerShell; o mesmo script foi executado com sucesso via `npm.cmd run build`.
- O build exibiu warnings conhecidos do SDK do Owlbear sobre `this` no topo de modulos ES, sem falhar.
- O build reprocessou os bundles; `dist/app.js` e `dist/background.js` tiveram diferenca de conteudo, enquanto `dist/sdk-boot.js` e `dist/sdk-client.js` permaneceram sem diff.
- A versao/cache publico foi atualizado de `0.2.59`/`v=59` para `0.2.60`/`v=60` conforme regra de build e cache.
- A Etapa 1 foi marcada como `Em teste`, nao como concluida, porque ainda faltam testes manuais no Owlbear, mobile e duas contas.
- `docs.zip` ja estava nao rastreado no inicio desta execucao e nao foi alterado.

## 2026-07-13 - Consolidacao final da documentacao

### Sessao

Consolidacao final da documentacao permanente.

### Arquivos modificados

- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/AUDIT_HISTORY.md`
- `docs/CHANGELOG_AI.md`
- `docs/CONTRIBUTING_AI.md`

### Problemas corrigidos

- Inconsistencia no fluxo documentado de restauracao de mapas.
- Falta de um guia operacional definitivo para futuras IAs.
- Falta de uma ordem oficial de leitura da documentacao.

### Riscos

- Nenhum risco funcional direto, pois apenas documentacao foi alterada.

### Testes executados

- Revisao da estrutura de `docs/`.
- Conferencia do fluxo real de restauracao em `src/scene-preset.js`.
- Conferencia de que a alteracao ficou restrita a documentacao.

### Observacoes

- Nenhum arquivo de codigo, asset, build ou manifesto foi alterado nesta sessao.

## 2026-07-13 - Documentacao inicial

### Sessao

Criacao da documentacao permanente do projeto.

### Arquivos modificados

- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN_DECISIONS.md`
- `docs/AUDIT_HISTORY.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/TEST_CHECKLIST.md`
- `docs/CHANGELOG_AI.md`

### Problemas corrigidos

- Ausencia de documentacao tecnica centralizada.
- Falta de uma fonte unica de contexto para futuras manutencoes.
- Falta de consolidacao formal das auditorias anteriores.
- Falta de checklist de testes por funcionalidade.

### Riscos

- Documentacao pode ficar desatualizada se mudancas futuras nao atualizarem `docs/`.
- Os itens de auditoria foram consolidados a partir do estado conhecido do projeto e devem ser reavaliados apos grandes refatoracoes.

### Testes executados

- Conferencia da estrutura atual do projeto.
- Conferencia de `package.json`, `manifest.json`, `README.md` e `PROJECT_RULES.md`.
- Conferencia dos modulos presentes em `src/`.

### Observacoes

- Nenhum arquivo de codigo da extensao foi alterado nesta sessao.
- Nenhum build foi executado porque a mudanca e exclusivamente documental.
