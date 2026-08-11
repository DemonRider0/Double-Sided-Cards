# Biblioteca de cartas

Use estas pastas como fonte das cartas individuais da biblioteca:

- `classes`
- `racas`
- `divindades`
- `reacoes-heroicas`
- `herois`
- `herois-montaria`

Em cada pasta, use `Verso.png` como verso padrão e coloque as frentes com nomes descritivos. Uma carta pode ter verso próprio com o nome da frente seguido de ` verso`, como `Thwor.png` e `Thwor verso.png`.

Depois rode:

```powershell
npm run build:preset-cards
npm run build
```

O primeiro comando regenera `cards.json` com caminhos, dimensões e tipos das imagens. IDs, categorias, tamanhos, camadas e origens definidos pelo projeto devem ser preservados.
