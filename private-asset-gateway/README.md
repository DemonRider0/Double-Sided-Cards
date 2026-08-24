# Gateway HTTPS da POC

Este diretório é separado do bundle público da extensão. Ele contém somente a prova de conceito
Cloudflare Worker + R2 para dois arquivos pequenos: um WebP e um JPEG.

O Worker usa um binding R2. Nenhuma access key ou secret key R2 é criada ou enviada ao navegador.
A capability de upload aceita somente consulta e upload idempotente de imagens WebP/JPEG com até
2.000.000 bytes. Ela não permite listar, apagar ou administrar o bucket.

## Deploy inicial

É necessário ter uma conta Cloudflare com R2 habilitado. No PowerShell, abra este diretório e
execute, uma linha por vez:

```powershell
npm install
npx wrangler login
npx wrangler r2 bucket create double-sided-cards-private-assets-poc
npm run deploy
npm run configure
```

O login abre a autorização oficial da Cloudflare. O comando `configure` cria duas capabilities
aleatórias e as grava como secrets do Worker:

- `POC_UPLOAD_TOKEN`: autorização restrita da POC; o comando a mostra uma vez para ser copiada.
- `POC_READ_CAPABILITY`: usada nas URLs GET; o valor não é mostrado nem gravado em arquivo.

Guarde a capability de upload em um gerenciador de senhas. Não a coloque no Git, no pack ou em
arquivos da extensão.

Ao final de `npm run deploy`, o Wrangler mostra uma URL HTTPS parecida com:

```text
https://double-sided-cards-private-assets-poc.<subdominio>.workers.dev
```

Essa URL `workers.dev` é suficiente para a POC. Um domínio personalizado pode ser ligado ao
Worker depois, antes de qualquer migração de produção.

Como esta POC não será publicada, volte à raiz de `Double-Sided-Cards`, execute:

```powershell
npm run build
node dev-server.mjs 5180
```

Deixe essa janela aberta durante o teste e adicione no Owlbear a extensão customizada:

```text
http://localhost:5180/manifest.json?v=103
```

Não execute `npm run configure` novamente depois de criar itens que precisem continuar funcionando:
isso troca a capability de leitura e invalida as URLs anteriores. Depois de terminar a POC, revogue
a autorização que foi colada no painel usando `npm run rotate:upload`. Esse comando preserva todas
as URLs GET existentes e mostra uma nova capability de upload.

## Executar a sonda no Owlbear

1. Abra a extensão local Cartas Duplas e selecione o Runtime Private Asset Pack.
2. Em **Diagnóstico temporário — armazenamento HTTPS**, cole a URL do deploy.
3. Cole a capability temporária de upload mostrada por `npm run configure`.
4. Clique em **Testar armazenamento HTTPS**.
5. Quando terminar, clique em **Copiar relatório HTTPS**.

O campo da capability é apagado assim que a execução começa e não é salvo pelo painel.

## Contrato HTTP

### `GET /v1/health`

Confirma somente se bucket e secrets estão configurados. Nunca retorna seus valores.

### `POST /v1/blobs/check`

Requer `Authorization: Bearer <capability de upload>`. Recebe um ou dois descriptors com
`blobSha256`, `size` e `mime`. Retorna existência e, para objetos existentes, a URL GET estável.

### `PUT /v1/blobs/<sha256-hex>`

Requer a capability de upload e os headers `X-Blob-SHA256`, `X-Blob-Size` e `Content-Type`.
O Worker verifica MIME, assinatura WebP/JPEG, tamanho e SHA-256 antes de gravar no R2. Um objeto já existente e compatível
não é reenviado.

### `GET|HEAD /i/<read-capability>/<sha256-hex>`

Não exige header de autenticação, pois o Owlbear e os demais jogadores precisam carregar a URL
diretamente. A capability aleatória impede descobrir o objeto conhecendo somente o hash. A resposta
inclui CORS, MIME, tamanho, checksum e cache imutável.

## Desenvolvimento local

Os testes do Worker usam um bucket R2 em memória e não precisam de conta Cloudflare. O comando de
regressões da raiz já executa esses testes:

```powershell
npm run test:regressions
```

Arquivos `.dev.vars`, `.env`, `.wrangler` e arquivos temporários `.poc-*` estão ignorados pelo Git.
