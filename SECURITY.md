# Segurança e limites

## O que fica na máquina central

- `CODEX_HOME` e o estado de autenticação criado por `codex login`.
- O segredo bruto `RELAY_AGENT_TOKEN`, usado apenas pelo host central para autenticar o túnel.
- O token local do `codex app-server`, usado somente em `127.0.0.1`.
- O arquivo `remote-access.json`, que contém apenas hashes SHA-256 dos tokens dos dispositivos.
- O arquivo `accounts.json` e os diretórios de contas, com um `CODEX_HOME` separado por assinatura.
- O PostgreSQL local, incluindo hashes bcrypt de senha e hashes SHA-256 dos tokens de sessão.
- Durante a transição, `SUPABASE_SECRET_KEY` fica somente no host e deve ser removida depois do corte.

## O que não deve sair

Não copie `auth.json`, o diretório `CODEX_HOME`, tokens ChatGPT, API keys OpenAI, o segredo do túnel ou o token local do app-server para o Render, para o PC remoto ou para o Git.

O relay recebe o token de um dispositivo no cabeçalho `Authorization: Bearer ...` do handshake WebSocket. Ele calcula o hash em memória e compara com o conjunto sincronizado pelo host; o token não é aceito em URL, query string nem escrito nos logs.

O painel `/admin` usa sessões opacas emitidas pelo backend. O navegador recebe apenas access/refresh tokens; o PostgreSQL guarda somente seus hashes. O relay valida usuário e papel em `app_users`, `app_sessions` e `codex_admins`. A connection string nunca deve chegar ao navegador.

O token do dispositivo ainda é uma credencial de acesso ao seu relay. Use um token por computador, TTL curto e `revoke` quando o computador deixar de ser confiável. Qualquer pessoa que obtiver esse token poderá usar o acesso enquanto o host central estiver conectado.

## Fail closed

O relay só aceita `/codex` quando há um túnel central conectado, registrado, com heartbeat recente e sincronização de acessos recente. Ao perder o túnel, ele:

1. fecha as sessões ativas;
2. apaga a lista de dispositivos em memória;
3. retorna `503` para novas conexões até o host sincronizar novamente.

Em um restart do serviço, sessões WebSocket são perdidas. O host deve reconectar e enviar a sincronização antes de liberar clientes.

## Protótipo legado

O conteúdo anterior está em [`legacy/fecart-prototype`](legacy/fecart-prototype). Ele não participa do relay e não deve ser usado para autenticação. Os seeds de credenciais foram removidos e as políticas legadas estão bloqueadas; se uma instalação antiga usou esse SQL, rotacione as credenciais e revise as tabelas antes de continuar.

## Modelo de ameaça aceito nesta versão

Esta versão foi desenhada para uso pessoal/experimental. A fonte de verdade passa a ser o PostgreSQL na Lightsail; o disco da instância não é considerado backup. A segurança também depende de TLS no endereço público `wss://`, segredo do túnel forte, servidor atualizado e proteção do computador remoto.

O WebSocket do app-server e a integração remota são experimentais. Faça o primeiro teste com uma conta sem risco operacional e mantenha uma forma local de revogar/parar o host.

## PostgreSQL local e transição do Supabase

Restaure o dump preservado, aplique as migrations locais e configure o owner:

```powershell
$env:DATABASE_URL = "postgresql:///fecart?host=/var/run/postgresql"
npm.cmd run admin -- bootstrap --email owner@example.com
```

`app_users` preserva UUIDs e hashes bcrypt; `app_sessions` guarda somente hashes dos tokens. As tabelas `codex_` guardam metadados, snapshots e auditoria. Dumps contêm dados sensíveis e devem ficar com acesso privado, checksum e cópia fora da Lightsail.
