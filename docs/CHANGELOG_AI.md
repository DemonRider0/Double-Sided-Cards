# Changelog AI - Cartas Duplas

Este changelog registra alteracoes realizadas com auxilio de IA. Ele deve ser atualizado em futuras implementacoes, auditorias ou documentacoes.

## 2026-07-17 - Etapa 7: restauracao robusta de mapas

### Sessao

Implementacao da Etapa 7 do plano oficial de correcoes, limitada a S-09 e
S-10.

O mantenedor informou que todos os testes manuais da Etapa 6 foram aprovados no
Owlbear Rodeo, incluindo cores, slots, `Devolver origem`, duas contas, F5 e
mobile. A Etapa 6 foi marcada como `Concluido`.

### Diagnostico

- S-09: o fluxo anterior atualizava itens, apagava todos os extras, adicionava
  ausentes e gravava metadata sem verificacao final. Qualquer rejeicao podia
  deixar a cena parcialmente restaurada.
- S-09: `addItems`, `updateItems` e `deleteItems` retornam `Promise<void>`.
  Uma rejeicao nao informa se houve aplicacao parcial, exigindo releitura.
- S-09: o preset tinha apenas validacao estrutural minima. IDs duplicados,
  valores nao serializaveis, metadata invalida e URLs locais podiam chegar ao
  fluxo mutavel.
- S-09: nao havia rollback nem reconciliacao condicional.
- S-10: duas contas podiam restaurar o mesmo preset ou presets diferentes sem
  coordenacao, misturando itens e metadata.
- O SDK 3.1.0 nao oferece transacao distribuida ou compare-and-swap para a
  metadata da cena.

### Presets verificados

- `tutorial.json`: 221 itens, 623482 bytes, 187 imagens, 31 textos e 3 curvas.
- `missao-0-5.json`: 214 itens, 603468 bytes, 180 imagens, 31 textos e 3 curvas.
- Ambos possuem IDs unicos, metadata serializavel e apenas URLs HTTPS publicas.
- Os presets preservam origens historicas de cartas ausentes e uma referencia
  antiga do identificador branco. A verificacao exige os quatro identificadores
  explicitos presentes e referencias de slots ocupados, sem invalidar essas
  referencias historicas.

### Solucao aplicada

- Todo preset e validado antes de qualquer mutacao de itens: estrutura, contagem,
  IDs, serializacao, metadata de cartas/pilhas, slots ocupados, identificadores
  de cor e URLs publicas.
- A versao local continua podendo preparar mapas com referencias locais; a
  versao publica recusa `localhost`, `127.0.0.1`, `file:` e caminhos absolutos
  do Windows.
- Um plano serializavel separa itens a adicionar, atualizar, substituir e
  excluir, alem das chaves de metadata gerenciadas pelo preset.
- A ordem agora e: adquirir marcador, criar plano recente, adicionar ausentes,
  atualizar coincidentes, substituir tipos incompativeis, gravar metadata,
  excluir extras por ultimo e verificar novamente a cena completa.
- Itens extras sao relidos antes da exclusao e so sao apagados quando ainda
  correspondem ao snapshot recente da operacao.
- Cada falha posterior a uma chamada do SDK rele os IDs afetados para descobrir
  aplicacao total, parcial ou ausente.
- O rollback registra apenas itens e chaves tocados pela operacao. Ele desfaz
  adicoes, readiciona exclusoes, restaura atualizacoes e metadata somente quando
  o estado atual ainda corresponde ao alvo escrito pela propria operacao.
- Se o marcador for perdido, o rollback e recusado para nao alterar o trabalho
  da operacao que assumiu a cena.
- Um lock local impede duplo acionamento na mesma instancia. Os dois botoes de
  restauracao ficam desabilitados e o painel mostra `Restaurando...` ate o
  `finally`.

### Marcador de restauracao

- Chave interna: `br.demonrider.double-sided-cards/scene-restore`.
- Campos: versao, token unico, ID do jogador, ID da conexao, ID do preset,
  horario de inicio e fase.
- O marcador e gravado antes da primeira mutacao, relido apos a escrita e
  revalidado antes de cada fase e de cada lote.
- Somente a operacao que ainda observa o proprio token tenta limpar o marcador.
- Marcadores orfaos nao sao removidos por idade. A interface exige confirmacao
  explicita antes de assumir uma restauracao interrompida.
- O marcador e removido dos backups criados pelo servidor local.

### Simulacoes e validacoes

- Validacao dos dois presets publicos.
- Preset vazio, IDs duplicados, `undefined`, referencia circular, proxy revogado,
  URL local e caminho absoluto do Windows sem mutacao da cena.
- Restauracao em cena vazia, repeticao idempotente e troca entre Tutorial e
  Missao 0.5.
- Preservacao de metadata desconhecida da cena.
- Substituicao de item com o mesmo ID e tipo diferente.
- Rejeicao parcial de `addItems`, `updateItems`, `deleteItems` e `setMetadata`,
  com releitura e rollback condicional.
- Duplo acionamento local.
- Marcador orfao bloqueado sem confirmacao e recuperado com confirmacao.
- Duas instancias simulando contas diferentes, tanto no mesmo preset quanto em
  presets diferentes. Somente a instancia que manteve o token concluiu.
- Perda forcada do marcador entre lotes sem apagar itens ou marcador da outra
  operacao.
- `node --check`, `npm.cmd run build`, `git diff --check` e buscas obrigatorias.

### Riscos e limitacoes

- A contencao local protege somente a instancia atual.
- O marcador reduz conflitos entre contas, mas duas escritas simultaneas ainda
  possuem uma janela residual porque o SDK nao oferece compare-and-swap.
- Se uma operacao perde o marcador depois de alterar itens, ela interrompe sem
  rollback para nao tocar no estado da vencedora. A operacao vencedora deve
  concluir a reconciliacao da cena.
- Um rollback parcial mantem o marcador com fase `recovery-required`; nova
  tentativa exige confirmacao explicita.
- A restauracao faz mais releituras do SDK que o fluxo antigo. O custo e
  intencional e restrito a uma acao rara e destrutiva.

### Arquivos modificados

- `src/scene-preset.js`
- `src/app.js`
- `manifest.json`
- `index.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`, regenerado pelo build

### Testes manuais pendentes

- Restaurar Tutorial e Missao 0.5 em cena vazia e populada.
- Repetir a restauracao do mesmo mapa e alternar entre os dois mapas.
- Confirmar IDs, contagens, imagens, slots, cartas, pilhas e metadata.
- Dar duplo clique e alternar rapidamente os dois botoes.
- Testar duas contas no mesmo preset e em presets diferentes.
- Interromper rede ou fechar o painel apenas em cena descartavel e confirmar a
  recuperacao explicita do marcador orfao.
- Repetir em mobile e confirmar que os controles voltam em sucesso e falha.
- Revalidar `V`, `C`, `E`, `R`, bibliotecas, pilha de missao, cores e slots.

### Observacoes

- A Etapa 7 foi marcada como `Em teste`.
- A Etapa 8 nao foi iniciada; S-20 permanece pendente.
- A versao publica foi atualizada de `0.2.67` para `0.2.68`.
- O cache do painel e de `dist/app.js` foi atualizado para `v=68`.
- O background nao mudou e permaneceu em `v=67`.

## 2026-07-17 - Etapa 6: cores, slots e multiplayer

### Sessao

Implementacao da Etapa 6 do plano oficial de correcoes, limitada a S-11, S-12,
S-13 e S-14.

O mantenedor informou que todos os testes manuais da Etapa 5 foram aprovados no
Owlbear Rodeo, incluindo criacao e uso da pilha de missao, versos individuais,
acionamento rapido, duas contas e mobile. A Etapa 5 foi marcada como
`Concluido`.

### Diagnostico

- S-11: a disponibilidade da cor era consultada uma vez e a metadata do jogador
  era gravada depois, sem revalidacao posterior. Duas contas ainda podiam
  observar a mesma cor como livre.
- S-11: o background podia usar o identificador detectado sem confirmar que a
  selecao atual ainda continha exatamente aquele item.
- S-12: o auto-place usava snapshots de item, cor e `selection-board` obtidos
  antes das mutacoes. Duas operacoes podiam disputar carta ou slot com estado
  antigo.
- S-12: uma carta atribuida a outra cor era apenas ignorada genericamente, sem
  distinguir pertencimento alheio.
- S-13: `Devolver origem` movia o item e depois gravava um snapshot antigo da
  cena. Falha na segunda etapa podia deixar referencia orfa; falha na primeira
  nao possuia reconciliacao.
- S-14: marcacoes locais substituiam objetos internos de metadata, descartando
  campos desconhecidos. A normalizacao do `selection-board` tambem descartava
  propriedades futuras.
- O SDK 3.1.0 permite reler e atualizar metadata, itens e jogadores, mas nao
  oferece compare-and-swap ou transacao distribuida entre essas entidades.

### Solucao aplicada

- Escolhas de cor sao serializadas localmente, validam a selecao atual e o
  identificador, releem jogadores imediatamente antes da gravacao e verificam
  conflitos novamente depois dela.
- Em conflito posterior, somente a metadata do jogador atual e restaurada para
  o valor anterior. Metadata de outro jogador nunca e alterada.
- Identificadores antigos sem `color-token` ainda podem usar o fallback textual
  inequivoco existente. Uma metadata `color-token` presente, mas parcial, e
  recusada em vez de cair no texto.
- Marcacoes novas de cor, categoria e cor ativa gravam `version: 1` com valor
  validado e preservam campos desconhecidos serializaveis.
- A normalizacao de `selection-board` preserva propriedades desconhecidas nos
  niveis principal, de slots, atribuicoes, origens e tokens.
- Operacoes de slot recebem contencao local por ID da carta e chave
  `cor/categoria`, sempre em ordem estavel e com liberacao em `finally`.
- Antes de reservar e mover, o fluxo rele selecao, item, categoria, cor ativa,
  slot, ocupante anterior, origem e atribuicoes. Mudancas detectadas recusam a
  operacao sem sobrescrever o estado conhecido como mais recente.
- Cartas atribuidas a outra cor nao sao movidas, desbloqueadas nem gravadas em
  outro slot.
- A reserva do slot e gravada antes do movimento e verificada por releitura. Se
  o movimento falha, a referencia anterior e restaurada apenas quando o slot
  ainda aponta para a carta esperada.
- O ocupante anterior so retorna a origem quando a releitura confirma que ele
  nao ganhou outra atribuicao.
- `Devolver origem` move o item primeiro e limpa apenas referencias exatas ao
  seu ID. Falha de movimento preserva a metadata; falha de limpeza faz uma nova
  releitura e tentativa localizada.
- Carta ja devolvida sem referencia e tratada de forma idempotente. Item ausente
  permite somente a limpeza de referencias inequivocas ao mesmo ID.
- O background limpa o cache de imagens quando a selecao fica vazia, passa o ID
  exato do identificador para a escolha de cor e reflete corretamente a remocao
  de uma cor ativa.

### Regras preservadas

- Raca e classe continuam bloqueadas no slot.
- Divindade continua desbloqueada.
- O contrato de divindade permanece largura 2, altura 3 e origem 390 x 395.
- Substituicoes continuam devolvendo o ocupante anterior a origem.
- `Devolver origem` continua no painel e nao altera devolucao para pilha.
- Chaves publicas de metadata, APIs, IDs de comandos e atalhos `V`, `C`, `E` e
  `R` nao foram alterados.
- Compra, devolucao, embaralhamento, pilha de missao, bibliotecas e restauracao
  de mapas nao foram modificados.

### Arquivos modificados

- `src/selection-board.js`
- `src/background.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`, regenerado pelo build
- `dist/background.js`, regenerado pelo build

### Simulacoes e validacoes

- Cor livre, repeticao da propria cor, troca de cor e cor ocupada.
- Duas solicitacoes locais da mesma cor e liberacao apos saida de jogador.
- Identificador antigo inequivoco e identificador com metadata parcial.
- Marcacoes locais validas e invalidas, preservando campos desconhecidos.
- Slot livre, carta em slot alheio e multiselecao.
- Troca de raca e classe, incluindo origem e bloqueio.
- Divindade desbloqueada, escala preservada e origem 390 x 395.
- Duas cartas disputando o mesmo slot na mesma instancia.
- `Devolver origem` normal, repetido, com falha de item, falha inicial de
  metadata e item ausente com mais de uma referencia exata.
- Callbacks de itens simulados com drafts do Immer e verificacao de
  serializacao posterior.
- `node --check`, `npm.cmd run build`, `git diff --check` e buscas obrigatorias.

### Riscos e limitacoes

- As filas protegem apenas a instancia JavaScript atual. Painel e background,
  assim como duas contas, possuem instancias separadas.
- Releituras e verificacoes posteriores reduzem a janela de corrida, mas nao
  tornam item, metadata da cena e metadata de jogador atomicamente consistentes.
- Duas contas exatamente simultaneas podem detectar conflito depois da escrita.
  Sem prioridade documentada, a extensao nao escolhe arbitrariamente um
  vencedor; preserva o estado anterior do proprio jogador quando o conflito e
  observado.
- Uma alteracao externa exatamente entre a ultima releitura e a gravacao ainda
  e risco residual do contrato do SDK.

### Testes manuais pendentes

- Teste minimo com duas contas: mesma cor, cor alternativa, carta alheia e
  `Devolver origem`.
- Vermelho, branco, verde e azul; troca, F5, saida da sala e clique simultaneo.
- Raca, classe e divindade: posicionamento, substituicao, disputa e bloqueio.
- Falhas e repeticoes rapidas de `Devolver origem`.
- Marcacoes administrativas na versao local e cenas antigas.
- Mobile e regressao de `V`, `C`, `E`, `R`, pilhas, bibliotecas e mapas.

### Observacoes

- A Etapa 6 foi marcada como `Em teste`.
- As Etapas 7 e 8 nao foram iniciadas.
- S-09, S-10 e S-20 nao foram implementados.
- A versao publica foi atualizada de `0.2.66` para `0.2.67`.
- O cache de `index.html`, `background.html`, `dist/app.js` e
  `dist/background.js` foi atualizado para `v=67`. Assets, estilos e SDK
  inalterados permaneceram em `v=65`.

## 2026-07-17 - Etapa 5: pilha de missao robusta

### Sessao

Implementacao da Etapa 5 do plano oficial de correcoes, limitada a S-07 e S-08.

O mantenedor informou que todos os testes manuais da Etapa 4 foram aprovados no
Owlbear Rodeo, incluindo devolucao rapida, duas contas e mobile. A Etapa 4 foi
marcada como `Concluido`.

### Diagnostico

- S-07: o painel criava a nova pilha, chamava `deleteItems` para as cinco cartas
  e considerava a operacao concluida sem reler a cena. Uma falha total ou parcial
  podia deixar as cartas simultaneamente soltas e dentro da pilha.
- S-07: a selecao usava `lastCardSelection` quando a selecao atual estava vazia,
  permitindo criar uma pilha a partir de uma selecao antiga.
- S-07: duas chamadas rapidas podiam iniciar a mesma criacao sem coordenacao
  local.
- S-08: cada entrada da pilha guardava apenas `name` e `front`. A compra usava o
  verso geral da pilha, perdendo versos individuais, origem, largura e
  espelhamento da carta.
- O SDK instalado confirma que `addItems` e `deleteItems` retornam `Promise<void>`.
  O ID seguro da nova pilha vem do item produzido pelo builder antes de
  `addItems`; nao existe transacao distribuida entre adicionar a pilha e apagar
  as cartas.

### Solucao aplicada

- A criacao exige a selecao atual com exatamente cinco IDs unicos.
- Os cinco itens sao relidos e revalidados imediatamente antes da mutacao.
- A selecao atual e confirmada novamente; nenhum fallback antigo e usado.
- Uma trava local curta, identificada pelo conjunto ordenado dos cinco IDs,
  impede duas criacoes simultaneas na mesma instancia e e liberada em `finally`.
- As entradas sao objetos comuns e serializaveis, independentes da metadata
  original e de drafts do Immer.
- A nova pilha recebe um ID conhecido do builder antes de `addItems`.
- As cartas originais so sao apagadas depois que a pilha foi adicionada e relida
  com sucesso.
- Depois de `deleteItems`, os cinco IDs sao sempre relidos, mesmo quando a
  chamada nao rejeita.
- Se nenhuma carta permanecer, a pilha e mantida.
- Se todas permanecerem e a pilha continuar intacta, somente a nova pilha e
  removida.
- Se parte permanecer e a pilha continuar intacta, as entradas correspondentes
  as cartas ainda soltas sao retiradas da pilha. As cartas apagadas continuam
  representadas na pilha, preservando cada carta exatamente uma vez.
- Se a pilha tiver sido movida, embaralhada, comprada ou alterada, rollback e
  reconciliacao destrutivos sao recusados.
- Cada entrada passa a preservar verso proprio, largura no grid, origem,
  espelhamento e descricao personalizada quando existente.
- Compra e devolucao passaram a respeitar esses campos opcionais por entrada,
  mantendo fallback para o verso e largura gerais em pilhas antigas.
- O verso geral da pilha continua sendo o verso da primeira carta selecionada,
  sem substituir os versos internos.
- `deleteWhenEmpty` permanece verdadeiro e o fluxo robusto da Etapa 3 continua
  responsavel por criar a ultima carta antes de apagar a pilha.

### Arquivos modificados

- `src/app.js`
- `src/deck.js`
- `src/card-data.js`
- `manifest.json`
- `index.html`
- `background.html`
- `README.md`
- `docs/AI_CONTEXT.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/CHANGELOG_AI.md`
- `dist/app.js`
- `dist/background.js`

### Simulacoes e validacoes

- Selecao com quatro cartas, seis cartas, item comum e IDs repetidos.
- Criacao normal com cinco cartas e contador igual a cinco.
- Falha em `addItems` antes e depois de a pilha aparecer.
- Nova tentativa depois de falha, confirmando liberacao da trava.
- Erro em `deleteItems` com todas, nenhuma ou parte das cartas apagadas.
- Reconciliacao parcial mantendo cada carta exatamente uma vez.
- Recusa conservadora quando a pilha muda antes da reconciliacao.
- Duas chamadas locais simultaneas para os mesmos cinco IDs.
- Cinco versos diferentes, carta espelhada, origem personalizada e campo
  opcional ausente.
- Embaralhar, comprar, devolver ao fundo, comprar novamente e esvaziar a pilha.
- Serializacao dos dados depois de callbacks de `updateItems`, sem proxies
  revogados.
- `node --check` nos fontes e bundles.
- `npm.cmd run build`.
- `git diff --check` e buscas obrigatorias por referencias locais.

### Riscos e limitacoes

- A trava existe apenas na instancia JavaScript atual. Duas contas exatamente
  simultaneas ainda possuem uma janela residual porque o SDK nao oferece
  transacao distribuida completa.
- Se a exclusao for parcial e a pilha ja tiver sido usada, a extensao preserva o
  estado mais recente e recusa uma alteracao destrutiva. Esse caso exige
  verificacao manual do mestre.
- Se a ultima carta apagar a pilha temporaria, a devolucao posterior continua
  sem recriar automaticamente a pilha, conforme limitacao ja documentada.

### Testes manuais pendentes

- Teste minimo de criacao, contador, embaralhamento, compra e devolucao.
- Quantidades invalidas e selecao com item comum.
- Cinco cartas com versos visivelmente diferentes.
- Compra ate a pilha temporaria desaparecer.
- Acionamento repetido, duas contas e mobile.
- Regressao de `V`, `C`, `E`, `R`, pilhas permanentes, bibliotecas, F5, cores,
  slots e mapas.

### Observacoes

- A Etapa 5 foi marcada como `Em teste`.
- A Etapa 6 nao foi iniciada.
- S-11, S-12, S-13 e S-14 nao foram implementados.
- A versao publica foi atualizada de `0.2.65` para `0.2.66`.
- O cache de `index.html`, `background.html`, `dist/app.js` e
  `dist/background.js` foi atualizado para `v=66`. Assets, estilos e SDK
  inalterados mantiveram o cache anterior.

## 2026-07-13 - Etapa 4: devolucao robusta

### Sessao

Implementacao da Etapa 4 do plano oficial de correcoes, limitada a S-03, S-04 e a parte de S-05 diretamente relacionada a coordenacao local entre devolucao, compra e embaralhamento da mesma pilha.

O mantenedor informou que os testes manuais da Etapa 3 foram aprovados no Owlbear Rodeo apos a correcao da regressao de proxies revogados. Por isso, `docs/IMPLEMENTATION_PLAN.md` foi atualizado para marcar a Etapa 3 como `Concluido`.

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

- S-03: a devolucao atualizava a pilha e depois apagava a carta solta. Se `deleteItems` falhasse, a carta ficava duplicada: uma copia no fundo da pilha e outra ainda na cena.
- S-04: chamadas repetidas da mesma carta podiam reutilizar snapshots antigos e adicionar a mesma carta mais de uma vez.
- S-05 parcial: devolucao nao participava da fila local por pilha criada na Etapa 3, permitindo concorrencia local com compra e embaralhamento.

### Solucao aplicada

- A devolucao passou a usar uma trava local por ID de carta.
- Depois da trava da carta, o fluxo rele a carta, valida a pilha de origem e entra na fila local da pilha.
- Dentro da fila da pilha, a carta e a pilha sao relidas antes da mutacao.
- A carta devolvida e convertida em uma entrada serializavel no formato atual da pilha e adicionada ao fundo.
- Se `deleteItems` falhar, a extensao rele a carta e a pilha.
- Se a carta ja nao existir, a devolucao e considerada funcionalmente concluida.
- Se a carta ainda existir, o rollback remove a entrada adicionada somente quando a pilha continua exatamente no estado pos-devolucao esperado.
- Se a pilha mudou depois da devolucao, o rollback e recusado para nao sobrescrever compra, embaralhamento ou outra devolucao posterior.

### Ordem das travas

1. Trava local por carta.
2. Fila local por pilha de origem.

Compra e embaralhamento continuam usando apenas a fila da pilha. A devolucao entra nessa mesma fila depois de identificar a origem da carta.

### Riscos e limitacoes

- A trava por carta e local ao contexto JavaScript. Ela reduz duplo clique e chamadas repetidas no mesmo bundle, mas nao cria uma transacao distribuida entre duas contas.
- Painel e background rodam em contextos separados; sem lock persistente ou schema novo, nao ha garantia absoluta contra corridas entre contextos diferentes acionados no mesmo instante.
- Cartas sem `sourceDeckId` nao sao devolvidas automaticamente para uma pilha selecionada. Isso evita devolver para pilha errada, mas exige que a carta tenha origem registrada.
- Pilhas temporarias ja apagadas ao esvaziar continuam nao sendo recriadas nesta etapa.

### Testes executados

- Simulacao local com `produceWithPatches` para devolucao simples.
- Simulacao de duplo acionamento local da mesma carta.
- Simulacao de duas cartas diferentes para a mesma pilha.
- Simulacao de falha em `updateItems`.
- Simulacao de falha em `deleteItems` com carta ainda existente e rollback seguro.
- Simulacao de falha em `deleteItems` com carta ja ausente.
- Simulacao de pilha alterada antes do rollback, com rollback recusado.
- Simulacao de pilha de origem ausente.
- Simulacao de devolucao concorrendo localmente com compra e embaralhamento.
- `node --check` em `src/deck.js`.

### Testes manuais pendentes

- Teste minimo: comprar uma carta, devolver pelo botao, confirmar que some da cena, contador aumenta em um, comprar ate reencontra-la no fundo e repetir usando `R`.
- Devolver pelo botao, menu de contexto e atalho `R`.
- Pressionar `R` varias vezes rapidamente.
- Devolver varias cartas em sequencia e rapidamente.
- Testar devolucao junto de compra e embaralhamento.
- Testar duas contas.
- Testar mobile.
- Testar origem ausente com uma pilha temporaria ja apagada, se houver exemplo seguro.

### Observacoes

- A Etapa 4 foi marcada como `Em teste`, nao como concluida.
- A Etapa 5 nao foi iniciada.
- S-07 e S-08 nao foram implementados.
- A versao/cache publico foi atualizado de `0.2.64`/`v=64` para `0.2.65`/`v=65`.

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
