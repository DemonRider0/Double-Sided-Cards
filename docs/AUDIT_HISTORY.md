# Audit History - Cartas Duplas

Este arquivo consolida auditorias realizadas durante o desenvolvimento. Use-o como historico tecnico e como entrada para planos de correcao.

## 2026-07-13 - Auditoria geral de qualidade

### Resumo

A auditoria geral avaliou performance, arquitetura, codigo, seguranca, boas praticas, escalabilidade, dependencias e manutenibilidade. A conclusao foi que o projeto esta funcional e relativamente bem separado por dominio, mas carrega riscos naturais de extensoes Owlbear baseadas em metadados compartilhados.

### Pontos gerais encontrados

| ID | Descricao | Impacto | Prioridade | Situacao atual |
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

| ID | Descricao | Impacto | Prioridade | Situacao atual |
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

## Situacao consolidada

| Categoria | Status geral |
| --- | --- |
| Funcionalidades principais | Operacionais, mas com riscos conhecidos em concorrencia. |
| Mobile | Prioritario; ainda sensivel a peso de assets e chamadas repetidas. |
| Multiplayer | Funcional em uso normal, mas falta protecao forte contra corridas simultaneas. |
| Documentacao | Consolidada na pasta `docs/`; deve ser mantida junto com futuras mudancas. |
| Build/publicacao | Funciona por GitHub Pages, com cache busting manual. |

## Observacao importante

Nem todo item pendente deve ser corrigido imediatamente. Alteracoes em pilhas, restauracao de mapa e slots sao de alto risco e devem seguir `docs/IMPLEMENTATION_PLAN.md`.
