# Cartas Duplas para Owlbear Rodeo

Extensao para Owlbear Rodeo criada por DemonRider. Ela adiciona cartas 2D com frente e verso, pilhas compraveis, atalhos de teclado, selecao de personagem por cor e restauracao de tabuleiro padrao.

## Link publico

Depois que o GitHub Pages publicar este repositorio, use este link no Owlbear:

```text
https://demonrider0.github.io/Double-Sided-Cards/manifest.json?v=62
```

Se o usuario ou o nome do repositorio mudar, tambem sera necessario trocar os caminhos de `manifest.json` e as URLs dentro dos arquivos em `assets/scene-presets/`.

## Publicar no GitHub Pages

1. Confirme que o build esta atualizado:

   ```powershell
   npm run build
   ```

2. Suba estes arquivos e pastas para o repositorio:
   - `manifest.json`
   - `index.html`
   - `background.html`
   - `dist/`
   - `icons/`
   - `src/`
   - `vendor/`
   - `assets/preset-decks/`
   - `assets/preset-cards/`
   - `assets/local-assets/`
   - `assets/scene-presets/`
   - `.nojekyll`
   - `package.json`
   - `package-lock.json`

3. No GitHub, va em `Settings > Pages`.
4. Escolha `Deploy from a branch`.
5. Use a branch principal e a pasta `/`.
6. Aguarde a publicacao terminar antes de testar no Owlbear.

## Tabuleiro padrao

Os arquivos em `assets/scene-presets/` guardam os mapas salvos que podem ser recriados pelos botoes de restauracao.

Na versao publica, os botoes de salvar mapas ficam ocultos. Isso e intencional: GitHub Pages nao salva arquivos novos. O fluxo publico e commitar os arquivos JSON prontos em `assets/scene-presets/` e usar apenas os botoes de restauracao dentro do Owlbear.

Mapas salvos atuais:

- Tutorial: `assets/scene-presets/tutorial.json`
- Missao 0.5 (nao oficial): `assets/scene-presets/missao-0-5.json` depois de salvar pelo localhost

## Biblioteca de pilhas

As pilhas padrao ficam em `assets/preset-decks/`.

Para mudar cartas de uma pilha:

1. Coloque as imagens na pasta da pilha.
2. Mantenha o verso como `Verso.png`.
3. Rode:

   ```powershell
   npm run build:preset-decks
   npm run build
   ```

Os tamanhos padrao atuais sao:

- Ameacas Elite: `4.5`
- Armas: `2.25`
- Salas: `1.5`
- Salas-Refugiados, Salas-Objetivos e Salas-Normais: `1.5`
- Poderes da Tormenta Nivel 1, 2 e 3: `2`
- Eventos: `2.25`

## Biblioteca de cartas

As cartas individuais ficam em `assets/preset-cards/`.

Pastas atuais:

- `classes`
- `racas`
- `divindades`
- `reacoes-heroicas`
- `herois`
- `herois-montaria`

Para mudar cartas individuais:

1. Coloque as imagens na pasta do grupo.
2. Mantenha o verso do grupo como `Verso.png`, ou use um verso especifico com o mesmo nome da frente seguido de `verso`.
3. Rode:

   ```powershell
   npm run build:preset-decks
   npm run build
   ```

Classes, racas e divindades ja entram com a marcacao usada pelo sistema de selecao de personagem.
Reacoes Heroicas e Herois entram como cartas duplas comuns.

Tamanhos padrao das cartas individuais:

- Classes: `3`, camada `Mount`
- Racas: `3`, camada `Mount`
- Reacoes Heroicas: `1.25`, camada `Mount`
- Herois: `6`, camada `Mount`, origin `885 x 531.5`
- Herois Montaria: `1`, camada `Mount`

Exemplo de verso especifico:

- `Thwor.png`
- `Thwor verso.png`

Quando uma carta tem verso especifico, ele substitui o `Verso.png` do grupo apenas para essa carta.

## Migrar imagens locais

Os assets locais usados pelo tabuleiro padrao ja foram copiados para `assets/local-assets/`.

Se novas imagens forem importadas pelo localhost e precisarem ir para o GitHub Pages, rode:

```powershell
npm run prepare:github-assets
```

Depois use `npm run build` e suba novamente o repositorio.

## Atalhos

- `V`: virar carta selecionada
- `C`: comprar da pilha selecionada
- `E`: embaralhar pilha selecionada
- `R`: devolver carta comprada para a pilha

## Teste local

Para testar esta pasta antes de subir:

```powershell
node dev-server.mjs 5180
```

Abra no Owlbear:

```text
http://localhost:5180/manifest.json?v=62
```

Para testar a versao local separada sem mexer na pasta do Git, use a pasta local de testes.
