# Segurança e limites

## O que fica na máquina central

- `CODEX_HOME` e o estado de autenticação criado por `codex login`.
- O segredo bruto `RELAY_AGENT_TOKEN`, usado apenas pelo host central para autenticar o túnel.
- O token local do `codex app-server`, usado somente em `127.0.0.1`.
- O arquivo `remote-access.json`, que contém apenas hashes SHA-256 dos tokens dos dispositivos.
- O arquivo `accounts.json` e os diretórios de contas, com um `CODEX_HOME` separado por assinatura.
- `SUPABASE_SECRET_KEY`, somente para convites, auditoria e snapshots administrativos. A antiga `SUPABASE_SERVICE_ROLE_KEY` fica apenas como fallback de migração.

## O que não deve sair

Não copie `auth.json`, o diretório `CODEX_HOME`, tokens ChatGPT, API keys OpenAI, o segredo do túnel ou o token local do app-server para o Render, para o PC remoto ou para o Git.

O relay recebe o token de um dispositivo no cabeçalho `Authorization: Bearer ...` do handshake WebSocket. Ele calcula o hash em memória e compara com o conjunto sincronizado pelo host; o token não é aceito em URL, query string nem escrito nos logs.

O painel `/admin` usa Supabase Auth. Render recebe somente `SUPABASE_URL` e a publishable key; o navegador recebe um JWT do Supabase e o relay valida o papel em `codex_admins`. A secret key não deve ser configurada no Render nem no navegador.

O token do dispositivo ainda é uma credencial de acesso ao seu relay. Use um token por computador, TTL curto e `revoke` quando o computador deixar de ser confiável. Qualquer pessoa que obtiver esse token poderá usar o acesso enquanto o host central estiver conectado.

## Fail closed

O relay só aceita `/codex` quando há um túnel central conectado, registrado, com heartbeat recente e sincronização de acessos recente. Ao perder o túnel, ele:

1. fecha as sessões ativas;
2. apaga a lista de dispositivos em memória;
3. retorna `503` para novas conexões até o host sincronizar novamente.

Em um restart do Render, sessões WebSocket são perdidas. O host deve reconectar e enviar a sincronização antes de liberar clientes.

## Protótipo legado

O conteúdo anterior está em [`legacy/fecart-prototype`](legacy/fecart-prototype). Ele não participa do relay. O protótipo contém senhas de demonstração e RLS permissiva no SQL; não reutilize esses valores. Se alguma senha ou política foi usada em um ambiente real, rotacione as credenciais e corrija as políticas antes de continuar.

## Modelo de ameaça aceito nesta versão

Esta versão foi desenhada para uso pessoal/experimental, não para oferecer um serviço multiusuário. O Render Free não é armazenamento durável para o estado de autorização: a fonte de verdade é o host central. A segurança também depende de TLS no endereço público `wss://`, segredo do túnel forte, máquina central atualizada e proteção do computador remoto.

O WebSocket do app-server e a integração remota são experimentais. Faça o primeiro teste com uma conta sem risco operacional e mantenha uma forma local de revogar/parar o host.

## Supabase

Aplique `supabase/migrations/20260812000000_codex_admin.sql` no mesmo projeto Supabase, crie o primeiro usuário no Auth e rode no host central:

```powershell
$env:SUPABASE_URL = "https://SEU_PROJETO.supabase.co"
$env:SUPABASE_SECRET_KEY = "SB_SECRET_SOMENTE_NESTA_MAQUINA"
npm.cmd run admin -- bootstrap --email owner@example.com
```

As tabelas `codex_` guardam apenas metadados, snapshots e auditoria. O host pode atualizar snapshots stale no Supabase, mas o painel identifica quando o host está offline e não trata snapshot como quota atual.
