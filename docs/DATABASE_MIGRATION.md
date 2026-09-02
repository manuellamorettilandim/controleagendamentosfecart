# Migração do Supabase para PostgreSQL na Lightsail

## Decisão

O estado final será um PostgreSQL privado na mesma Lightsail do aplicativo. O
Supabase deixará de ser dependência de runtime somente depois que o acesso a
dados e a autenticação tiverem equivalentes no servidor da aplicação.

O código da mudança está implementado, mas **o corte não está ativo em
produção**. O Supabase continua sendo a fonte oficial até o aceite formal.

## Por que a migração não é apenas um `pg_dump`

O projeto usa três recursos distintos do Supabase:

1. tabelas, funções, triggers e RLS em `public` e `codex_private`;
2. usuários, identidades, sessões e hashes de senha em `auth`;
3. APIs HTTP de Auth e PostgREST, chamadas diretamente pelo backend e pelo
   frontend.

O dump preserva os dados dos itens 1 e 2, inclusive UUIDs e hashes de senha,
mas não substitui as APIs do item 3. Restaurar o dump em PostgreSQL puro e
apontar o aplicativo para ele não é um corte válido.

## Política obrigatória de proteção

- Backup a cada 6 horas, mantendo as 8 cópias mais recentes no disco local.
- Backup diário, mantendo as 30 cópias mais recentes no disco local.
- Cada backup só é considerado concluído depois de:
  - `pg_dump` terminar sem erro;
  - `pg_restore --list` validar o arquivo;
  - o SHA-256 ser gerado;
  - o dump e o SHA-256 serem enviados a um bucket S3 privado.
- O bucket deve ter versionamento, bloqueio de acesso público, criptografia e
  lifecycle próprio: 2 dias para `six-hour/` e 30 dias para `daily/`.
- A rotina de backup usa um usuário PostgreSQL somente leitura. A aplicação não
  deve possuir permissão para remover backups do S3.
- Um teste de restauração deve ser executado antes do corte e, depois, ao menos
  uma vez por mês.

Os artefatos ficam em [`deploy/aws/postgres`](../deploy/aws/postgres/README.md).
O bootstrap instala PostgreSQL 17 e as units, mas não restaura dados, não troca
o runtime e não habilita timers sem configuração explícita.

## Fases da migração

### 0. Cofre de segurança do Supabase

Antes de qualquer mudança, gerar um dump independente:

```powershell
$env:SUPABASE_DB_URL = "postgresql://...:5432/postgres?sslmode=require"
./scripts/database/export-supabase.ps1
```

O script exporta `public`, `auth` e `codex_private`, valida o arquivo, cria um
SHA-256 e grava um resumo de contagens sem expor emails ou hashes. O arquivo
deve ser copiado para armazenamento fora da máquina de desenvolvimento.

Não use a chave pública ou a secret key da API: a exportação exige a connection
string do PostgreSQL em modo direto ou pooler de sessão.

### 1. PostgreSQL de ensaio

- Provisionar PostgreSQL compatível com a versão de origem.
- Criar roles separadas para owner de migração, aplicação e backup.
- Manter a porta 5432 fechada na internet; backend e banco comunicam-se por
  loopback.
- Restaurar uma cópia do dump em banco isolado e registrar incompatibilidades
  de extensões, roles, RLS e funções que chamam `auth.uid()`/`auth.jwt()`.

### 2. Substituição do runtime Supabase

- Mover login, refresh, logout e administração de usuários para endpoints do
  próprio backend.
- Trocar chamadas PostgREST por uma camada PostgreSQL server-side.
- Preservar os mesmos UUIDs de usuário para manter todas as chaves estrangeiras.
- Migrar os hashes de senha somente após um teste de compatibilidade. Se algum
  hash não puder ser validado, exigir redefinição de senha sem descartar o
  usuário ou seus dados.
- Reimplementar autorização no backend. RLS que depende das funções Supabase
  não deve ser considerada proteção ativa no PostgreSQL puro.

Durante esta fase, desenvolvimento pode usar o novo banco, mas produção ainda
escreve exclusivamente no Supabase. Evitar escrita simultânea independente nos
dois bancos para não criar divergência.

### 3. Ensaio de corte

1. Restaurar o dump mais recente no destino.
2. Comparar contagens por tabela, UUIDs, reservas, administradores e usuários.
3. Executar login real de owner, admin e usuário comum.
4. Executar os fluxos de criar/aprovar/cancelar reserva, emitir/revogar token e
   consultar telemetria.
5. Produzir e restaurar um backup de 6 horas e um diário.

### 4. Corte final

1. Ativar janela de manutenção e bloquear novas escritas no Supabase.
2. Fazer dump final e guardar o SHA-256 fora da Lightsail.
3. Restaurar no destino e repetir as comparações.
4. Alterar o runtime para o PostgreSQL local.
5. Monitorar e manter o Supabase intacto e somente leitura durante o período de
   segurança.

### 5. Desativação

O projeto Supabase só pode ser removido depois de:

- aceite funcional;
- ao menos um ciclo completo de retenção diária (30 dias);
- restauração comprovada a partir do S3;
- exportação final verificada e armazenada fora da Lightsail;
- decisão explícita do responsável pelos dados.

## Critérios de aceite

- Nenhuma tabela esperada fica ausente no destino.
- Contagens e chaves primárias do dump final coincidem com a origem.
- Todos os perfis mantêm o mesmo `user_id`.
- Login e autorização funcionam sem endpoint `*.supabase.co`.
- O frontend não recebe credencial direta do PostgreSQL.
- Os 8 backups de 6 horas e os 30 diários são mantidos localmente.
- O dump e seu checksum existem no S3 e uma restauração foi aprovada.
- O rollback para o Supabase é documentado enquanto ele for mantido somente
  leitura.
