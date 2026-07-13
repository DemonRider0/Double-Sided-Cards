# Contributing AI - Cartas Duplas

Este e o guia definitivo para qualquer IA que trabalhe neste projeto. Ele nao substitui os demais documentos: ele define o fluxo obrigatorio de trabalho e aponta quais documentos devem ser lidos antes de qualquer alteracao.

## Objetivo do projeto

Cartas Duplas e uma extensao do Owlbear Rodeo criada por DemonRider para simular cartas 2D com frente e verso, pilhas compraveis, bibliotecas publicas de cartas/pilhas, mapas salvos e selecao de jogador por cor.

O projeto existe para reproduzir, dentro do Owlbear, parte da experiencia de manipulacao de cartas do Tabletop Simulator, mas sem figuras 3D e com foco forte em uso no mobile.

O usuario final e:

- DemonRider, como mantenedor, mestre e preparador dos mapas;
- jogadores desktop e mobile que entram em salas do Owlbear;
- futuros usuarios publicos que instalarem a extensao pelo GitHub Pages.

## Arquitetura resumida

A extensao e uma aplicacao estatica com dois contextos principais:

| Contexto | Arquivos | Responsabilidade |
| --- | --- | --- |
| Painel | `index.html`, `src/app.js`, `dist/app.js` | Interface lateral, biblioteca, restauracao de mapas, acoes manuais e recursos locais/publicos. |
| Background | `background.html`, `src/background.js`, `dist/background.js` | Comandos do Owlbear, atalhos, menus de contexto, listeners e sincronizacao. |

O estado do jogo fica principalmente nos metadados do Owlbear:

- item de carta: frente, verso, face atual, origem e pilha de origem;
- item de pilha: lista ordenada de cartas, verso, face atual, contador e flags;
- cena: slots de raca/classe/divindade;
- jogador: cor ativa;
- presets: mapas JSON em `assets/scene-presets/`.

Os modulos centrais sao:

| Arquivo | Papel |
| --- | --- |
| `src/card-data.js` | Contratos de metadados e criacao de dados de imagem/grid. |
| `src/deck.js` | Regras de pilha: comprar, devolver, embaralhar, virar e sincronizar display. |
| `src/flip.js` | Virar cartas e pilhas selecionadas. |
| `src/selection-board.js` | Cores, identificadores, categorias e slots de jogador. |
| `src/scene-preset.js` | Salvar e restaurar mapas. |
| `src/background.js` | Integracao profunda com comandos do Owlbear. |
| `src/app.js` | Painel e orquestracao de funcoes visiveis. |

## Principios obrigatorios

1. Metadados sao a fonte de verdade.
2. A versao publica deve funcionar sem `localhost`.
3. Mobile e prioridade de produto, nao detalhe secundario.
4. Jogadores nao devem precisar importar assets para jogar a versao publica.
5. Alteracoes devem ser pequenas, testaveis e reversiveis.
6. Compatibilidade com cenas antigas deve ser preservada.
7. Comportamento existente nao deve mudar sem pedido claro.
8. Build, cache e manifesto precisam acompanhar alteracoes de codigo.
9. Documentacao deve acompanhar mudancas relevantes.
10. Em caso de duvida, preservar estabilidade da mesa antes de adicionar conveniencia.

## Regras que nunca podem ser violadas

- Nunca deixar a versao publica depender de `localhost`, `127.0.0.1`, `.local-assets` privado ou caminhos `C:\Users\...`.
- Nunca alterar metadados antigos sem estrategia de migracao ou normalizacao.
- Nunca quebrar cartas, pilhas ou mapas ja salvos.
- Nunca reintroduzir compra por arrasto ou devolucao por arrasto sem pedido explicito de DemonRider.
- Nunca devolver carta para o topo da pilha por padrao; a regra atual e devolver para o fundo.
- Nunca fazer carta comprada ignorar a face atual da pilha.
- Nunca remover ou renomear mapas salvos sem pedido explicito.
- Nunca remover bibliotecas publicas de cartas/pilhas para "limpar" o projeto.
- Nunca alterar varios sistemas criticos na mesma implementacao.
- Nunca fazer refatoracao ampla apenas por preferencia estetica.
- Nunca mexer em `dist/` manualmente quando a fonte esta em `src/`; use build.
- Nunca mudar APIs publicas, chaves de metadados ou IDs de comandos sem justificativa e plano de compatibilidade.
- Nunca remover autoria de DemonRider.

## Estrategia de implementacao

Toda implementacao deve seguir estes principios:

| Regra | Aplicacao pratica |
| --- | --- |
| Pequenas etapas | Resolver um problema por vez, especialmente em `deck.js`, `selection-board.js` e `scene-preset.js`. |
| Evitar regressoes | Antes de mudar, identificar fluxos afetados e consultar `TEST_CHECKLIST.md`. |
| Preservar compatibilidade | Aceitar metadados antigos e adicionar normalizadores quando necessario. |
| Nao alterar comportamento existente | So mudar comportamento quando o pedido exigir. |
| Sem refatoracoes desnecessarias | Refatorar apenas quando reduzir risco real ou destravar correcao. |
| Validar antes da proxima etapa | Rodar testes relevantes e relatar o que foi ou nao validado. |

Ao trabalhar em problemas da auditoria, seguir `docs/IMPLEMENTATION_PLAN.md`. Nao pular para etapas de alto risco sem necessidade.

## Arquivos criticos

Estes arquivos exigem extremo cuidado:

| Arquivo/pasta | Por que e critico |
| --- | --- |
| `src/deck.js` | Pode duplicar, perder ou corromper cartas e pilhas. |
| `src/card-data.js` | Define contratos de metadados usados por toda a extensao. |
| `src/selection-board.js` | Controla jogadores, cores e slots; erros afetam multiplayer. |
| `src/scene-preset.js` | Restaura cenas completas e pode apagar/adicionar muitos itens. |
| `src/background.js` | Registra comandos, atalhos e listeners; erros afetam toda a usabilidade. |
| `src/app.js` | Orquestra UI, bibliotecas, mapas e acoes; arquivo grande com muitas responsabilidades. |
| `assets/scene-presets/` | Fonte publica dos mapas salvos. |
| `assets/preset-decks/` | Fonte publica das pilhas de biblioteca. |
| `assets/preset-cards/` | Fonte publica das cartas de biblioteca. |
| `manifest.json` | Entrada publica da extensao e controle de cache. |
| `dist/` | Build entregue ao GitHub Pages. |

## Fluxo obrigatorio de trabalho

1. Ler toda a pasta `docs/`.
2. Ler `PROJECT_RULES.md`.
3. Analisar a tarefa recebida.
4. Identificar se a tarefa afeta versao publica, local ou ambas.
5. Planejar a menor alteracao segura.
6. Implementar apenas o escopo solicitado.
7. Preservar comportamento existente fora do escopo.
8. Explicar todas as alteracoes feitas.
9. Gerar ou apontar checklist de testes.
10. Rodar validacoes adequadas ao tipo de mudanca.
11. Atualizar `docs/CHANGELOG_AI.md` quando a alteracao for relevante.
12. Aguardar aprovacao antes da proxima etapa.

## Restricoes

### Metadados

- Nunca alterar nomes de chaves sem migracao.
- Nunca apagar campos desconhecidos de metadados por limpeza agressiva.
- Nunca assumir que todos os itens sao de versao recente.
- Sempre considerar cartas/pilhas ja existentes em cenas antigas.

### Multiplayer

- Nunca tratar operacoes de cena como se fossem transacoes garantidas.
- Sempre considerar dois jogadores agindo ao mesmo tempo.
- Evitar fluxos que dependam de estado lido muito antes da escrita.
- Operacoes de pilha devem ser protegidas contra duplicacao sempre que possivel.

### Mobile

- Nunca depender apenas de teclado.
- Evitar operacoes repetidas, listeners duplicados e assets desnecessariamente pesados.
- Considerar conexao lenta e navegador mobile com menos memoria.

### Publicacao

- Publico deve usar caminhos `/Double-Sided-Cards/...`.
- Mudancas em JS/HTML/CSS/manifest/background devem atualizar cache/versionamento.
- Apos alterar `src`, rodar `npm run build`.
- Antes de publicar, verificar ausencia de caminhos locais.

### Escopo

- Nunca misturar correcao de pilhas, slots e restauracao de mapas na mesma etapa sem pedido explicito.
- Nunca fazer "limpeza geral" que apague assets ou presets sem auditoria especifica.
- Nunca mudar UI publica para expor ferramentas locais de preparacao sem pedido claro.

## Criterio de qualidade

Antes de considerar uma tarefa concluida, verificar:

| Criterio | Pergunta obrigatoria |
| --- | --- |
| Estabilidade | A mudanca pode deixar a cena em estado parcial se falhar? |
| Compatibilidade | Cenas antigas e metadados incompletos continuam funcionando? |
| Consistencia dos metadados | Item visual e metadata continuam apontando para o mesmo estado? |
| Multiplayer | Dois jogadores simultaneos podem duplicar, perder ou roubar estado? |
| Mobile | A funcao essencial funciona sem teclado e sem peso excessivo? |
| Regressao | As funcoes `V`, `C`, `E`, `R`, restaurar mapa e slots continuam funcionando? |
| Publicacao | URLs, cache e build estao coerentes? |
| Documentacao | `docs/` e `CHANGELOG_AI.md` precisam ser atualizados? |

## Checklist minimo por tipo de mudanca

### Mudanca em carta

- Virar carta.
- Virar carta comprada.
- Carta com verso igual/espelhado.
- Carta antiga com metadata incompleta.

### Mudanca em pilha

- Comprar uma carta.
- Comprar rapidamente.
- Devolver carta.
- Embaralhar.
- Virar pilha.
- Comprar da pilha virada.
- Pilha temporaria vazia.
- Dois jogadores tentando agir.

### Mudanca em slots/cor

- Selecionar cada cor.
- Trocar raca.
- Trocar classe.
- Trocar divindade.
- Tentar usar carta no slot de outro jogador.
- Conferir `Jogadores e cores`.

### Mudanca em mapas

- Restaurar Tutorial.
- Restaurar Missao 0.5.
- Conferir assets.
- Conferir cartas/pilhas.
- Conferir identificadores e slots.
- Testar mobile.

### Mudanca em publicacao

- Rodar build quando aplicavel.
- Verificar manifesto.
- Verificar cache.
- Verificar URLs publicas.
- Testar no GitHub Pages apos publicar.

## Quando parar e pedir confirmacao

Pare antes de agir se:

- a tarefa exigir apagar assets ou mapas;
- houver risco de quebrar cenas publicadas;
- for necessario mudar chaves de metadata;
- a solucao exigir reintroduzir comportamento descontinuado;
- a mudanca afetar simultaneamente pilhas, slots e mapas;
- houver conflito entre publico e local que nao esteja claro;
- a correcao exigir decisao de regra de jogo.

## Relatorio final esperado

Ao concluir uma tarefa, a resposta deve informar:

- o que foi alterado;
- quais arquivos foram modificados;
- quais validacoes foram executadas;
- o que nao foi testado, se houver;
- riscos restantes;
- proximos testes recomendados.

Nao encerrar uma tarefa de codigo sem dizer claramente se `npm run build` foi ou nao executado quando aplicavel.
