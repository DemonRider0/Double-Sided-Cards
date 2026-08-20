# Cartas Duplas para Owlbear Rodeo

Extensão para manipular cartas 2D com frente e verso dentro do Owlbear Rodeo. O Core público oferece as regras e os controles de jogo; bibliotecas e mapas pessoais podem ser adicionados por um Private Asset Pack local.

## Principais funcionalidades

- cartas com frente e verso, incluindo suporte a verso espelhado;
- compra, embaralhamento e devolução de cartas para a pilha de origem;
- bibliotecas privadas opcionais de cartas e pilhas;
- criação de pilha temporária a partir de cinco cartas selecionadas;
- criação de cenas independentes a partir dos templates privados Tutorial e Missão 0.5 quando todos os assets necessários estão acessíveis;
- seleção de jogador por cor e slots de raça, classe e divindade;
- ações pelo painel, pelos comandos do tabuleiro e por atalhos de teclado.

## Instalação

No Owlbear Rodeo, adicione uma extensão personalizada usando este manifesto público:

```text
https://demonrider0.github.io/Double-Sided-Cards/manifest.json?v=103
```

Versão pública preparada: **1.0.0**.

O Core é carregado pelo GitHub Pages. Imagens privadas não são hospedadas no repositório: quando um pack é configurado, elas pertencem à biblioteca do usuário no Owlbear Rodeo.

Uma instalação sem Private Asset Pack continua funcional para cartas e pilhas já existentes, ações, atalhos, multiplayer e compatibilidade com cenas antigas. Apenas bibliotecas e mapas pessoais ficam indisponíveis.

## Uso básico

1. Abra o painel **Cartas** dentro de uma sala do Owlbear Rodeo.
2. Se todos os assets de um template privado estiverem vinculados manualmente no Owlbear, use **Criar cena Tutorial** ou **Criar cena Missão 0.5 (não oficial)**. A nova cena aparece no Atlas sem alterar a cena aberta.
3. Quando o mapa utilizar seleção por jogador, escolha sua cor pelo identificador correspondente no tabuleiro.
4. Com os assets necessários vinculados, use a seção **Biblioteca** para criar uma cópia de uma pilha ou carta cadastrada. As bibliotecas não são consumidas durante a partida.
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
- Templates privados podem ser criados repetidamente como cenas independentes no Atlas.
- No SDK 3.1.0, `uploadImages` não fornece à extensão os URLs dos assets enviados; o vínculo privado depende da seleção manual do usuário no Owlbear.
- Algumas ações dependem das permissões concedidas ao jogador na sala do Owlbear Rodeo.

## Autoria

Criado e mantido por **DemonRider**.

Informações para desenvolvimento e manutenção estão em [DEVELOPMENT.md](DEVELOPMENT.md).
