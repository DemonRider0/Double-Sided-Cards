# Pilhas padrao

Cada pilha em `decks.json` e um modelo reutilizavel. A extensao nao altera esse arquivo durante o jogo, entao a mesma pilha padrao pode ser adicionada a cena quantas vezes forem necessarias.

Use caminhos relativos a raiz da extensao:

```json
{
  "id": "eventos",
  "name": "Eventos",
  "gridWidth": 2,
  "layer": "PROP",
  "back": "assets/preset-decks/eventos/verso.png",
  "cards": [
    { "name": "Evento 1", "front": "assets/preset-decks/eventos/evento-1.png" },
    { "name": "Evento 2", "front": "assets/preset-decks/eventos/evento-2.png" }
  ]
}
```

Se largura, altura e tipo de imagem forem omitidos, a extensao le esses dados quando a pilha e criada.

Os valores validos de camada sao `DRAWING`, `PROP`, `MOUNT`, `CHARACTER`, `ATTACHMENT`, `NOTE` e `TEXT`.

Cada pilha pode ter seu proprio tamanho padrao mudando `gridWidth` em `decks.json`. O painel carrega esse valor quando a pilha e selecionada, mas ainda permite ajustar o tamanho antes de criar a pilha na cena.

Quando `npm run build:preset-decks` roda novamente, ele preserva o `gridWidth` existente.

Tamanhos padrao atuais:

```text
Ameacas Elite: 4.5
Armas: 2.25
Salas: 1.5
Salas-Refugiados: 1.5
Salas-Objetivos: 1.5
Salas-Normais: 1.5
Poderes da Tormenta Nivel 1: 2
Poderes da Tormenta Nivel 2: 2
Poderes da Tormenta Nivel 3: 2
Eventos: 2.25
```

Atalho por pasta:

1. Coloque as imagens em uma pasta com o id da pilha, por exemplo `assets/preset-decks/eventos`.
2. Nomeie o verso da pilha como `verso.png` ou `back.png`.
3. Coloque as frentes das cartas na mesma pasta.
4. Rode `npm run build:preset-decks`.

O script atualiza `decks.json`.

Pastas cadastradas para salas:

```text
assets/preset-decks/salas-refugiados
assets/preset-decks/salas-objetivos
assets/preset-decks/salas-normais
```
