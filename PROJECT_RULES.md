# Regras do projeto — Double-Sided Cards

Autor e dono do projeto: DemonRider.

Este arquivo registra as regras permanentes do projeto. Qualquer alteração futura deve respeitar estas decisões, a menos que DemonRider peça explicitamente o contrário.

## Objetivo do projeto

- Esta extensao existe para o Owlbear Rodeo e simula cartas e pilhas de cartas de mesa, com frente, verso, virar carta, comprar carta, embaralhar pilha, devolver carta para pilha, mapas salvos e selecao de jogador por cor.
- O foco principal e funcionar para desktop e mobile, especialmente para jogadores que usam celular.
- A experiencia deve continuar parecida com o Tabletop Simulator, mas usando tokens/imagens 2D do Owlbear Rodeo.
- Nao transformar a extensao em landing page, site promocional ou ferramenta generica fora do Owlbear.

## Pastas do projeto

- `Double-Sided-Cards` e a versao publica/GitHub Pages.
- `Double-Sided-Cards-Local` e a versao local/localhost de desenvolvimento.
- Alteracoes pedidas para "git", "publico", "GitHub" ou "versao publica" devem ficar apenas em `Double-Sided-Cards`.
- Alteracoes pedidas para "local", "localhost" ou "testes locais" devem ficar apenas em `Double-Sided-Cards-Local`.
- So equiparar as duas pastas quando DemonRider pedir explicitamente.
- Ao equiparar, manter as diferencas intencionais entre publico e local descritas neste arquivo.

## Diferencas que devem ser preservadas

- A versao publica nao deve depender de `localhost`, arquivos locais do computador ou caminhos absolutos do Windows.
- A versao publica deve funcionar por GitHub Pages sem depender de assets protegidos ou pessoais no repositorio.
- Bibliotecas, presets e imagens pessoais pertencem a um Private Asset Pack local e a assets do usuario no Owlbear Rodeo.
- A versao local pode manter recursos de importacao e marcacao usados para preparar cenas, backups e testes.
- A versao publica deve ser mais limpa para jogadores: nao reintroduzir menus locais de importacao ou marcacao se eles tiverem sido removidos.
- A versao local pode ter botoes administrativos, como marcar identificadores de cor, marcar raca, marcar classe, marcar divindade e importar cartas/pilhas.

## Autoria e documentação

- Toda autoria deve apontar para DemonRider.
- Não inserir créditos, autoria ou referências de processo que não pertençam ao produto e à sua manutenção.
- Textos visíveis ao usuário devem estar em português, exceto nomes técnicos exigidos pelo Owlbear, manifest, código, chaves internas e nomes de camadas.
- Comentários e documentação devem ser objetivos e voltados ao uso e à manutenção da extensão.

## Regras de build e cache

- Sempre que `src` mudar, rodar `npm run build` antes de considerar a versao pronta.
- Os arquivos em `dist` fazem parte da entrega publica e devem ser atualizados junto com `src`.
- Ao alterar JS, HTML, CSS, manifest ou background, atualizar o cache busting:
  - Publico: `?v=NN` e `version` do `manifest.json`.
  - Local: `?v=local-NN` e `version` com sufixo `-local`.
- Nao misturar versoes de cache entre publico e local.
- Antes de subir para GitHub, verificar se o `manifest.json` publico aponta para `/Double-Sided-Cards/...`.

## Owlbear Rodeo

- Manter compatibilidade com comandos do Owlbear, menu de contexto, botoes da extensao e atalhos de teclado ja criados.
- Atalhos esperados:
  - `V`: virar carta ou topo da pilha selecionada.
  - `C`: comprar carta da pilha.
  - `E`: embaralhar pilha.
  - `R`: devolver carta para pilha.
- Nao usar teclas que conflitem com atalhos nativos importantes do Owlbear.
- Mobile deve continuar sendo prioridade: comandos essenciais precisam funcionar sem depender de teclado.
- A extensao nao deve exigir um Private Asset Pack para carregar ou manipular cartas e pilhas ja existentes; o pack e opcional para bibliotecas e mapas pessoais.

## Cartas

- Uma carta dupla deve manter metadados de frente, verso, face atual, largura no grid e origem quando aplicavel.
- Cartas compradas de uma pilha devem respeitar a face atual da pilha: se a pilha estiver no verso, comprar no verso; se estiver virada, comprar virada.
- Se frente e verso forem a mesma imagem, o verso pode ser espelhado para simular o flip.
- Nao quebrar cartas ja existentes em cenas salvas antigas.
- A funcao de virar carta deve distinguir corretamente carta solta e pilha selecionada.

## Pilhas

- Pilhas devem guardar lista de cartas, verso, largura no grid, camada, face atual e contagem visivel.
- Comprar carta deve remover apenas uma carta da pilha por acao.
- Devolver carta para pilha deve devolver para o fundo da pilha, nao para o topo.
- A contagem da pilha deve atualizar corretamente antes e depois de comprar, devolver, embaralhar ou restaurar cena.
- A funcao de arrastar carta para dentro da pilha e a funcao de comprar arrastando para fora da pilha foram descontinuadas. Nao reintroduzir sem pedido explicito.
- Pilhas temporarias marcadas para apagar quando vazias devem sumir ao comprar a ultima carta.

## Pilha de missao

- A pilha de missao deve ser criada a partir de cartas ja sacadas e selecionadas na cena.
- Nao escolher automaticamente cartas de objetivo pelo nome ou por seletor no painel.
- Fluxo correto:
  - DemonRider compra manualmente as cartas necessarias.
  - Seleciona exatamente 5 cartas duplas sacadas.
  - Usa `Criar pilha com selecao`.
  - A extensao cria uma pilha temporaria embaralhada com essas cartas e remove as cartas soltas originais.
- Essa pilha deve poder ser embaralhada, comprada e apagada automaticamente quando ficar vazia.

## Biblioteca de pilhas

- As pilhas de biblioteca sao backups infinitos: criar uma pilha da biblioteca nao deve consumir a biblioteca.
- Pilhas conhecidas:
  - Ameacas Elite
  - Armas
  - Salas
  - Salas-Refugiados
  - Salas-Objetivos
  - Salas-Normais
  - Poderes da Tormenta Nivel 1
  - Poderes da Tormenta Nivel 2
  - Poderes da Tormenta Nivel 3
  - Eventos
- Tamanhos padrao que devem ser preservados:
  - Ameacas Elite: 4.5
  - Armas: 2.25
  - Salas: 1.5
  - Salas-Refugiados: 1.5
  - Salas-Objetivos: 1.5
  - Salas-Normais: 1.5
  - Poderes da Tormenta Nivel 1: 2.0
  - Poderes da Tormenta Nivel 2: 2.0
  - Poderes da Tormenta Nivel 3: 2.0
  - Eventos: 2.25
- O verso de cada pilha de biblioteca deve continuar seguindo a convencao `verso.png`, salvo pedido contrario.

## Biblioteca de cartas

- As cartas de biblioteca tambem sao backups infinitos: criar uma carta da biblioteca nao deve consumir a biblioteca.
- Cartas de biblioteca devem ficar no manifest `presets/cards.json` do Private Asset Pack e referenciar assets canonicos por `assetId`.
- Grupos conhecidos:
  - Classes
  - Racas
  - Divindades
  - Reacoes Heroicas
  - Herois
  - Herois Montaria
- O verso de cada grupo deve continuar seguindo a convencao `Verso.png`, mas cartas individuais podem ter verso proprio com o mesmo nome da frente seguido de `verso`, como `Thwor.png` e `Thwor verso.png`.
- Classes devem nascer marcadas como `class` para o sistema de slots.
- Racas devem nascer marcadas como `race` para o sistema de slots.
- Divindades devem nascer marcadas como `divinity` e preservar o tamanho especial de divindade.
- Reacoes Heroicas e Herois devem nascer como cartas duplas comuns, sem categoria de slot, salvo pedido contrario.
- Tamanhos e camadas padrao das cartas de biblioteca:
  - Classes: largura 3, camada Mount.
  - Racas: largura 3, camada Mount.
  - Reacoes Heroicas: largura 1.25, camada Mount.
  - Herois: largura 6, camada Mount, origin X 885.00 e origin Y 531.50.
  - Herois Montaria: largura 1, camada Mount.
- Depois do vinculo do pack, a versao publica deve criar essas cartas a partir de assets pertencentes ao usuario no Owlbear, nunca de binarios protegidos no GitHub Pages.

## Camadas

- Manter suporte para as camadas do Owlbear:
  - Drawing
  - Prop
  - Mount
  - Character
  - Attachment
  - Note
  - Text
- Nao simplificar as camadas para apenas Mesa, Personagem e Anexo.
- As camadas sao usadas como hierarquia visual das cartas no tabuleiro.

## Selecao de jogador por cor

- Cores principais: vermelho, branco, verde e azul.
- Cada jogador deve poder se atrelar a uma cor por identificador de cor no tabuleiro.
- Nao permitir que dois ou mais jogadores controlem a mesma cor quando a restricao estiver ativa.
- A secao `Jogadores e cores` deve mostrar quem esta com qual cor e tambem cores sem jogador.
- Nao permitir que um jogador mova para si uma raca, classe ou divindade que ja esta no slot de outra cor.
- A troca de raca, classe ou divindade deve devolver a carta anterior para sua posicao original de selecao.
- Mensagens repetitivas de selecao de raca/classe/divindade devem permanecer removidas para nao poluir a tela.

## Slots de raca, classe e divindade

- As cartas de raca e classe enviadas para slot devem ficar bloqueadas.
- As cartas de divindade nao devem ser bloqueadas, salvo pedido contrario.
- Cartas escolhidas devem aparecer acima dos cards-slot, nao embaixo.
- Ao substituir uma escolha, a carta anterior deve voltar centralizada para a posicao original.
- Cartas que ja estao em slots de jogador nao devem ser tratadas como novas opcoes de selecao.
- O comando `Devolver origem` deve continuar disponivel na secao `Acoes`.

## Divindades

- Cartas de divindade devem preservar o padrao de tamanho:
  - largura: 2
  - altura: 3
  - origin X: 390.00
  - origin Y: 395.00
- A migracao de links locais nao deve quebrar esse tamanho.

## Mapas salvos

- O mecanismo de restauracao de mapas e parte essencial do Core; os presets pessoais ficam no Private Asset Pack.
- Mapas atuais:
  - Tutorial
  - Missao 0.5 (nao oficial)
- Restaurar mapa salvo deve reconstruir a cena de forma jogavel para quem instalar a extensao publica.
- Nao apagar, renomear ou substituir presets de cena sem pedido explicito.
- Sem Private Asset Pack, a extensao deve carregar normalmente e apenas informar que nao ha mapas privados cadastrados.
- Ao alterar mapas privados, preservar IDs e transformar caminhos/URLs historicos em aliases para assets canonicos.

## Publicacao e assets

- O GitHub Pages e a plataforma publica escolhida para esta extensao.
- O Core publico nao deve conter `assets/preset-cards`, `assets/preset-decks`, `assets/scene-presets` nem `assets/local-assets`.
- O Private Asset Pack deve ficar fora do repositorio publico, manter os binarios originais e usar um unico arquivo por hash SHA-256.
- Caminhos, URLs e IDs historicos conhecidos devem ser preservados como aliases; nao remover compatibilidade porque uma referencia parece inativa.
- O resolvedor central deve converter `assetId` ou alias para a URL retornada pela biblioteca privada do usuario no Owlbear.
- A configuracao do pack e seus vinculos devem persistir por origem do navegador; nao incluir URLs privadas no repositorio.
- Nao reintroduzir o fluxo que copia `.local-assets` para `assets/local-assets` para publicacao.

## Interface visual

- A paleta atual tende para tons escuros e vermelhos, combinando com o jogo.
- Evitar retornar o painel para tons dominantes de azul ou verde sem pedido explicito.
- Manter o painel limpo, compacto e util para jogo em andamento.
- Evitar mensagens de sucesso excessivas que atrapalhem a visualizacao da mesa.

## Funcionalidades removidas ou proibidas sem pedido explicito

- Nao reintroduzir comprar carta arrastando a pilha.
- Nao reintroduzir devolver carta arrastando para a pilha.
- Nao reintroduzir seletores manuais de objetivo para criar pilha de missao.
- Nao reintroduzir botoes redundantes de `usar essa cor` ou comandos de marcar no publico se eles foram removidos.
- Nao transformar a versao publica em ferramenta de importacao local.
- Nao apagar presets, aliases legados ou metadados de cartas para "limpar" o projeto; mova conteudo privado para o pack e preserve a compatibilidade logica.

## Checklist antes de publicar

- Rodar `npm run build`.
- Confirmar que `dist` foi atualizado.
- Confirmar que `manifest.json` esta valido.
- Confirmar que o cache `?v=...` foi incrementado.
- Confirmar que nao ha binarios ou manifests privados no Core publico.
- Confirmar que a instalacao sem pack carrega sem erro e deixa bibliotecas/mapas pessoais indisponiveis.
- Confirmar que o pack privado vincula assets do Owlbear e restaura aliases antigos sem `Image Unavailable`.
- Confirmar que cartas, pilhas, mapas salvos, atalhos e botoes principais continuam funcionando.
- Testar pelo menos:
  - virar carta
  - comprar carta
  - embaralhar pilha
  - devolver para pilha
  - criar pilha com selecao
  - restaurar Tutorial
  - restaurar Missao 0.5
  - selecao de jogador por cor
  - slots de raca, classe e divindade
