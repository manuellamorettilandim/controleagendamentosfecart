# Atualização da agenda — 06/09/2026

## Mudanças
- Cabeçalho do usuário com retorno visível à administração para perfis admin/owner.
- Agenda do usuário com colunas alinhadas no desktop, seleção de dia no mobile, navegação semanal, conta e estados de reserva. Solicitações próprias pendentes aparecem como aguardando aprovação.
- Agenda administrativa com resumo de disponibilidade por dia e lista de solicitações: nome, conta, datas reais, situação e tokens registrados.
- Aprovação direta; ajustes de horário e recusa em formulário na própria agenda, com observação e mensagens de erro. As confirmações de encerramento/cancelamento permanecem em ações explícitas.
- Solicitações recusadas não são classificadas como aprovadas. Solicitações que compartilham um horário permanecem visíveis. A disponibilidade considera sobreposição entre janelas.
- Datas de semanas que atravessam meses/anos apresentam o período completo.

## Validação
- Build completo do servidor e frontend concluído.
- 49 testes frontend aprovados, incluindo recusa inline e pedidos simultâneos.
- Inspeção visual desktop e viewport mobile de 390 px, com dados fictícios isolados do código entregue.
- Navegação usuário → admin verificada. Serviços de produção e decisões em dados reais não foram exercitados.

## Uso
Utilize os comandos e a configuração descritos no README.md original. Dependências e configuração de implantação foram preservadas. Instale com npm ci e compile com npm run build.

Capturas em screenshots/ utilizam dados fictícios. Nenhum fixture de autenticação ou API de demonstração é incluído no projeto entregue.
