# Implementation Plan - Cartas Duplas

Este plano transforma a auditoria especializada em etapas pequenas e testaveis. Nao e uma lista obrigatoria de implementacao imediata; e um roteiro seguro para corrigir riscos quando DemonRider pedir.

## Status possiveis

| Status | Significado |
| --- | --- |
| Pendente | Ainda nao implementado. |
| Em progresso | Implementacao iniciada. |
| Em teste | Codigo pronto, aguardando bateria de testes. |
| Concluido | Validado e incorporado. |
| Cancelado | Nao sera feito por decisao do projeto. |

## Etapa 1 - Selecao e acoes sem estado complexo

| Campo | Conteudo |
| --- | --- |
| Objetivo | Corrigir problemas de selecao que podem disparar acao no item errado. |
| Problemas contemplados | S-06, S-15, S-16, S-19 |
| Arquivos envolvidos | `src/flip.js`, `src/selection-board.js`, `src/background.js`, `src/app.js` |
| Dependencias | Nenhuma. |
| Status | Concluido |

### Checklist de implementacao

- Priorizar selecao atual antes de fallback em `flipSelectedItems`.
- Restringir deteccao textual de cor ou desativar fallback ambiguo na versao publica.
- Impedir auto-place quando houver multiselecao.
- Reduzir atualizacoes repetidas de `Jogadores e cores` em mobile.

### Checklist de validacao

- Selecionar carta e pressionar `V`.
- Selecionar pilha e pressionar `V`.
- Pressionar `V` apos mudar selecao rapidamente.
- Selecionar varios itens e confirmar que nenhum slot e acionado sozinho.
- Testar painel no desktop e mobile.

## Etapa 2 - Registro de comandos e reparo seguro de URLs

| Campo | Conteudo |
| --- | --- |
| Objetivo | Reduzir lentidao, registro duplicado e mutacao indireta de metadados. |
| Problemas contemplados | S-17, S-18 |
| Arquivos envolvidos | `src/background.js` |
| Dependencias | Etapa 1 recomendada, mas nao obrigatoria. |
| Status | Concluido |

### Checklist de implementacao

- Separar verificacao de URL reparavel da mutacao do item.
- Evitar clone raso que compartilha `metadata`.
- Debounce/throttle no registro de comandos.
- Garantir que F5 ou reconexao continue recriando comandos quando necessario.

### Checklist de validacao

- Dar F5 no Owlbear.
- Confirmar botoes de contexto e barra.
- Confirmar atalhos `V`, `C`, `E`, `R`.
- Abrir em segunda conta.
- Medir se comandos deixam de ficar lentos.

## Etapa 3 - Compra de pilha robusta

| Campo | Conteudo |
| --- | --- |
| Objetivo | Evitar duplicacao/perda na compra de cartas. |
| Problemas contemplados | S-01, S-02, parte de S-05 |
| Arquivos envolvidos | `src/deck.js`, possivelmente `src/background.js`, `src/app.js` |
| Dependencias | Etapa 2 recomendada. |
| Status | Concluido |

### Checklist de implementacao

- Calcular carta comprada a partir do estado mais atual possivel.
- Adicionar trava local curta por pilha para impedir duplo clique do mesmo cliente.
- Definir estrategia de rollback se `addItems` falhar apos atualizar pilha.
- Preservar regra de face atual da pilha.
- Preservar delecao de pilha temporaria vazia.

### Checklist de validacao

- Comprar uma carta.
- Comprar rapidamente varias vezes.
- Dois jogadores comprando da mesma pilha.
- Comprar da pilha virada para frente e para verso.
- Comprar ultima carta de pilha temporaria.
- Testar em celular com conexao lenta.

## Etapa 4 - Devolucao robusta

| Campo | Conteudo |
| --- | --- |
| Objetivo | Evitar duplicacao ou perda ao devolver cartas. |
| Problemas contemplados | S-03, S-04, parte de S-05 |
| Arquivos envolvidos | `src/deck.js`, possivelmente `src/background.js`, `src/app.js` |
| Dependencias | Etapa 3. |
| Status | Concluido |

### Checklist de implementacao

- Proteger a mesma carta contra devolucao duplicada.
- Definir rollback se atualizar pilha e falhar ao apagar carta.
- Preservar devolucao para o fundo da pilha.
- Manter origem da pilha quando existir.

### Checklist de validacao

- Devolver carta por botao do Owlbear.
- Devolver por `R`.
- Devolver varias cartas em sequencia.
- Dois jogadores tentando devolver a mesma carta.
- Confirmar contador e ordem do deck.

## Etapa 5 - Pilha de missao

| Campo | Conteudo |
| --- | --- |
| Objetivo | Tornar a criacao de pilha temporaria mais segura. |
| Problemas contemplados | S-07, S-08 |
| Arquivos envolvidos | `src/app.js`, `src/deck.js`, `src/card-data.js` |
| Dependencias | Etapas 3 e 4 recomendadas. |
| Status | Concluido |

### Checklist de implementacao

- Tratar falha ao apagar cartas originais apos criar pilha.
- Preservar verso individual quando carta tiver verso proprio.
- Confirmar que exige exatamente 5 cartas.
- Confirmar `deleteWhenEmpty`.

### Checklist de validacao

- Criar pilha com 4 cartas: deve falhar.
- Criar pilha com 5 cartas: deve funcionar.
- Comprar todas: pilha deve sumir.
- Embaralhar antes de comprar.
- Testar com cartas com versos diferentes.

## Etapa 6 - Cores, slots e multiplayer

| Campo | Conteudo |
| --- | --- |
| Objetivo | Reduzir estados inconsistentes na selecao por cor e slots. |
| Problemas contemplados | S-11, S-12, S-13, S-14 |
| Arquivos envolvidos | `src/selection-board.js`, `src/background.js`, `src/app.js` |
| Dependencias | Etapa 1. |
| Status | Concluido |

### Checklist de implementacao

- Revalidar cor no momento de gravar jogador.
- Revalidar slot no momento de mover carta.
- Evitar apropriar carta que ja esta no slot de outra cor.
- Tornar `Devolver origem` mais resiliente a falhas parciais.
- Tratar metadata parcial de marcacoes locais.

### Checklist de validacao

- Dois usuarios tentando mesma cor.
- Trocar raca/classe/divindade.
- Devolver origem.
- Tentar clicar em carta ja no slot de outro jogador.
- Verificar `Jogadores e cores`.

## Etapa 7 - Restauracao de mapas

| Campo | Conteudo |
| --- | --- |
| Objetivo | Reduzir risco de cena parcialmente apagada/restaurada. |
| Problemas contemplados | S-09, S-10 |
| Arquivos envolvidos | `src/scene-preset.js`, `src/app.js` |
| Dependencias | Nenhuma, mas exige bateria de teste forte. |
| Status | Em teste |

### Checklist de implementacao

- Adicionar confirmacao/lock local antes de restaurar.
- Considerar metadata de restauracao em progresso.
- Melhorar ordem de operacoes para reduzir janela de cena quebrada.
- Melhorar mensagens de falha.

### Checklist de validacao

- Restaurar Tutorial.
- Restaurar Missao 0.5.
- Interromper rede durante restauracao, se possivel.
- Dois usuarios tentando restaurar ao mesmo tempo.
- Confirmar assets e metadados depois.

## Etapa 8 - Compatibilidade e validadores

| Campo | Conteudo |
| --- | --- |
| Objetivo | Normalizar metadados antigos e incompletos sem quebrar cenas existentes. |
| Problemas contemplados | S-20 |
| Arquivos envolvidos | `src/card-data.js`, `src/deck.js`, `src/flip.js`, `src/divinity-sizing.js` |
| Dependencias | Idealmente apos etapas 3 a 5. |
| Status | Pendente |

### Checklist de implementacao

- Criar normalizadores conservadores para carta e pilha.
- Definir defaults seguros para `gridWidth`, `currentFace`, `origin` e `cards`.
- Nao apagar campos desconhecidos.
- Registrar compatibilidade em docs.

### Checklist de validacao

- Abrir cena antiga.
- Virar carta antiga.
- Comprar de pilha antiga.
- Migrar links locais.
- Restaurar mapas salvos.

## Tabela consolidada

| Etapa | Problemas | Arquivos afetados | Tempo estimado | Risco | Beneficio esperado |
| --- | --- | --- | --- | --- | --- |
| 1 | S-06, S-15, S-16, S-19 | `flip.js`, `selection-board.js`, `background.js`, `app.js` | 1-2h | Medio | Menos acoes no item errado e painel mais leve. |
| 2 | S-17, S-18 | `background.js` | 2-3h | Medio | Menos lentidao e menor risco de metadata alterada fora de update. |
| 3 | S-01, S-02, S-05 | `deck.js` | 4-6h | Alto | Compra mais segura em desktop/mobile/multiplayer. |
| 4 | S-03, S-04, S-05 | `deck.js` | 3-5h | Alto | Devolucao sem duplicacao/perda. |
| 5 | S-07, S-08 | `app.js`, `deck.js`, `card-data.js` | 2-4h | Medio | Pilhas temporarias mais confiaveis. |
| 6 | S-11, S-12, S-13, S-14 | `selection-board.js`, `background.js`, `app.js` | 5-8h | Alto | Menos conflito entre jogadores e slots. |
| 7 | S-09, S-10 | `scene-preset.js`, `app.js` | 4-7h | Alto | Restauracao de mapas mais segura. |
| 8 | S-20 | `card-data.js`, `deck.js`, `flip.js` | 4-8h | Alto | Melhor compatibilidade com cenas antigas. |

## Ordem recomendada

1. Etapa 1.
2. Etapa 2.
3. Etapa 3.
4. Etapa 4.
5. Etapa 5.
6. Etapa 6.
7. Etapa 8.
8. Etapa 7.

A restauracao de mapas fica quase no fim porque e a area com maior impacto se algo der errado.
