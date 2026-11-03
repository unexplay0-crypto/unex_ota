# UNEX PLAY — configuração do GitHub OTA (sem Cloudflare)

**Atualizado:** 2 de novembro de 2026. **Repositório:** https://github.com/unexplay0-crypto/unex_ota

> **Estado verificado nesta conversa:** GitHub público criado, mas vazio, sem Releases. A tentativa de escrever pela conexão ChatGPT/GitHub retornou 403 `Resource not accessible by integration`. O pacote local foi preparado e testado, mas **não foi publicado remotamente**. A tabela `public.ota_settings` no projeto Supabase `nuxgrazgpxoshewyruor` foi configurada para GitHub-only. O endereço público do Worker Cloudflare foi desativado. A ponte automática de publicação no Supabase, a interface Netlify e o aplicativo Android ainda não estão implementados/testados ponta a ponta.

## Objetivo final

1. **Netlify:** o Owner escolhe um APK, configura versão e modo obrigatório/opcional; revendedores `master` e `standard` não acessam o publicador.
2. **Supabase:** valida o Owner por `panel_sessions`, gerencia o upload privado em `unex-ota-staging`, versões e auditoria; por credencial de servidor dispara um evento `repository_dispatch` no GitHub.
3. **GitHub:** Actions baixa o APK temporário, valida tamanho, SHA-256, pacote Android, assinatura e `versionCode`; publica GitHub Release; só então altera o `update.json` público.
4. **Android:** consulta apenas `https://raw.githubusercontent.com/unexplay0-crypto/unex_ota/main/update.json`; faz download pelo URL HTTPS da Release, valida SHA-256 e assinatura Android, apresenta atualização opcional ou obrigatória; mantém cache em falhas de rede.

Nenhuma dessas integrações exige Cloudflare R2, Workers, cartão ou mensalidade obrigatória. Estão sujeitas às políticas e limites do plano gratuito de cada plataforma.

## Etapa 1 — Importar a estrutura do repositório

**O arquivo ZIP precisa ser descompactado.** Não envie o ZIP como um único arquivo ao GitHub esperando que ele crie as pastas automaticamente.

1. Baixe `UNEX_PLAY_GitHub_OTA_Configuracao.zip` e descompacte-o no seu computador. Nele há `README.md`, `update.json`, `.github/workflows/`, `scripts/` e `tests/`.
2. Abra https://github.com/unexplay0-crypto/unex_ota e confirme que o repositório continua definido como **Public** na aba **Settings → General → Danger Zone** (não clique para alterar a visibilidade se já estiver público).
3. Instale o [Git para Windows](https://git-scm.com/downloads) se ainda não o tiver; pode usar o GitHub Desktop como alternativa. Faça login com o fluxo oficial GitHub, sem compartilhar senhas/tokens em chats.
4. Em um terminal na pasta de sua preferência, execute:

   ```bash
   git clone https://github.com/unexplay0-crypto/unex_ota.git
   cd unex_ota
   ```

5. **Copie o conteúdo interno** do ZIP descompactado para a pasta `unex_ota` clonada. Deve haver `.github/workflows/ota-publish.yml`, `.github/workflows/validate-ota.yml`, `scripts/publish-ota.mjs`, `scripts/validate-update.mjs`, `tests/manifest.test.mjs`, `README.md` e `update.json` na raiz correta. A pasta `.github` pode ficar oculta no explorador.
6. Execute:

   ```bash
   node scripts/validate-update.mjs update.json
   node --test tests/manifest.test.mjs
   git add .
   git commit -m "chore: configurar distribuição OTA UNEX PLAY"
   git push origin main
   ```

   Para executar a validação local, é necessário Node.js 22 (https://nodejs.org/). Caso não queira instalar Node.js, pode fazer o commit e deixar o GitHub Actions executar os testes.
7. Atualize https://github.com/unexplay0-crypto/unex_ota e confira se todos os arquivos aparecem na branch `main`. Abra **Actions** e confira se **Validar manifesto OTA** terminou com sucesso.

O manifesto inicial contém `"enabled": false`: não anuncia atualização enquanto a publicação automática não estiver pronta.

## Etapa 2 — Permitir que GitHub Actions crie Releases e atualize o manifesto

1. Abra https://github.com/unexplay0-crypto/unex_ota/settings/actions e permita o uso de GitHub Actions para esse repositório.
2. Em **Settings → Actions → General → Workflow permissions**, selecione **Read and write permissions** para o `GITHUB_TOKEN` e clique **Save**. Isso é necessário porque o workflow publica Releases e atualiza `update.json`.
3. Em **Actions**, após importar os arquivos, confirme que os workflows **Validar manifesto OTA** e **Publicar UNEX PLAY OTA (Owner backend)** aparecem.
4. Não inicie o publicador manualmente sem um `job_id` válido emitido pelo Supabase. O botão manual é só para diagnóstico; o workflow rejeita um UUID não autorizado e não publica APK.
5. Como o workflow precisa alterar `main`, qualquer regra futura de proteção de branch deve permitir especificamente essa atualização automática ou usar um PR aprovado. Não desative a proteção indiscriminadamente; primeiro teste o fluxo.

## Etapa 3 — Configurar variáveis e segredo do GitHub (após implementar a ponte do Supabase)

Abra https://github.com/unexplay0-crypto/unex_ota/settings/secrets/actions.

Em **Repository variables** (não são segredos), crie:

| Nome | Valor |
| --- | --- |
| `UNEX_OTA_BRIDGE_URL` | `https://nuxgrazgpxoshewyruor.supabase.co/functions/v1/ota-github-bridge` |
| `UNEX_OTA_PACKAGE_NAME` | `applicationId` real extraído do APK **atualmente instalado** nos clientes; não adivinhar |
| `UNEX_OTA_SIGNING_CERT_SHA256` | SHA-256 do certificado de assinatura **do APK que os clientes já possuem**; não é o hash do arquivo |

Em **Repository secrets**, crie:

| Nome | Valor |
| --- | --- |
| `UNEX_OTA_BRIDGE_TOKEN` | Segredo forte e aleatório, exclusivo para a comunicação GitHub Actions ↔ Supabase; deve ser idêntico ao configurado na Edge Function `ota-github-bridge` |

A Edge Function `ota-github-bridge` **ainda precisa ser implementada e implantada**. Simplesmente salvar essas variáveis não faz o sistema funcionar.

**Não envie o segredo por mensagens, não o comite no repositório e não o coloque no APK nem no JavaScript público do painel.** A chave GitHub que já apareceu em uma mensagem anterior deve ser revogada em https://github.com/settings/tokens.

## Etapa 4 — Token de acesso restrito GitHub para o Supabase (não compartilhar)

Para o backend Supabase acionar a Action sem depender de uma pessoa abrindo o GitHub a cada publicação:

1. Acesse https://github.com/settings/personal-access-tokens/new e crie um **Fine-grained personal access token**.
2. Em **Resource owner**, escolha `unexplay0-crypto`; em **Repository access**, selecione **Only select repositories** e escolha somente **`unex_ota`**.
3. Em **Repository permissions**, escolha **Contents: Read and write** (e **Metadata: Read**, normalmente incluída). A operação `repository_dispatch` exige permissão de Contents/Write. Dê ao token validade limitada e planeje a renovação; se houver política de permissão especial, siga a exigência do GitHub.
4. Guarde o token como **secret do Supabase** em https://supabase.com/dashboard/project/nuxgrazgpxoshewyruor/settings/functions (ou pelo menu de Edge Function Secrets da versão atual do painel), por exemplo `GITHUB_OTA_TOKEN`.
5. No backend, use **exclusivamente no servidor** e restrinja a única rota de disparo a `https://api.github.com/repos/unexplay0-crypto/unex_ota/dispatches` com tipo `unex-ota-publish` ou `unex-ota-policy`. Nunca envie o token a Netlify frontend ou Android.

O GitHub gera automaticamente um `GITHUB_TOKEN` distinto para cada execução da Action; **não** é necessário criar manualmente esse segredo no GitHub.

## Etapa 5 — Integração com o Supabase e Netlify que falta implementar

Para o sistema publicar pelo painel, ainda é necessário executar a etapa técnica de backend:

- Edge Function `ota-github-bridge`, verificando o token de serviço apenas nas chamadas internas da Action e `jobId` na tabela de jobs.
- Serviço owner-only autenticado via a tabela existente `panel_sessions`, que autorize a versão, gere URL de upload privado, valide o estado do job e chame `repository_dispatch` com token guardado no Supabase.
- Processo de finalização idempotente, atualizando `ota_releases`, `ota_settings`, `ota_upload_jobs`, `ota_audit_events` só após confirmar a Release e o manifesto publicados.
- Mecanismo para alterar `minSupportedVersionCode` somente por ação do Owner; obrigatório se versão instalada estiver **abaixo** desse código.
- Tela no painel Netlify para Owner enviar APK, ver progresso, comparar versões, publicar, definir obrigatório/opcional e ler o histórico. Revendedores `master` e `standard` não devem conseguir acessar nem chamar essas operações.
- Verificação do novo aplicativo Android, inclusive compatibilidade do certificado de assinatura instalado, `applicationId`, `versionCode` e checksum do APK.

**Não existem credenciais embutidas nos arquivos do ZIP**, e não foi criada nenhuma Release de teste.

## Etapa 6 — Verificações finais antes de liberar clientes

1. Confira `https://raw.githubusercontent.com/unexplay0-crypto/unex_ota/main/update.json` após o commit: `enabled` deve permanecer **false** enquanto não houver APK aprovado.
2. Teste autorização: `master` e `standard` devem receber 403 no endpoint de publicação, independentemente do que apareça no painel.
3. Com um APK assinado corretamente e versão maior do que a anterior, faça uma publicação de teste pelo painel Owner e veja se a Action conclui sem erros.
4. Confira a URL e o SHA-256 do APK na Release; baixe em um aparelho de teste; instale por cima da versão anterior sem perda de dados.
5. Verifique o `update.json` e teste uma atualização opcional; somente depois teste atualização obrigatória com uma versão antiga num ambiente de teste.
6. Não modifique todos os aparelhos até confirmar comportamento offline/cache, falha de download, retry e rollback da política.

**A integração completa só estará concluída após esse teste ponta a ponta.** A importação do ZIP sozinha prepara o repositório, mas não cria a ponte com o painel.

## URLs importantes

- Repositório: https://github.com/unexplay0-crypto/unex_ota
- Releases: https://github.com/unexplay0-crypto/unex_ota/releases
- Actions: https://github.com/unexplay0-crypto/unex_ota/actions
- Secrets e variáveis: https://github.com/unexplay0-crypto/unex_ota/settings/secrets/actions
- Configuração do Actions: https://github.com/unexplay0-crypto/unex_ota/settings/actions
- Manifesto final público: https://raw.githubusercontent.com/unexplay0-crypto/unex_ota/main/update.json
- Supabase: https://supabase.com/dashboard/project/nuxgrazgpxoshewyruor
