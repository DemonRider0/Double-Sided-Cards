# Checklist de testes — Cartas Duplas

Este checklist deve ser usado antes de publicar mudanças no GitHub Pages e também após alterações importantes na versão local.

## Regras gerais de teste

- Testar no desktop.
- Testar no mobile quando a mudanca afetar jogadores.
- Testar com pelo menos duas contas quando a mudanca envolver cor, slots, pilha ou mapa.
- Confirmar que o manifesto aponta para a versao correta.
- Confirmar que nao ha `Image Unavailable`.
- Confirmar que o Core publicado nao contem `assets/preset-*`, `assets/scene-presets` nem `assets/local-assets`.

## Instalacao e carregamento

- Abrir `manifest.json` publico no navegador.
- Adicionar extensao customizada no Owlbear.
- Abrir painel da extensao.
- Confirmar status conectado.
- Confirmar que botoes do Owlbear aparecem.
- Dar F5 e confirmar que comandos continuam aparecendo.
- Testar em segunda conta.
- Testar no celular.
- Sem configurar um pack, confirmar que o painel carrega, as acoes/atalhos funcionam e bibliotecas/mapas pessoais aparecem indisponiveis sem erro global.

## Private Asset Pack

- Selecionar a pasta que contem `private-asset-pack.json`.
- Confirmar nome, tamanho, assets disponíveis e vínculos existentes exibidos no painel, sem indicação de etapa obrigatória.
- Usar **Upload opcional** e confirmar que os assets aparecem na biblioteca privada da conta.
- Usar **Vincular manualmente** para uma seleção parcial e confirmar que vínculos anteriores são preservados sem exigir o pack inteiro.
- Tentar usar uma carta, pilha ou cena sem o binding necessário; confirmar a orientação de vínculo manual e que nenhum seletor abre automaticamente.
- Fechar e reabrir o painel; confirmar que pack e vínculos continuam configurados.
- Dar F5 na sala; confirmar que nao e necessario selecionar o pack novamente.
- Com os bindings necessários disponíveis, criar uma carta e uma pilha de cada biblioteca relevante e confirmar frente, verso, tamanho, camada e ordem.
- Abrir uma cena antiga com URL de GitHub Pages, `localhost/.local-assets` ou ID Owlbear conhecido; usar **Sincronizar cena** e confirmar migracao para o asset privado correto.
- Confirmar que duas referencias aliases do mesmo conteudo usam a mesma imagem canônica.
- Remover apenas a configuracao local do pack; confirmar que o Core continua carregando e que os assets enviados permanecem na conta do Owlbear.
- Em outro navegador/perfil, confirmar a limitacao esperada: o pack ou os assets precisam ser vinculados novamente porque o SDK nao oferece armazenamento global da extensao.

## Carta dupla

- Criar ou carregar carta com frente e verso.
- Virar pelo botao do Owlbear.
- Virar pelo painel.
- Virar pelo atalho `V`.
- Confirmar frente correta.
- Confirmar verso correto.
- Confirmar carta com frente e verso iguais usando espelhamento.
- Confirmar grid/tamanho preservado.
- Confirmar camada correta.
- Confirmar que carta comprada de pilha continua viravel.

## Pilha

- Criar ou carregar pilha da biblioteca.
- Confirmar contador inicial.
- Comprar uma carta com botao do Owlbear.
- Comprar uma carta com atalho `C`.
- Confirmar que apenas uma carta saiu.
- Confirmar que contador reduziu antes/depois corretamente.
- Confirmar que a carta saiu na face correta da pilha.
- Virar topo/pilha com `V`.
- Comprar de pilha virada para frente.
- Comprar de pilha no verso.
- Embaralhar com botao.
- Embaralhar com atalho `E`.
- Devolver carta com botao.
- Devolver carta com atalho `R`.
- Confirmar que devolucao vai para o fundo.
- Confirmar que carta devolvida nao duplica.
- Confirmar que carta devolvida some da cena.
- Confirmar que pilha temporaria some quando vazia.

## Concorrencia de pilhas

- Dois jogadores compram da mesma pilha quase ao mesmo tempo.
- Dois jogadores embaralham a mesma pilha quase ao mesmo tempo.
- Um jogador compra enquanto outro embaralha.
- Dois jogadores tentam devolver cartas para a mesma pilha.
- Verificar contador apos cada tentativa.
- Verificar se nenhuma carta duplicou.
- Verificar se nenhuma carta desapareceu.

## Pilha de missao

- Selecionar menos de 5 cartas e tentar criar pilha: deve falhar.
- Selecionar mais de 5 cartas e tentar criar pilha: deve falhar.
- Selecionar exatamente 5 cartas sacadas e criar pilha.
- Confirmar que cartas soltas originais foram removidas.
- Confirmar que pilha temporaria pode embaralhar.
- Comprar todas as cartas.
- Confirmar que a pilha se apaga ao ficar vazia.
- Testar cartas com versos diferentes.

## Biblioteca de pilhas

Para cada pilha:

- Ameacas Elite;
- Armas;
- Salas;
- Salas-Refugiados;
- Salas-Objetivos;
- Salas-Normais;
- Poderes da Tormenta Nivel 1;
- Poderes da Tormenta Nivel 2;
- Poderes da Tormenta Nivel 3;
- Eventos.

Checklist:

- Selecionar pilha no painel.
- Confirmar quantidade cadastrada.
- Confirmar tamanho padrao.
- Confirmar camada padrao.
- Criar pilha.
- Comprar carta.
- Embaralhar.
- Devolver carta.
- Confirmar que criar nova pilha da biblioteca nao consome a anterior.

## Biblioteca de cartas

Para cada grupo:

- Classes;
- Racas;
- Divindades;
- Reacoes Heroicas;
- Herois;
- Herois Montaria.

Checklist:

- Selecionar grupo.
- Selecionar carta.
- Confirmar tamanho padrao.
- Confirmar camada padrao.
- Criar carta.
- Virar carta.
- Confirmar verso correto.
- Confirmar verso individual quando existir.
- Confirmar que Classes entram como `class`.
- Confirmar que Racas entram como `race`.
- Confirmar que Divindades entram como `divinity`.

## Divindades

- Criar divindade da biblioteca.
- Confirmar largura 2.
- Confirmar altura 3.
- Confirmar origin X 390.
- Confirmar origin Y 395.
- Migrar links locais, se estiver no fluxo local.
- Confirmar que tamanho/origem nao mudou.
- Selecionar divindade para slot.
- Confirmar que nao fica bloqueada.

## Selecao de jogador por cor

- Clicar no identificador vermelho.
- Confirmar `Jogadores e cores`.
- Clicar no identificador branco.
- Confirmar `Jogadores e cores`.
- Repetir para verde e azul.
- Tentar duas contas na mesma cor.
- Confirmar que uma cor ocupada nao e assumida indevidamente.
- Confirmar pointer/cor ativa quando aplicavel.
- Confirmar que mensagens repetitivas nao poluem a tela.

## Slots de raca, classe e divindade

- Escolher cor.
- Clicar em uma raca marcada.
- Confirmar que vai para slot correto.
- Confirmar que aparece acima do card-slot.
- Confirmar que raca fica bloqueada.
- Clicar em outra raca.
- Confirmar que a anterior volta centralizada para origem.
- Repetir com classe.
- Confirmar que classe fica bloqueada.
- Repetir com divindade.
- Confirmar que divindade nao fica bloqueada.
- Tentar pegar carta que esta no slot de outro jogador.
- Usar `Devolver origem`.

## Criacao de cenas privadas

Para cada mapa:

- Tutorial;
- Missao 0.5 (nao oficial).

Checklist:

- Manter aberta uma cena com itens de controle.
- Criar a cena pelo botão correspondente e confirmar que a cena aberta não mudou.
- Abrir no Atlas a nova cena criada.
- Confirmar quantidade aproximada de itens.
- Confirmar que cartas/pilhas aparecem sem erro.
- Confirmar que slots e identificadores funcionam.
- Confirmar que o selection board foi inicializado e que metadata de outras extensões não foi copiada como metadata da cena.
- Criar o mesmo template novamente e confirmar cenas independentes.
- Confirmar que bibliotecas funcionam depois da criação.
- Confirmar que `Jogadores e cores` atualiza.
- Testar no desktop.
- Testar no celular.

## Mobile

- Abrir sala no celular.
- Confirmar que a extensao carrega por URL publica, nao `localhost`.
- Confirmar que botoes essenciais aparecem.
- Virar carta por botao.
- Comprar carta por botao.
- Embaralhar por botao.
- Devolver carta por botao.
- Criar uma cena privada e abri-la pelo Atlas somente quando todos os assets do template estiverem acessíveis, se permitido para o usuário.
- Confirmar que imagens nao ficam piscando/desfocadas.
- Confirmar que assets grandes nao travam o navegador.
- Confirmar que painel nao fica inutilizavel.

## Publicacao

- Rodar `npm run build`.
- Confirmar `dist/` atualizado.
- Confirmar `manifest.json` com versao/cache novo.
- Confirmar URLs `/Double-Sided-Cards/...`.
- Confirmar `.nojekyll`.
- Confirmar ausencia de caminhos locais.
- Confirmar ausencia dos quatro diretorios privados e de binarios protegidos no artefato do Pages.
- Validar o Private Asset Pack separadamente com `npm run check:private-asset-pack -- --pack <diretorio>`.
- Commitar.
- Fazer push.
- Esperar GitHub Pages publicar.
- Testar link publico do manifesto.
- Reinstalar ou atualizar extensao no Owlbear com cache novo.

## Regressao rapida antes de jogar

- Abrir painel.
- Criar e abrir a cena correta pelo Atlas.
- Escolher cor.
- Escolher raca.
- Escolher classe.
- Escolher divindade.
- Criar pilha de biblioteca.
- Comprar carta.
- Virar carta.
- Embaralhar pilha.
- Devolver carta.
- Criar pilha de missao.
