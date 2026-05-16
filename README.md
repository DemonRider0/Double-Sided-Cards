# Double-Sided Cards para Owlbear Rodeo

MVP de uma extensao para importar cartas 2D com frente e verso e vira-las no Owlbear Rodeo.

## Teste local

1. Abra um terminal nesta pasta.
2. Rode o servidor estatico:

   ```powershell
   node dev-server.mjs 5178
   ```

3. No Owlbear Rodeo, abra uma sala.
4. Va em `Extensions`.
5. Adicione uma extensao customizada usando:

   ```text
   http://localhost:5179/manifest.json?v=29
   ```

6. Abra o botao `Cards`, preencha `Frente`, `Verso` e importe.
7. Selecione a carta no mapa e vire usando uma destas opcoes:
   - pressione `V`;
   - clique no icone `Virar carta` na barra lateral direita;
   - use `Virar carta` no menu de contexto da carta.
8. Para pilhas, preencha `Pilha` com um verso comum e uma frente por linha, ou use os campos de arquivos locais.
9. Selecione a pilha no mapa e use `Comprar carta` ou `Embaralhar pilha` no menu de contexto.

## Observacoes

- As imagens precisam ser URLs publicas compativeis com CORS.
- Links do Google Drive em formato `/file/d/.../view` sao convertidos automaticamente para URLs de imagem.
- Arquivos locais funcionam para teste e sao servidos pela pasta local `.local-assets`; para mobile, use uma URL HTTPS publica ou tunel para este servidor.
- A largura no grid define quantas casas a carta ocupa na horizontal.

## Publicar no GitHub Pages

O projeto e estatico depois do build, entao pode ser publicado pelo GitHub Pages usando a raiz do repositorio.

1. Prepare os assets locais:

   ```powershell
   npm run prepare:github-assets
   ```

   Isso copia `.local-assets` para `assets/local-assets`, que e a pasta que o GitHub Pages vai servir publicamente.

2. Confirme que o build esta atualizado:

   ```powershell
   npm run build
   ```

3. Suba o repositorio para o GitHub com estes arquivos incluidos:
   - `manifest.json`
   - `index.html`
   - `background.html`
   - `dist/`
   - `icons/`
   - `src/styles.css`
   - `assets/local-assets/`
   - `.nojekyll`

4. No GitHub, ative Pages em `Settings > Pages` usando `Deploy from a branch`, branch principal e pasta `/`.

5. A URL da extensao no Owlbear ficara assim:

   ```text
   https://SEU_USUARIO.github.io/SEU_REPOSITORIO/manifest.json?v=29
   ```

### Preservar pilhas ja montadas

Depois que o GitHub Pages estiver no ar, abra a extensao publica no mesmo mapa do Owlbear.
No painel `Cards`, use a secao `Publicar`, preencha:

```text
https://SEU_USUARIO.github.io/SEU_REPOSITORIO
```

Depois clique em `Migrar links locais da cena`. A extensao troca os links `localhost/.local-assets/...`
por `assets/local-assets/...` no GitHub Pages, mantendo as pilhas e cartas existentes na cena.
Se voce migrar usando uma URL errada, corrija a URL e clique no botao de migracao de novo.

## Mobile

`localhost` so funciona no mesmo aparelho que esta rodando o servidor. No celular, `localhost` aponta para o proprio celular, entao o Owlbear mostra `unable to load extension: localhost`.

Para testar no mobile, publique ou exponha este servidor por uma URL HTTPS publica, por exemplo com um tunel. Use a URL HTTPS gerada no Owlbear:

```text
https://sua-url-publica/manifest.json?v=29
```

Quando a extensao e aberta por uma URL publica, os arquivos locais importados tambem passam a ser servidos por essa mesma URL publica.

O fluxo mais compativel com desktop e mobile e usar os botoes `Escolher ... dos assets`, porque eles usam imagens da propria biblioteca do Owlbear.
- Upload local via assets do Owlbear e uma melhoria futura.

## Se aparecer `failed to fetch`

1. Abra `http://localhost:5179/manifest.json` no navegador e confirme se o JSON aparece.
2. Se a porta `5179` estiver presa por um servidor antigo, rode em outra porta:

   ```powershell
   node dev-server.mjs 5180
   ```

3. No Owlbear, tente trocar a URL para a nova porta.

O servidor local ja responde as checagens de CORS e de rede local que navegadores modernos podem exigir.
