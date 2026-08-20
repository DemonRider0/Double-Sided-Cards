# Histórico de auditorias — Cartas Duplas

Este arquivo consolida auditorias realizadas durante o desenvolvimento. Use-o como histórico técnico e como entrada para planos de correção.

## 2026-08-20 - Encerramento da vinculação automática

- O fluxo sob demanda foi removido: `downloadImages` só é chamado pelo botão explícito de vínculo manual.
- Upload e bindings do Private Asset Pack são opcionais; Core, aliases, metadados e cenas antigas permanecem preservados sem pack completo.
- A criação/restauração automática de templates privados só é habilitada quando todos os `ImageContent` necessários já estão acessíveis pelo Owlbear.

## 2026-08-11 - Separacao do Core e Private Asset Pack

- O Core deixou de hospedar `preset-cards`, `preset-decks`, `scene-presets` e `local-assets`; instalacoes sem pack continuam carregando com as bibliotecas e mapas pessoais indisponiveis.
- `asset-resolver.js` centraliza IDs canonicos, aliases historicos, migracao de referencias e vinculos persistidos para `ImageContent` pertencente ao usuario no Owlbear.
- O pack privado foi gerado fora do repositorio publico com 243 binarios canonicos para 937 arquivos de origem. Foram removidas 694 copias fisicas exatas, preservando 1697 aliases e 1646 referencias logicas nos manifests e mapas.
- O SDK instalado, `@owlbear-rodeo/sdk 3.1.0`, disponibiliza `uploadImages` e `downloadImages`. Como `uploadImages` retorna `Promise<void>`, envio e vinculo precisam ser etapas separadas; o vinculo persiste no armazenamento da origem do navegador.
- Nenhuma imagem foi recomprimida, o historico Git nao foi reescrito e a versao/cache nao foram alterados por esta arquitetura.
- Os testes automatizados cobrem resolucao canonica, aliases de URL/caminho/ID, ausencia de pack, persistencia, hidratacao dos manifests e carregamento das bibliotecas. Upload, selecao real, persistencia entre sessoes e restauracao visual continuam pendentes de teste manual no Owlbear.

## 2026-08-11 - Preparação da versão 1.0.0

- A versão pública e o pacote de desenvolvimento foram unificados em `1.0.0`; os registros históricos de versões anteriores foram preservados.
- O cache busting manual dos recursos públicos foi consolidado em `v=100`, sem alterar caminhos, IDs ou URLs persistidas além desse parâmetro.
- A descrição pública do manifesto foi atualizada para refletir cartas, pilhas, bibliotecas, mapas salvos e jogadores por cor.
- A limitação residual de devolução simultânea da mesma instância por clientes diferentes foi registrada como uma janela rara de concorrência distribuída. `returnedSceneItemId` mantém a idempotência de retries e repetições locais, mas o SDK não fornece transação distribuída ou compare-and-swap.
- `npm ci`, `npm ls --all`, `npm run check` antes e depois do build, geradores, duas reconstruções de `dist/`, regressões focadas, `node --check`, parsing dos JSONs, verificação dos links internos e `git diff --check` passaram. Geradores e build produziram hashes idênticos em execuções consecutivas; permaneceram somente os avisos transitivos conhecidos de `uuid` e do SDK no Rollup.
- Assets binários, manifests de bibliotecas, presets completos, IDs e formatos de metadata permaneceram sem diff. O arquivo preexistente não rastreado `assets/scene-presets.zip` foi preservado e não integra as alterações da release.
- Nenhuma publicação, tag, push, alteração de assets ou nova funcionalidade faz parte desta preparação.

## 2026-08-10 - Consolidação automática final

- O diff acumulado foi confrontado com fontes, bundles e documentação. A instalação limpa com `npm ci`, `npm ls --all`, `npm run check` antes e depois do build, geradores, duas reconstruções de `dist/`, `node --check`, parsing dos JSONs, auditoria de assets, testes hostis de metadata/presets, verificações focadas do servidor e `git diff --check` passaram.
- Não foram encontradas regressões, conflitos entre etapas nem arquivos gerados desatualizados. Geradores e build reproduziram os mesmos hashes em execuções consecutivas; permaneceram somente os avisos transitivos conhecidos de `uuid` e do SDK no Rollup.
- Os hashes de manifesto, package/lockfile, bibliotecas, índice, presets e bundles permaneceram iguais ao baseline. IDs, formatos de metadata e presets, URLs persistidas, ordem/defaults das bibliotecas, 953 assets binários, versão pública e parâmetros de cache não foram alterados.
- Estado: pronto para uma rodada manual consolidada no Owlbear Rodeo. Nenhum teste manual foi considerado realizado nesta consolidação.

### Áreas deduplicadas que ainda dependem do Owlbear real

- carregamento da extensão, background, comandos, permissões da sala e estados de conexão/erro;
- virar, comprar, embaralhar, devolver e sincronizar cartas/pilhas, inclusive concorrência, repetição rápida e metadata antiga;
- criação da pilha temporária de missão e seus caminhos de falha;
- cores, identificadores, slots, troca/devolução de cartas e uso simultâneo por duas contas;
- restauração dos dois mapas em cenas vazias e ocupadas, repetição, concorrência, interrupção, marcador órfão e rollback;
- teclado, foco, leitor de tela, toque, confirmações, feedback assíncrono e layout em desktop/mobile;
- carregamento/renderização real de assets (latência, cache, CORS e redirects) e integração do iframe com o servidor administrativo local.

## 2026-08-10 - Organização e apresentação do repositório

### Escopo e resultado

- A documentação foi separada por público: `README.md` passou a orientar o usuário da extensão, enquanto `DEVELOPMENT.md` concentra desenvolvimento, manutenção, build, assets, mapas e publicação futura.
- O histórico de mudanças foi preservado como `CHANGELOG.md`. O conteúdo técnico útil dos antigos documentos de contexto e operação foi consolidado em `DEVELOPMENT.md`, `PROJECT_RULES.md`, arquitetura, decisões de design e neste histórico, eliminando nomenclatura ligada ao processo de produção.
- `docs/IMPLEMENTATION_PLAN.md` passou a se apresentar explicitamente como registro do plano S-01 a S-20 já concluído. `docs/AUDIT_HISTORY.md` permanece como registro técnico detalhado; arquitetura, decisões e checklist de testes continuam especializados.
- O backup ignorado `assets/preset-decks/decks.json.bak` era um esqueleto antigo com sete pilhas vazias, todas substituídas pelo manifest atual de dez pilhas, e foi removido. Dois diretórios locais de configuração que estavam vazios também foram removidos. `docs.zip` não existia no estado revisado.
- As chaves históricas `br.codex.double-sided-cards/*` presentes nos presets foram mantidas: são metadados persistidos de compatibilidade, não créditos ou vestígios documentais, e esta etapa proíbe alterar presets, IDs e formatos persistidos.

### Limites preservados

- Nenhum comportamento, fonte funcional, dependência, asset, preset, manifest, ID, versão pública ou parâmetro de cache foi alterado por esta revisão.
- A diferença entre `package.json` (`0.1.0`, pacote privado) e `manifest.json` (`0.2.69`, versão pública) foi documentada e deixada para uma futura decisão de versionamento/publicação.
- A descrição do manifesto permanece mais estreita e com ortografia anterior à documentação pública atual. Ela não foi alterada porque esta etapa preserva o manifesto, a versão e os parâmetros de cache.
- Não foi criado arquivo de licença porque o repositório não registra uma decisão de licenciamento que possa ser inferida com segurança.
- Nenhum teste manual no Owlbear Rodeo foi considerado realizado nesta etapa.

### Validação automática

- `npm.cmd run check` passou antes e depois do build, validando 8 JSONs, 29 arquivos JS/MJS, 191 assets de biblioteca e 1455 referências de mapas. A forma `npm run` foi bloqueada somente pela política local do PowerShell para `npm.ps1`; o executável equivalente `npm.cmd` executou os scripts do projeto normalmente.
- `npm.cmd run build` passou e regenerou os bundles. Permaneceram apenas os avisos conhecidos do Rollup sobre `this` nos módulos do Owlbear SDK.
- `node --check` passou nos 29 arquivos JS/MJS aplicáveis. Os 8 JSONs também foram analisados diretamente com `JSON.parse` do Node.
- `git diff --check`, os 11 arquivos Markdown, 19 caminhos internos e 7 scripts documentados passaram pelas verificações de integridade e existência.
- Os hashes de `manifest.json`, package/lockfile, manifests das bibliotecas, índice e dois presets permaneceram iguais ao baseline desta revisão. Nenhum dos 953 assets de runtime foi alterado; somente os READMEs internos das bibliotecas mudaram dentro de `assets/`.

## 2026-08-10 - Seguranca e fronteiras de confianca

### Superficies e operacoes auditadas

- Foram tratados como nao confiaveis nomes e metadata de itens, metadata de
  cena/jogador, manifests das bibliotecas, presets JSON, URL publica informada
  no painel, URLs de imagens e parametros do servidor local. Tambem foram
  revisados os scripts, assets SVG, dependencias diretas e arquivos
  distribuidos.
- Os sinks mapeados foram DOM e atributos, `Image.src`, `fetch`, object URLs,
  URLs entregues ao SDK, atualizacoes de itens/metadata, copias e mesclas de
  objetos, leitura/escrita de JSON e resolucao de caminhos no servidor local.
- Nao existem `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`,
  `eval`, `Function`, strings executadas como codigo, links dinamicos ou SVG
  ativo. Conteudo da cena e dos catalogos chega ao painel por `textContent`,
  `value` e criacao explicita de elementos. Atributos dinamicos sao ARIA com
  nomes fixos; estilos alterados em runtime recebem apenas opacidades numericas
  calculadas internamente.

### Vulnerabilidades concretas e correcoes

- O clonador conservador de metadata copiava chaves por atribuicao em um objeto
  comum. Uma chave JSON `__proto__` alterava o prototipo da copia; foi
  reproduzido que `__proto__.sourceDeckId` passava a ser lido como a pilha de
  origem de uma carta e podia direcionar a devolucao para outro item da cena.
  A copia agora define propriedades proprias sem acionar o setter de prototipo,
  e a preservacao de campos desconhecidos na devolucao usa `Object.fromEntries`.
- Presets aceitavam a mesma chave especial e depois copiavam chaves de itens e
  metadata dinamicamente. A validacao passou a recusar somente `__proto__` em
  qualquer nivel, antes de mutar a cena; campos desconhecidos comuns e o
  formato persistido continuam preservados.
- `dev-server.mjs` omitia o host e, nesta plataforma, escutava em `::`, enquanto
  endpoints capazes de gravar assets, substituir presets e buscar imagens
  respondiam a origens externas por CORS. O servidor agora escuta apenas em
  `127.0.0.1`; endpoints internos exigem origem exatamente local quando o
  cabecalho `Origin` existe. O cache remoto passou a exigir POST e URL HTTP(S).
  `localhost` e `.local-assets` continuam disponiveis no fluxo administrativo.

### Casos analisados e mantidos

- Presets publicos validam toda a estrutura antes da restauracao e recusam
  URLs locais, caminhos Windows, `file:` e qualquer campo `url` que nao seja
  HTTP(S). Os dois mapas atuais contem apenas HTTPS publico. Manifests de
  biblioteca sao normalizados e alimentam somente texto e recursos de imagem;
  nenhum valor chega a HTML ou codigo executavel.
- `data:` e `blob:` permanecem aceitos apenas pelo helper de assets de imagem.
  Nao ha valor persistido com esses esquemas nem caminho para navegacao, HTML
  ou execucao; remove-los sem vetor concreto reduziria compatibilidade.
- O fetch de URL de cena ocorre apenas no fluxo administrativo local, depois de
  classificacao HTTP(S) e acao explicita. Object URLs sao criadas para blobs de
  imagem e sempre revogadas. A URL publica informada pelo usuario aceita apenas
  HTTP(S) e e usada para reconstruir URLs de assets, nao para navegar.
- A resolucao de arquivos estaticos usa caminho absoluto e confirma a raiz; IDs
  de presets gravaveis usam mapa fixo, nomes de uploads sao sanitizados e os
  scripts auxiliares operam em diretorios fixos. Nao foi encontrado path
  traversal concreto.
- Nao foram encontrados tokens, chaves, credenciais, arquivos privados ou
  caminhos absolutos da maquina no produto distribuido. As referencias locais
  restantes pertencem ao servidor e aos ramos de migracao intencionais.

### Dependencias, validacao e limites

- `npm audit` continua informando duas ocorrencias moderadas do mesmo alerta:
  `uuid` transitivo e seu efeito sobre `@owlbear-rodeo/sdk`. Nao ha correcao
  disponivel na arvore atual. O SDK 3.1.0 importa somente `v4`; o alerta cobre
  `v3`, `v5` e `v6` quando o chamador fornece buffer. Nao foi encontrado vetor
  aplicavel e nenhuma dependencia foi atualizada.
- `npm run check` passou antes e depois do build, validando 8 JSONs, 29 arquivos
  JS/MJS, 191 assets de biblioteca e 1455 referencias de mapas. `npm run build`,
  `node --check`, `git diff --check`, os testes hostis de prototipo/preset e os
  testes HTTP focados do servidor passaram; permaneceram apenas os avisos
  conhecidos do SDK no Rollup.
- Hashes dos dois presets completos, indice, manifests de cartas/pilhas,
  manifesto publico e lockfile permaneceram iguais ao baseline da auditoria.
  IDs, metadata, URLs persistidas, formatos, assets, versao e cache busting nao
  foram alterados.
- Dependem do ambiente real do Owlbear o tratamento final de URLs de imagem,
  redirects e CORS pelo renderer, a apresentacao de nomes/notificacoes pelo SDK,
  as permissoes efetivas da sala e a integracao do iframe com o localhost. Nao
  foi exigido teste manual nesta etapa.
- Conclusao: depois das correcoes acima, nao restou caminho concreto de alta
  confianca entre entrada nao confiavel e execucao, injecao no DOM, acesso
  inesperado a recursos ou comportamento inseguro que justifique outra etapa
  antes dos testes manuais.

## 2026-08-10 - Interface, acessibilidade basica e feedback

### Escopo e problemas objetivos

- Foram auditados `index.html`, `src/styles.css`, o controle do painel e as
  mensagens que seus fluxos exibem, sem reabrir S-01 a S-20, arquitetura,
  performance, metadata ou regras transacionais.
- Os selects visuais escondiam o controle nativo, mas o botao substituto era
  anunciado apenas pelo valor atual, sem o nome do campo. A abertura e a
  escolha tambem nao ofereciam o comportamento esperado para setas,
  Enter/Espaco, Home/End e Escape, e o foco podia ficar no item ocultado apos a
  selecao.
- Acoes do painel desabilitavam o proprio botao, mas virar, comprar,
  embaralhar, devolver e sincronizar nao informavam o processamento. Uma
  devolucao bem-sucedida apagava a mensagem final. Falha secundaria ao mostrar
  uma notificacao do Owlbear podia substituir sucesso real por mensagem de
  falha da operacao.
- Os dois botoes de restauracao permaneciam acionaveis durante a leitura de
  selecao feita pelo wrapper comum, antes de o estado visual de restauracao ser
  ativado. Isso permitia duas entradas acidentais da UI, embora a protecao de
  dominio continuasse existindo.
- URL publica vazia ou sintaticamente invalida ainda deixava a migracao
  acionavel quando havia conexao. Falha ao carregar o indice de mapas era
  registrada no console e apresentada como mapa nao cadastrado. Falha de uma
  leitura auxiliar durante a inicializacao podia rotular incorretamente uma
  conexao SDK ja obtida como ausente.
- Em tema escuro, o aviso usava a mesma cor marrom do tema claro e tinha
  contraste insuficiente. O contorno de foco translucido tambem ficava pouco
  perceptivel. Em viewport de 240 px, duas acoes excediam a propria coluna.
- Textos dinamicos e mensagens de erro exibidos pelo painel continham erros
  objetivos de acentuacao. Nomes persistidos de catalogos e presets nao foram
  alterados; quando necessario, foi usado somente rotulo de exibicao.

### Correcoes e comportamento preservado

- Os selects mantiveram a aparencia atual e receberam nome acessivel completo,
  relacao com o listbox, navegacao por teclado, retorno previsivel do foco e
  fechamento ao sair do componente.
- Estados de processamento passaram a usar a regiao `aria-live` existente. Os
  botoes continuam desabilitados durante a propria operacao; restauracao
  desabilita os dois comandos antes da primeira espera assincrona. Nenhum novo
  lock ou fluxo transacional foi criado.
- Falhas de notificacao agora sao secundarias e nao mudam o resultado real da
  acao. Sucesso ao devolver carta permanece visivel. Erros nao serializaveis
  usam fallback compreensivel, e falhas de indice/inicializacao distinguem
  indisponibilidade parcial de ausencia do SDK.
- Migracao exige URL preenchida e valida. O status de conexao e o estado dos
  mapas passaram a ser anunciados. O icone decorativo continua com `alt` vazio.
- Foco passou a usar contorno solido da paleta; aviso recebeu cor propria por
  tema. Abaixo de 281 px, apenas grids de duas colunas passam para uma coluna,
  eliminando o overflow sem mudar o painel normal de 320/420 px.
- Foram mantidos tipos explicitos em todos os botoes, labels dos controles
  nativos, confirmacoes de salvamento/restauracao, estados vazios de cores e
  bibliotecas, controles indisponiveis sem SDK/catalogo e a identidade visual.

### Validacao e limites

- `npm run check`, `npm run build`, `node --check`, validacao dos oito JSONs e
  `git diff --check` passaram; o build manteve somente os avisos conhecidos do
  SDK sobre `this` no topo de modulos ES.
- Inspecao local do DOM confirmou nomes acessiveis, `type` em botoes, `alt` em
  imagens, navegacao completa de um select por teclado e ausencia de overflow
  horizontal em 240 e 320 px. Sucesso e falha do indice de mapas foram
  simulados sem nova infraestrutura.
- Manifesto, IDs, metadata, presets completos, assets e formatos persistidos
  nao foram alterados por esta etapa. Versao e cache busting permaneceram
  inalterados conforme a restricao da auditoria; uma publicacao futura precisa
  aplicar o incremento previsto nas regras do projeto.
- Nao foi considerado teste no Owlbear. Ainda dependem do ambiente real: foco
  dentro do iframe, leitor de tela, teclado/touch no painel hospedado,
  confirmacoes nativas, latencia/falha real do SDK e fetch, duplo toque nos
  comandos, restauracao e comportamento em aparelho mobile.
- Conclusao: nao restou divida significativa de interface que justifique outra
  etapa antes dos testes manuais. Ajustes adicionais seriam cosméticos ou
  dependeriam de evidencia no Owlbear/mobile real.

## 2026-08-10 - Performance de runtime e assets

### Escopo e inventario

- Foram auditados carregamento inicial, bibliotecas, restauracao, rede, DOM,
  Canvas, listeners, leituras de cena, listas e caches, sem reabrir S-01 a S-20
  ou a arquitetura sem evidencia nova.
- `assets/` possui 961 arquivos e 795648077 bytes (758,8 MiB) no workspace; o
  total inclui um backup `.bak` ignorado de 1113 bytes. PNG concentra 920
  arquivos e 774818333 bytes; JPG, 10 e 18110697 bytes; WebP, 5 e 1439614
  bytes; os cinco JSONs somam 1274993 bytes.
- `assets/local-assets/` concentra 746 arquivos e 645797109 bytes (615,9 MiB),
  seguido por `preset-decks/` com 91741945 bytes e `preset-cards/` com
  56881651 bytes. Os maiores arquivos sao quatro copias de um mapa de 24,59
  MiB e tres copias de outro mapa de 24,16 MiB.
- SHA-256 encontrou 177 grupos byte-a-byte identicos: 882 arquivos participam,
  705 sao copias alem da primeira e representam 545693077 bytes (520,4 MiB).
  A classificacao e apenas diagnostica; nenhum arquivo ou URL foi removido.
- O cruzamento de JSONs, fontes e arquivos distribuidos encontrou 362 arquivos
  referenciados, com 255230709 bytes, sem referencia ausente ou diferenca de
  caixa. Outros 599 arquivos, com 540417368 bytes (515,4 MiB), nao aparecem no
  estado atual: 580 ficam em `local-assets/` e 19 sao README, `.gitkeep` ou o
  backup ignorado. Desses, 559 arquivos e 342878719 bytes sao copias exatas de
  algum arquivo referenciado. Todos continuam preservados por compatibilidade
  potencial com cenas, metadata, presets e saves antigos.

### Carregamento real e gargalos

- O tamanho total da pasta nao e transferido ao iniciar a extensao. O background
  nao enumera nem pre-carrega `assets/`; o painel usa selects textuais, sem
  thumbnails ou elementos `<img>` para as bibliotecas.
- Antes desta etapa, abrir o painel carregava os dois manifests e os dois mapas
  completos: 1251834 bytes de `assets/`, com parse e validacao de 435 itens. O
  painel agora carrega os manifests enriquecidos e um indice de 422 bytes:
  48043 bytes no total, reducao de 1203791 bytes (96,2%). O mapa completo e
  buscado e validado somente depois da confirmacao de restauracao; dentro da
  mesma abertura do painel ele fica reutilizado em memoria.
- Os manifests nao possuíam dimensoes. Criar uma pilha disparava de 3 a 25
  instancias de `Image` para medir verso e todas as frentes, embora somente o
  verso estivesse visivel; as frentes invisiveis somavam de 1,1 a 12,2 MiB por
  pilha em cache frio. Criar uma carta media as duas faces. Os geradores agora
  leem o cabecalho PNG com Node padrao e gravam largura, altura e MIME nas 191
  referencias. As 10 pilhas e 47 cartas foram montadas sem `Image` disponivel,
  demonstrando zero sondagens; o Owlbear continua carregando apenas a face que
  precisa renderizar e as demais sob demanda.
- Restaurar os mapas continua sendo o fluxo pesado real: o Tutorial possui 187
  itens de imagem e 111 URLs atuais unicas, com 68774546 bytes (65,59 MiB); a
  Missao 0.5 possui 180 itens, 111 URLs e 68381153 bytes (65,21 MiB). Esses
  totais sao o limite frio do conjunto atual, nao prova de download imediato de
  tudo: cache, estado anterior e descarte por viewport podem reduzir a
  transferencia. Outros URLs de frente/verso permanecem apenas em metadata ate
  serem exibidos.
- Leituras de cena completas, serializacao ampla e Canvas ficaram restritos a
  restauracao, salvamento, sincronizacao explicita ou migracao/publicacao. No
  fluxo administrativo de migracao, URLs repetidas sao deduplicadas por
  operacao, object URLs sao revogadas e `ImageBitmap` e fechado. Esse fluxo nao
  foi alterado porque exige servidor local, rede, Canvas e Owlbear reais.
- Os listeners normais trabalham sobre selecao pequena ou sobre cerca de 200
  itens, com debounces ja existentes de 150 ms e 450 ms. Filas e mapas de locks
  removem entradas em `finally`; nao foi encontrado cache persistente sem
  limite. Os manifests ainda usam `no-store`, mas somam somente 47621 bytes e
  mudar a politica criaria risco de catalogo obsoleto sem beneficio suficiente.

### Compatibilidade, validacao e conclusao

- Nenhum asset existente foi renomeado, movido, removido, convertido ou teve
  URL reescrita. IDs, ordem, nomes, defaults e paths dos manifests permanecem
  equivalentes; apenas dimensoes/MIME foram acrescentados. Os dois presets
  completos permaneceram sem diff.
- `npm run check`, antes e depois do build, validou 8 JSONs, 29 arquivos JS/MJS,
  191 assets de biblioteca e 1455 referencias dos mapas. `npm run build`,
  verificacoes `node --check`, a auditoria SHA-256, a simulacao focada de
  carregamento sob demanda e `git diff --check` passaram. Permaneceram apenas
  os avisos conhecidos do Rollup sobre `this` no SDK.
- Versao e cache busting permaneceram inalterados conforme o escopo desta
  auditoria. Uma publicacao futura deve aplicar o incremento exigido pelas
  regras do projeto para que clientes com `v=69` nao mantenham o bundle antigo.
- Nenhum teste manual no Owlbear foi considerado realizado. Ainda precisam de
  ambiente real: confirmar o waterfall/cache, restaurar os dois mapas, criar e
  manipular carta/pilha da biblioteca e observar memoria no mobile. Canvas e
  publicacao administrativa so devem ser revisitados com servidor local.
- Conclusao: nao ficou uma divida de performance relevante no uso normal que
  justifique outra etapa agora. O volume e as duplicatas representam sobretudo
  custo de armazenamento/publicacao e risco de manutencao. A carga fria de um
  mapa restaurado pode continuar relevante no mobile, mas reduzi-la exigiria
  alterar assets ou URLs persistentes e deve depender de medicao real e uma
  etapa de compatibilidade propria.

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
| G-06 | Documentacao tecnica era insuficiente para continuidade entre sessoes. | Medio | Alta | Corrigido pela documentacao tecnica e consolidado em `DEVELOPMENT.md` |
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
| G-06 | Concluido | A documentacao permanente e o guia de desenvolvimento registram arquitetura, regras e historico. |
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
