# Product

## Platform

web

## Users

- Administradores controlam contas ChatGPT, usuários, reservas, limites e credenciais temporárias.
- Usuários de turmas acessam uma conta Codex compartilhada somente durante horários reservados.

## Product Purpose

Permitir acesso remoto, temporário e revogável ao Codex sem copiar credenciais OpenAI para os computadores dos usuários. O acesso comum é organizado por agenda, exige aprovação administrativa e entrega uma janela exclusiva de cinco horas com 100% da quota curta da conta.

## Positioning

O produto combina agendamento exclusivo, credenciais efêmeras e um relay que falha fechado; a autenticação OpenAI permanece exclusivamente no host central.

## Operating Context

- O relay e o site rodam no Render.
- O `codex app-server`, os `CODEX_HOME` e os logins ChatGPT rodam no host central.
- Supabase Auth autentica administradores e usuários comuns.
- Supabase armazena perfis, turmas, reservas e snapshots sanitizados, nunca credenciais OpenAI ou tokens brutos do relay.
- Usuários podem iniciar o Codex CLI com o token temporário ou conectar o Codex App ao workspace remoto usando uma chave SSH temporária.

## Capabilities and Constraints

- Há papéis separados de `owner`, `admin` e usuário comum.
- Reservas duram exatamente cinco horas, começam em um reset derivado da janela de 300 minutos e não podem se sobrepor na mesma conta.
- Sem reserva ativa, a sessão aparece desligada e nenhuma credencial nova pode ser emitida.
- A credencial temporária expira no fim da reserva; não há franquia percentual individual.
- Cada grupo escolhe uma conta disponível ao solicitar o horário.
- O app-server informa quota por conta, não por token. A janela de cinco horas controla a sessão do usuário; a janela semanal é preservada para análise administrativa.
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
