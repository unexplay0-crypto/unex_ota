# UNEX PLAY — distribuição pública OTA

Repositório público dedicado **somente à distribuição de versões oficiais** do aplicativo Android UNEX PLAY. Não hospedar o código-fonte do aplicativo, credenciais de usuários, listas IPTV, certificados, chaves de assinatura, tokens ou backups aqui.

## Estado inicial: nenhuma atualização anunciada

O arquivo [`update.json`](update.json) começa com `"enabled": false`, versões `0` e nenhum APK. Isso é intencional: **não existe uma atualização OTA disponível até que a primeira publicação real seja concluída e validada**. Não edite o manifesto para `enabled: true` sem um APK real.

**URL estável para o aplicativo (somente leitura, não integrar ainda):**

`https://raw.githubusercontent.com/unexplay0-crypto/unex_ota/main/update.json`

O APK, após a primeira publicação, ficará em `https://github.com/unexplay0-crypto/unex_ota/releases`, com tag `vX.Y.Z` e asset `unex-play-vX.Y.Z.apk`.

## Contrato do manifesto

Campos JSON (schemaVersion 1):

- `enabled`: o aplicativo ignora o manifesto se `false`.
- `latestVersionCode`: código inteiro Android da versão mais recente. Cresce a cada atualização nova.
- `latestVersionName`: nome exibido (por exemplo `1.2.0`).
- `minSupportedVersionCode`: versões instaladas com código **inferior** a esse número recebem atualização obrigatória; outros aparelhos podem adiar se houver atualização.
- `apkUrl`: link HTTPS direto para asset do release deste repositório.
- `sha256`: SHA-256 hexadecimal, calculado sobre o APK real.
- `apkSizeBytes`: tamanho exato do arquivo em bytes.
- `releaseNotes`: mensagem apresentada aos usuários.
- `publishedAt`: data ISO 8601 UTC.

Antes de distribuir, validar se `applicationId` e certificado de assinatura são os mesmos da versão já instalada. O repositório jamais deve definir isso por suposição.

## Segurança e autorização

O **repositório é público para leitura**, porém a **publicação é restrita**: o painel faz a autenticação e autorização `owner` no Supabase; os revendedores `master` e `standard` não podem criar jobs nem alterar o manifesto. A verificação é feita no backend, não apenas pela ausência de botões. O `GITHUB_TOKEN` fornecido pelo GitHub Actions possui permissão `contents: write` somente na execução do publicador deste repositório; não se guarda token pessoal no código ou APK.

O painel cadastra uma versão e envia o APK diretamente para o bucket privado do Supabase `unex-ota-staging`, fora das limitações de upload de funções Netlify. O backend valida a sessão real do usuário e despacha o GitHub Action via API `repository_dispatch`, com o payload **exclusivo** `{"job_id":"uuid"}`. O workflow consulta a ponte privada no Supabase, valida APK, publica GitHub Release e **só então** ativa/atualiza o manifesto. Operações sem job autenticado falham antes de fazer upload.

### Dependências de backend ainda necessárias

Esses arquivos **preparam** o GitHub; não substituem a futura implementação do backend no painel/Edge Functions:

1. Criar Edge Function `ota-github-bridge` em `https://nuxgrazgpxoshewyruor.supabase.co/functions/v1/ota-github-bridge`, protegida por secret aleatório de alta entropia. Receber `POST` JSON `{"action":"resolve|complete|fail","jobId":"uuid", ...}` e comparar `Authorization: Bearer` em tempo constante. Jamais aceitar um `jobId` como prova suficiente de autorização.
2. Na operação `resolve`, conferir job e `created_by` autorizado `owner` diretamente no banco, expiração, estado e relação com `ota_releases`/`ota_upload_jobs` (para `policy`, modelar job separado, pois `ota_upload_jobs` exige `release_id`/`staging_path`). Retornar dados consistentes e URL **assinada de curta duração** somente para o objeto privado daquele job. Evitar replay de jobs concluídos.
3. Para `publish`, responder: `jobId`, `kind: "publish"`, `versionCode`, `versionName`, `releaseNotes`, `minSupportedVersionCode`, `apkSha256`, `apkSizeBytes`, `signedApkUrl`. Para `policy`, responder: `jobId`, `kind: "policy"`, `minSupportedVersionCode`.
4. Nas operações `complete`/`fail`, atualizar o job, `ota_releases` e `ota_settings` de modo **idempotente**, registrar auditoria em `ota_audit_events`, reconciliar falhas parciais e conferir versão/hash publicado antes de disponibilizar estado de sucesso ao painel. Manter política obrigatória desativada até confirmação da publicação.
5. Para iniciar uma execução, backend Supabase chama `POST https://api.github.com/repos/unexplay0-crypto/unex_ota/dispatches` usando credencial **de escopo mínimo** mantida exclusivamente nos segredos do backend. `event_type`: `unex-ota-publish` ou `unex-ota-policy`; `client_payload`: `{"job_id":"..."}`.

### Configuração necessária no GitHub (não é feita pelo commit)

Abra **Settings → Secrets and variables → Actions** neste repositório:

**Secrets**:
- `UNEX_OTA_BRIDGE_TOKEN`: segredo compartilhado somente com a Edge Function `ota-github-bridge`. Não usar chave `service_role`, senha, token GitHub pessoal ou certificado de assinatura.

**Variables**:
- `UNEX_OTA_BRIDGE_URL`: URL exata da Edge Function descrita acima.
- `UNEX_OTA_PACKAGE_NAME`: `applicationId` **real** do aplicativo já instalado (extrair do APK assinado existente).
- `UNEX_OTA_SIGNING_CERT_SHA256`: digest hexadecimal SHA-256 (64 caracteres) do **certificado real do APK anterior**, obtido com `apksigner verify --print-certs`. Não é a senha nem a keystore.

A chave que autentica as chamadas **do painel para o GitHub** também fica no Supabase (segredo de backend); nunca a repassar ao cliente/browser.

Configure permissões mínimas para Actions (o workflow pede `contents: write`). Proteja a branch `main` contra alterações não autorizadas e mantenha autenticação de dois fatores ativa.

## Workflows

- `.github/workflows/validate-ota.yml`: valida o manifesto em toda alteração relevante no GitHub.
- `.github/workflows/ota-publish.yml`: pode ser executado por `repository_dispatch`, ou manualmente com um `job_id` previamente autorizado. **Não funciona sem a ponte no Supabase** e suas configurações.

### Segurança do APK

O publicador valida tamanho, hash SHA-256, formato ZIP/APK, manifesto Android, código de versão, `applicationId` e assinatura do certificado com `aapt` e `apksigner` antes de publicar. Esses valores devem coincidir com a versão anterior do UNEX PLAY.

O manifesto `update.json` é alterado **por último**, após confirmação da Release. Novas versões não substituem o arquivo de uma tag antiga. Publicar uma versão obrigatória é possível somente se os dados estiverem íntegros.

## Testar localmente

```bash
node scripts/validate-update.mjs update.json
node --test tests/manifest.test.mjs
```

## Limitações atuais

Nenhuma Release/APK real foi publicada por estes arquivos. A integração Owner → Supabase → GitHub Actions, os segredos/variáveis e os testes reais de ponta a ponta **ainda devem ser implementados e verificados** antes de integrar o aplicativo UNEX PLAY.
