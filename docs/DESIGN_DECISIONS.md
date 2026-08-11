# Decisões de design — Cartas Duplas

Este documento registra decisões técnicas importantes. Uma decisão só deve ser alterada se DemonRider pedir explicitamente ou se houver uma correção técnica bem justificada.

## 1. Usar imagens 2D em vez de figuras 3D

| Campo | Conteudo |
| --- | --- |
| Problema | O Tabletop Simulator permite cartas/figuras customizadas, mas o Owlbear Rodeo trabalha melhor com assets 2D. |
| Decisao | Simular cartas usando itens de imagem 2D do Owlbear. |
| Justificativa tecnica | Imagens 2D sao nativas no Owlbear, funcionam em desktop/mobile e nao exigem render 3D. |
| Alternativas consideradas | Criar simulacao 3D, usar tokens comuns sem metadata, depender de ferramenta externa. |
| Vantagens | Simples, leve, compativel com mobile, alinhado ao Owlbear. |
| Desvantagens | Nao ha pilha fisica real nem comportamento nativo de deck do TTS. |
| Nao alterar quando | O objetivo continuar sendo jogar no Owlbear com mobile como prioridade. |

## 2. Metadados como fonte de verdade

| Campo | Conteudo |
| --- | --- |
| Problema | A imagem visivel nao basta para saber frente, verso, pilha de origem ou categoria. |
| Decisao | Guardar estado em metadados de item, cena e jogador. |
| Justificativa tecnica | Metadados persistem na cena e sao sincronizados pelo Owlbear. |
| Alternativas consideradas | Guardar estado no painel, localStorage, nomes de itens, servidor externo. |
| Vantagens | Estado acompanha a cena, funciona entre jogadores, nao exige backend. |
| Desvantagens | Metadados podem ficar inconsistentes em falhas parciais ou corridas multiplayer. |
| Nao alterar quando | A extensao precisar funcionar sem servidor proprio. |

## 3. Separar painel e background

| Campo | Conteudo |
| --- | --- |
| Problema | A UI do painel nao deve ser responsavel por todos os comandos do tabuleiro. |
| Decisao | Usar `app.js` para painel e `background.js` para comandos, atalhos e listeners. |
| Justificativa tecnica | O background permanece ativo para registrar menus e shortcuts mesmo fora do foco do painel. |
| Alternativas consideradas | Concentrar tudo no painel. |
| Vantagens | Melhor integracao com Owlbear, comandos acessiveis no tabuleiro. |
| Desvantagens | Mais pontos de sincronizacao e risco de registro duplicado. |
| Nao alterar quando | Botoes de contexto e shortcuts continuarem essenciais. |

## 4. Publico no GitHub Pages

| Campo | Conteudo |
| --- | --- |
| Problema | Mobile e outros computadores nao conseguem acessar `localhost` do computador do mestre. |
| Decisao | Hospedar a versao publica no GitHub Pages. |
| Justificativa tecnica | GitHub Pages entrega o Core estatico por HTTPS; assets privados ficam na conta do usuario no Owlbear. |
| Alternativas consideradas | Netlify, servidor proprio, depender de localhost. |
| Vantagens | Gratuito, simples, suficiente para extensao estatica. |
| Desvantagens | Nao grava arquivos novos em runtime; o Private Asset Pack precisa ser configurado separadamente. |
| Nao alterar quando | O projeto continuar sem backend. |

## 5. Manter diferenca entre publico e local

| Campo | Conteudo |
| --- | --- |
| Problema | Ferramentas de preparacao sao uteis para DemonRider, mas confusas para jogadores. |
| Decisao | Publico deve ser limpo; local pode ter importacao e botoes administrativos. |
| Justificativa tecnica | Separar preparacao de uso reduz risco de usuarios quebrarem a cena. |
| Alternativas consideradas | Um painel unico com tudo sempre visivel. |
| Vantagens | Menos erro em jogo, melhor experiencia publica. |
| Desvantagens | Exige cuidado ao equiparar versoes. |
| Nao alterar quando | Uma funcao for claramente de preparacao de mapas/assets. |

## 6. Atalhos `V`, `C`, `E`, `R`

| Campo | Conteudo |
| --- | --- |
| Problema | Acoes frequentes precisam ser rapidas no desktop. |
| Decisao | Usar `V` para virar, `C` para comprar, `E` para embaralhar e `R` para devolver. |
| Justificativa tecnica | Letras sao memoraveis e evitam conflitos conhecidos usados anteriormente. |
| Alternativas consideradas | `F`, `Shift+V`, apenas botoes. |
| Vantagens | Fluxo rapido para desktop. |
| Desvantagens | Mobile ainda precisa de botoes. |
| Nao alterar quando | A mudanca quebraria memoria muscular dos jogadores. |

## 7. Compra e devolucao por arrasto descontinuadas

| Campo | Conteudo |
| --- | --- |
| Problema | Arrastar pilha/carta parecia imersivo, mas gerou duplicacoes e bugou pilhas, especialmente no mobile. |
| Decisao | Remover comprar por arrasto e devolver por arrasto. |
| Justificativa tecnica | Eventos de movimento do Owlbear podem disparar multiplas vezes e gerar corridas. |
| Alternativas consideradas | Aumentar distancia minima, debounce, lock por item. |
| Vantagens | Reduz duplicacao e estados invalidos. |
| Desvantagens | Perde uma interacao parecida com TTS. |
| Nao alterar quando | Nao houver implementacao robusta, testada em mobile e multiplayer. |

## 8. Devolucao sempre para o fundo da pilha

| Campo | Conteudo |
| --- | --- |
| Problema | O jogo permite deixar carta fora do deck se ela deve ficar no topo. |
| Decisao | Ao devolver pela extensao, a carta entra no fundo. |
| Justificativa tecnica | Evita criar acao extra e deixa o topo sob controle dos jogadores. |
| Alternativas consideradas | Perguntar topo/fundo, criar dois botoes, devolver sempre ao topo. |
| Vantagens | Fluxo simples, previsivel e alinhado ao jogo. |
| Desvantagens | Nao serve para casos onde se deseja devolver automaticamente ao topo. |
| Nao alterar quando | O comportamento de jogo depender de fundo como padrao. |

## 9. Carta comprada respeita face da pilha

| Campo | Conteudo |
| --- | --- |
| Problema | Algumas pilhas precisam estar reveladas; outras precisam comprar no verso. |
| Decisao | A carta comprada nasce na mesma face visual da pilha. |
| Justificativa tecnica | A pilha guarda `currentFace`; a compra deve usar esse estado. |
| Alternativas consideradas | Sempre comprar no verso ou sempre na frente. |
| Vantagens | Flexibilidade sem novas acoes. |
| Desvantagens | Exige cuidado para virar pilha e carta solta corretamente. |
| Nao alterar quando | Pilhas reveladas forem usadas como parte do jogo. |

## 10. Pilha temporaria de missao criada por selecao manual

| Campo | Conteudo |
| --- | --- |
| Problema | Algumas missoes exigem misturar cartas especificas com cartas gerais sem revelar conteudo. |
| Decisao | O usuario compra manualmente as cartas e seleciona exatamente 5 cartas sacadas para criar uma pilha temporaria. |
| Justificativa tecnica | Evita a extensao escolher objetivos pelo nome e preserva segredo das cartas. |
| Alternativas consideradas | Selecionar objetivos por formulario, criar pilha por nomes fixos. |
| Vantagens | Funciona com cartas viradas e regras variaveis. |
| Desvantagens | Depende de selecao correta pelo mestre. |
| Nao alterar quando | O segredo das cartas for importante. |

## 11. Restauracao de mapas por JSON versionado

| Campo | Conteudo |
| --- | --- |
| Problema | Mapas pessoais precisam ser restauraveis sem publicar conteudo protegido nem quebrar URLs antigas. |
| Decisao | Salvar mapas no Private Asset Pack, usando `assetId` canonico e aliases legados. |
| Justificativa tecnica | O pack fornece o JSON e o resolvedor troca IDs/aliases por assets pertencentes ao usuario no Owlbear antes de recriar itens via SDK. |
| Alternativas consideradas | Instruir cada usuario a montar cenas, usar backups manuais do Owlbear. |
| Vantagens | Core publico independente, restauracao reproduzivel e compatibilidade centralizada. |
| Desvantagens | Exige pack e vinculo local; o SDK nao retorna os IDs depois de `uploadImages`. |
| Nao alterar quando | O projeto depender de tabuleiros oficiais prontos. |

## 12. Divindades com tamanho especial

| Campo | Conteudo |
| --- | --- |
| Problema | Cartas de divindade tem proporcao/slot diferentes. |
| Decisao | Fixar largura 2, altura 3, origin X 390 e origin Y 395. |
| Justificativa tecnica | Mantem encaixe visual e evita redimensionar manualmente apos migracao. |
| Alternativas consideradas | Usar tamanho padrao do grupo. |
| Vantagens | Visual consistente. |
| Desvantagens | Regra especial a mais para manter. |
| Nao alterar quando | Slots de divindade continuarem usando esse layout. |

## 13. Slots de raca/classe bloqueados e divindade livre

| Campo | Conteudo |
| --- | --- |
| Problema | Raca e classe devem ficar fixas; divindade precisa permanecer manipulavel. |
| Decisao | Bloquear raca e classe no slot; nao bloquear divindade. |
| Justificativa tecnica | Reflete a dinamica esperada do tabuleiro. |
| Alternativas consideradas | Bloquear tudo ou nao bloquear nada. |
| Vantagens | Menos deslocamento acidental de cartas principais. |
| Desvantagens | Exige tratamento por categoria. |
| Nao alterar quando | As regras visuais do tabuleiro continuarem assim. |

## 14. Paleta visual escura/vermelha

| Campo | Conteudo |
| --- | --- |
| Problema | A UI precisava combinar melhor com o jogo. |
| Decisao | Usar tons escuros e vermelhos, evitando predominancia azul/verde. |
| Justificativa tecnica | Coerencia visual com as cartas e tabuleiro. |
| Alternativas consideradas | Paleta azul/verde anterior. |
| Vantagens | Melhor identidade visual. |
| Desvantagens | Pode exigir ajuste de contraste. |
| Nao alterar quando | A interface publica estiver validada visualmente. |

## 15. Documentar antes de novas correcoes grandes

| Campo | Conteudo |
| --- | --- |
| Problema | O projeto cresceu rapido e acumulou regras historicas importantes. |
| Decisao | Criar documentacao permanente em `docs/`. |
| Justificativa tecnica | Reduz regressao e ajuda continuidade entre sessoes. |
| Alternativas consideradas | Confiar apenas no historico do chat e no README. |
| Vantagens | Facilita manutencao e auditoria. |
| Desvantagens | Requer atualizacao constante. |
| Nao alterar quando | A documentacao for usada como contexto oficial. |

## 16. Normalizacao conservadora em leitura

| Campo | Conteudo |
| --- | --- |
| Problema | Cenas antigas podem conter metadata incompleta, campos desconhecidos ou valores que nao permitem reconstruir com seguranca o estado operacional. |
| Decisao | Normalizar copias em memoria durante a leitura, preservar campos desconhecidos e recusar operacoes quando um valor essencial nao puder ser inferido com seguranca. |
| Justificativa tecnica | A extensao precisa aceitar dados historicos sem regravar toda a cena, inventar estado ou apagar informacoes que pertencam a versoes futuras ou outros fluxos. |
| Alternativas consideradas | Migracao automatica em massa, defaults gravados ao abrir a cena, limpeza de campos desconhecidos e aceitacao permissiva de valores ambiguos. |
| Vantagens | Preserva compatibilidade, evita mutacao silenciosa e reduz risco de perda de cartas, pilhas ou metadata. |
| Desvantagens | Metadata irrecuperavel permanece armazenada e certas operacoes sao recusadas ate existir uma correcao explicita e segura. |
| Nao alterar quando | Nao houver migracao versionada, testada e explicitamente autorizada por DemonRider. |
