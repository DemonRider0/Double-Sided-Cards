# Cartas Duplas para Owlbear Rodeo

Extensão para manipular cartas 2D com frente e verso dentro do Owlbear Rodeo. O projeto reúne cartas individuais, pilhas reutilizáveis, mapas preparados e controles para partidas em desktop e mobile.

## Principais funcionalidades

- cartas com frente e verso, incluindo suporte a verso espelhado;
- compra, embaralhamento e devolução de cartas para a pilha de origem;
- bibliotecas prontas de cartas e pilhas;
- criação de pilha temporária a partir de cinco cartas selecionadas;
- restauração dos mapas Tutorial e Missão 0.5 (não oficial);
- seleção de jogador por cor e slots de raça, classe e divindade;
- ações pelo painel, pelos comandos do tabuleiro e por atalhos de teclado.

## Instalação

No Owlbear Rodeo, adicione uma extensão personalizada usando este manifesto público:

```text
https://demonrider0.github.io/Double-Sided-Cards/manifest.json?v=69
```

A extensão e seus assets são carregados pelo GitHub Pages, portanto é necessário acesso à internet durante o uso.

## Uso básico

1. Abra o painel **Cartas** dentro de uma sala do Owlbear Rodeo.
2. Para começar por um tabuleiro pronto, use **Restaurar o Tutorial** ou **Restaurar a Missão 0.5 (não oficial)**. A restauração pede confirmação e altera a cena atual.
3. Quando o mapa utilizar seleção por jogador, escolha sua cor pelo identificador correspondente no tabuleiro.
4. Use a seção **Biblioteca** para criar uma cópia de uma pilha ou carta cadastrada. As bibliotecas não são consumidas durante a partida.
5. Selecione uma carta ou pilha e use as ações do painel ou do próprio tabuleiro para virar, comprar, embaralhar ou devolver.

Para criar uma pilha temporária de missão, selecione exatamente cinco cartas já sacadas e use **Criar pilha com seleção**. A pilha é embaralhada e desaparece quando a última carta é comprada.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `V` | Virar a carta selecionada ou o topo da pilha. |
| `C` | Comprar uma carta da pilha selecionada. |
| `E` | Embaralhar a pilha selecionada. |
| `R` | Devolver a carta comprada para o fundo da pilha de origem. |

No mobile, as ações essenciais também estão disponíveis por botões; o uso do teclado não é obrigatório.

## Observações importantes

- A carta comprada respeita a face atual da pilha.
- A devolução envia a carta para o fundo da pilha.
- Compra e devolução por arrasto não fazem parte do fluxo atual.
- A restauração de mapas deve ser feita na cena que pode receber o tabuleiro preparado.
- Algumas ações dependem das permissões concedidas ao jogador na sala do Owlbear Rodeo.

## Autoria

Criado e mantido por **DemonRider**.

Informações para desenvolvimento e manutenção estão em [DEVELOPMENT.md](DEVELOPMENT.md).
