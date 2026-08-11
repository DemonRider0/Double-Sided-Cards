# Biblioteca de pilhas

Cada subpasta cadastrada representa uma pilha reutilizável da biblioteca. As imagens são a fonte; `decks.json` é regenerado pelo script do projeto.

## Atualização

1. Coloque as frentes na subpasta correspondente, por exemplo `assets/preset-decks/eventos/`.
2. Use `Verso.png` como verso da pilha.
3. Execute:

```powershell
npm run build:preset-decks
npm run build
```

`build:preset-decks` regenera `decks.json` e depois `cards.json`. O gerador preserva nomes, larguras e camadas válidas já cadastradas e adiciona aos assets os caminhos, dimensões e tipos de imagem.

Os valores válidos de camada são `DRAWING`, `PROP`, `MOUNT`, `CHARACTER`, `ATTACHMENT`, `NOTE` e `TEXT`.

## Pilhas atuais

| Pilha | Pasta | Largura no grid |
| --- | --- | --- |
| Ameaças Elite | `elite` | `4.5` |
| Armas | `armas` | `2.25` |
| Salas | `salas` | `1.5` |
| Salas-Refugiados | `salas-refugiados` | `1.5` |
| Salas-Objetivos | `salas-objetivos` | `1.5` |
| Salas-Normais | `salas-normais` | `1.5` |
| Poderes da Tormenta Nível 1 | `tormenta-nivel-1` | `2` |
| Poderes da Tormenta Nível 2 | `tormenta-nivel-2` | `2` |
| Poderes da Tormenta Nível 3 | `tormenta-nivel-3` | `2` |
| Eventos | `eventos` | `2.25` |

Não edite IDs, ordem ou formatos como parte de uma limpeza. Mudanças nas bibliotecas precisam respeitar [PROJECT_RULES.md](../../PROJECT_RULES.md).
