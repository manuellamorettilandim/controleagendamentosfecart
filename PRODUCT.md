# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Administradores controlam contas ChatGPT, usuários, reservas, limites e credenciais temporárias.
- Usuários de turmas acessam uma conta Codex compartilhada somente durante horários reservados.

## Product Purpose

Permitir acesso remoto, temporário e revogável ao Codex sem copiar credenciais OpenAI para os computadores dos usuários. O acesso comum é organizado por agenda e limitado por tempo e por uma fração da cota semanal da conta central.

## Positioning

O produto combina agendamento exclusivo, credenciais efêmeras e um relay que falha fechado; a autenticação OpenAI permanece exclusivamente no host central.

## Operating Context

- O relay e o site rodam no Render.
- O `codex app-server`, os `CODEX_HOME` e os logins ChatGPT rodam no host central.
- Supabase Auth autentica administradores e usuários comuns.
- Supabase armazena perfis, turmas, reservas e snapshots sanitizados, nunca credenciais OpenAI ou tokens brutos do relay.
- Usuários iniciam o Codex CLI em outro computador copiando a credencial temporária mostrada no dashboard.

## Capabilities and Constraints

- Há papéis separados de `owner`, `admin` e usuário comum.
- Reservas duram de uma a três horas e não podem se sobrepor na mesma conta.
- Sem reserva ativa, a sessão aparece desligada e nenhuma credencial nova pode ser emitida.
- A credencial temporária expira no fim da reserva e é bloqueada ao atingir a franquia individual.
- A franquia exibida como 100% representa uma parcela configurável da janela semanal da conta; o padrão é 5 pontos percentuais.
- O app-server informa quota por conta, não por token. A atribuição individual usa a variação observada durante a sessão e os tokens observados pelo host.
- O protótipo legado contém senhas de demonstração em texto simples e políticas abertas; elas servem apenas como fonte de migração e devem ser rotacionadas.

## Brand Commitments

- Nome de trabalho: Remote Codex.
- Interface em português do Brasil.
- Tema escuro e linguagem direta, operacional e segura.
- A interface deve oferecer tema claro e escuro, com preferência persistida por dispositivo.

## Evidence on Hand

- Relay, host multi-conta e painel administrativo existentes no repositório.
- Grupos e credenciais de demonstração estão em `legacy/fecart-prototype/SUPABASE_SETUP.sql`.
- Não há logotipo ou biblioteca de marca fornecida.

## Product Principles

1. A credencial OpenAI nunca sai do host central.
2. Sem horário ativo, não há acesso.
3. Limites e estados precisam ser claros antes de o usuário iniciar uma sessão.
4. Revogação e expiração devem encerrar sessões já abertas.
5. Dados administrativos mostram a origem e a atualidade das métricas.

## Accessibility & Inclusion

Controles devem ser utilizáveis por teclado, estados não podem depender somente de cor e a interface deve respeitar preferência por movimento reduzido.
