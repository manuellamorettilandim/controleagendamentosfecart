# Handoff de implementação — Codex local com gateway OAuth multi-conta

## Prompt master para o agente implementador

Copie a partir daqui e entregue integralmente ao agente responsável pela implementação.

---

Você é o agente responsável por implementar, testar e deixar operacional uma mudança arquitetural completa no projeto **Remote Codex / FECART**.

Não entregue apenas um plano. Inspecione a base existente, implemente o fluxo de ponta a ponta, execute os testes, faça uma validação real proporcional ao risco e documente como o usuário deve conectar o Codex CLI.

### Workspace e branch

- Workspace: `C:\Users\Renan\Developer\Projects\Personal\controleagendamentosfecart`
- Branch já criada para este trabalho: `codex/local-runtime-oauth-gateway`
- Branch de origem: `feat/security-hardening-and-rate-limiting`
- Commit apontado pelas duas branches antes da criação: `e915d4d`
- O working tree possui muitas alterações e arquivos novos ainda não commitados que fazem parte da base funcional testada.
- **Não use `git reset`, `git checkout --`, `git clean`, stash destrutivo ou qualquer comando que descarte mudanças.**
- Preserve alterações preexistentes e trabalhe por cima delas.
- Antes de editar, execute `git status --short`, leia `README.md`, `PRODUCT.md`, `SECURITY.md` e os arquivos relevantes listados abaixo.

### Objetivo obrigatório

O usuário executará o **Codex CLI oficial na própria máquina**, dentro do projeto local dele. Shell, PowerShell, Bash, Git, criação de pastas, leitura e alteração de arquivos, `apply_patch`, sandbox e aprovações precisam acontecer exclusivamente na máquina do usuário.

O servidor FECART continuará responsável por:

- manter uma ou mais contas ChatGPT/Codex autenticadas via OAuth;
- selecionar a conta definida pela reserva;
- nunca entregar o OAuth da conta ao usuário ou ao relay público;
- autorizar tokens temporários vinculados a usuário, reserva, conta e horário;
- permitir e bloquear modelos;
- encaminhar as requisições de inferência do Codex CLI;
- transportar streaming, reasoning, compaction e ferramentas hospedadas aceitas pelo upstream, incluindo web search quando suportado;
- medir uso, detectar consumo de cota, revogar e cortar requisições ativas;
- manter telemetria e auditoria sem armazenar prompts, respostas, comandos ou conteúdo de arquivos.

### Decisão arquitetural

Não use `codex --remote` como caminho principal do novo fluxo. Nesse modo o `app-server` remoto controla o agente inteiro e as ferramentas executam no host.

Use o suporte do Codex CLI a **custom model providers** compatíveis com Responses:

```toml
model = "gpt-5.6-sol"
model_provider = "fecart"
web_search = "live"

[features]
standalone_web_search = true

[model_providers.fecart]
name = "FECART Codex"
base_url = "https://DOMINIO/api/codex/v1"
env_key = "FECART_CODEX_TOKEN"
wire_api = "responses"
supports_websockets = false
supports_standalone_web_search = true
```

Referências oficiais que devem ser relidas antes da implementação:

- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/app-server
- https://developers.openai.com/api/reference/resources/responses/methods/create

O `codex app-server` continua no host, um por conta, mas sai do caminho do agente remoto. Ele será usado como componente de **controle e ciclo de vida OAuth**:

- `account/login/start`
- `account/read`
- refresh OAuth
- `account/rateLimits/read`
- `account/usage/read`
- `model/list`

O novo caminho de dados será:

```text
Codex CLI local
  -> HTTPS POST /api/codex/v1/responses no relay
  -> autenticação e política da reserva
  -> túnel WebSocket relay-host já existente
  -> broker OAuth da conta selecionada no host
  -> endpoint Codex/Responses usado pela autenticação ChatGPT
  -> streaming pelo caminho inverso
  -> Codex CLI local recebe tool calls e executa tudo localmente
```

### Limite de suporte e pesquisa necessária

O uso do OAuth ChatGPT como upstream Responses não é uma interface pública estável. O usuário decidiu conscientemente seguir essa direção por velocidade. Isole essa dependência atrás de uma interface pequena e substituível.

Antes de codificar o adaptador upstream:

1. Identifique a versão instalada de `codex`.
2. Consulte o código aberto correspondente do `openai/codex`, especialmente o provider usado quando `auth_mode` é ChatGPT.
3. Confirme, sem adivinhar, o endpoint, os cabeçalhos obrigatórios, o formato de streaming e o mecanismo de refresh da versão atual.
4. Nunca copie exemplos aleatórios de proxies sem validar contra uma requisição real.
5. Nunca registre `Authorization`, access token, refresh token, ID token ou conteúdo integral das requisições.

O endpoint provável deve ser configurável por ambiente e não espalhado pelo código. Crie algo equivalente a:

- `CODEX_OAUTH_RESPONSES_URL`
- valor padrão somente depois de comprovado contra a versão instalada;
- validação estrita de HTTPS e hostname permitido;
- nenhuma URL controlada pelo cliente.

### Mapa da implementação atual

Use e preserve os componentes existentes:

- `server/src/account-store.ts`
  - Registro multi-conta.
  - Cada conta possui `accountId`, `codeHome`, porta e estado próprio.
  - Contas adicionais usam `REMOTE_CODEX_STATE_DIR/accounts/<accountId>/CODEX_HOME`.

- `server/src/account-worker.ts`
  - Inicia um `codex app-server` por conta.
  - Mantém conexão administrativa autenticada localmente.
  - Já consulta login, rate limits, usage e `model/list`.
  - Deve ganhar um método explícito e seguro de garantir refresh OAuth antes de inferência.

- `server/src/host-agent.ts`
  - Mantém o túnel de saída até o relay.
  - Seleciona `AccountWorker` por `accountId`.
  - Emite sessões, sincroniza contas/dispositivos e cota.
  - Hoje abre streams JSON-RPC para o app-server central; mantenha o legado sob feature flag, mas crie o novo broker Responses.

- `server/src/access-store.ts`
  - Fonte local de tokens de dispositivo, hashes, reserva, conta, modelos e uso.
  - Já possui acumulador monotônico `quotaConsumedPercent`, inclusive para reset da janela semanal.
  - Reuse essa autoridade. Adicione idempotência por response/request sem quebrar registros antigos.

- `server/src/protocol.ts`
  - Protocolo versionado relay-host.
  - Adicione mensagens específicas para inferência HTTP/streaming; não force streaming grande dentro de `control.request`.

- `server/src/relay.ts`
  - Servidor público, autenticação dos tokens temporários, políticas, rate limit, APIs e WebSocket legado.
  - Adicione o endpoint Responses compatível e faça-o falhar fechado.
  - Reuse a validação do dispositivo, conta, reserva, expiração, revogação, limite e modelos.

- `server/src/supabase.ts`
  - Persiste snapshots, eventos sanitizados e auditoria.
  - Não persista conteúdo de prompts/respostas.

- `server/src/rate-limiter.ts`
  - Reuse e especialize limites para inferência.

- `web/src/legacy/dashboard.js` e template correspondente
  - Hoje entregam comando para `codex --remote`.
  - Devem oferecer o novo modo **Codex CLI local**, com perfil e token temporário.

- `server/test/relay.test.ts`, `server/test/host-agent.test.ts`, `server/test/access-store.test.ts`
  - Amplie os testes sem remover coberturas existentes.

### Endpoint público compatível com Codex

Implemente inicialmente via HTTP + SSE:

- `POST /api/codex/v1/responses`
- `POST /api/codex/v1/responses/compact`, se a versão do CLI realmente o solicitar;
- outros caminhos somente após captura/validação real.

Não crie um proxy HTTP genérico. Métodos e paths devem estar em allowlist fixa.

O endpoint deve:

1. Aceitar apenas `Authorization: Bearer <token temporário FECART>`.
2. Rejeitar token em query string.
3. Resolver o dispositivo pelo hash usando a lógica existente.
4. Validar novamente:
   - token não revogado;
   - token não desabilitado;
   - horário não expirado;
   - reserva ativa/aprovada;
   - conta autenticada e pronta;
   - cota ainda disponível;
   - modelo presente em `allowedModels`.
5. Ignorar/remover qualquer Authorization ou header upstream enviado pelo cliente.
6. Fixar `deviceId`, `reservationId`, `userId` e `accountId` a partir do token; nunca aceitar esses valores do body.
7. Encaminhar somente campos compatíveis da requisição Responses.
8. Preservar streaming SSE e status HTTP.
9. Abortar o upstream quando cliente desconectar, token for revogado, reserva expirar ou cota for atingida.
10. Não armazenar request/response body em logs.

Comece com `supports_websockets = false` no perfil para obrigar SSE. WebSocket Responses pode ser uma fase posterior, somente depois que SSE estiver validado.

### Extensão do protocolo relay-host

Crie mensagens versionadas equivalentes a estas, ajustando nomes conforme os padrões do projeto:

- `provider.request`
  - `requestId`
  - `deviceId`
  - `accountId`
  - `method`
  - `path`
  - headers estritamente sanitizados
  - body, com limite definido

- `provider.response.start`
  - `requestId`
  - status
  - headers de resposta permitidos (`content-type`, request id seguro etc.)

- `provider.response.chunk`
  - `requestId`
  - chunk base64 ou texto definido sem ambiguidade

- `provider.response.end`
  - `requestId`

- `provider.response.error`
  - erro sanitizado e classificável

- `provider.abort`
  - `requestId`
  - motivo sanitizado

Requisitos do túnel:

- IDs imprevisíveis e vinculados ao dispositivo.
- Limite de requests concorrentes por token, IP e conta.
- Limite de body e de chunk.
- Backpressure usando `bufferedAmount`; não acumular streaming ilimitado em memória.
- Cancelamento com `AbortController` no host.
- Limpeza determinística de mapas/timers em sucesso, erro, timeout, queda do túnel e revogação.
- Queda do host ou perda de sincronização deve falhar fechado.
- O relay nunca recebe OAuth da OpenAI.

### Broker OAuth no host

Crie uma abstração como `CodexOAuthProvider`/`OAuthResponsesBroker` em arquivo próprio. Não coloque toda a implementação dentro de `host-agent.ts`.

Responsabilidades:

- receber apenas conta já selecionada e requisição sanitizada;
- localizar o `AccountRecord.codeHome` correspondente;
- confirmar que o `AccountWorker` está `ready`;
- garantir refresh OAuth por meio do Codex/app-server antes da chamada;
- ler `auth.json` somente no host e validar seu schema;
- usar somente o access token atual e o account id necessário;
- renovar e repetir uma única vez em 401 autenticável;
- nunca enviar refresh token ao relay;
- nunca registrar tokens;
- manter cache somente em memória e apagá-lo ao logout/remoção da conta;
- usar um endpoint upstream fixo/configurado, sem SSRF;
- transportar SSE sem bufferizar a resposta inteira.

O `auth.json` atual tem, no host, a forma aproximada:

```text
auth_mode
tokens.id_token
tokens.access_token
tokens.refresh_token
tokens.account_id
last_refresh
```

Isso é apenas um mapa estrutural. Não imprima valores durante desenvolvimento ou testes.

### Seleção multi-conta

- A reserva já contém `account_id`.
- A emissão de sessão já grava `accountId` no dispositivo.
- Toda inferência deve usar exclusivamente a conta vinculada ao token.
- Nunca use a conta padrão como fallback para uma sessão que já possui `accountId`.
- Se a conta ficar offline, em login obrigatório ou desabilitada, retorne erro claro e não tente outra conta.
- Reservas de contas diferentes devem poder operar em paralelo.
- A política atual de não sobreposição por conta deve continuar valendo.

### Modelos

- A UI administrativa já carrega modelos via `model/list` do app-server.
- `codex_app_settings.enabled_models` define a política global.
- A sessão recebe a interseção entre modelos habilitados e modelos presentes na API da conta.
- O endpoint `/responses` deve validar o campo top-level `model` antes de abrir o upstream.
- O host deve revalidar a mesma política para defesa em profundidade.
- Tentativa de modelo bloqueado deve retornar erro 403/400 estável e gerar auditoria sem derrubar outras sessões.
- O proxy é a autoridade, mesmo se o `/model` do Codex CLI local mostrar um item que ficou desabilitado depois.
- Ao alterar a política administrativa, novas requisições de sessões abertas devem obedecer imediatamente.

### Ferramentas e ambiente local

Não remova do body as definições de ferramentas locais que o Codex envia ao modelo. O modelo precisa poder retornar chamadas de shell, apply patch e demais ferramentas para o runtime local executar.

Classificação esperada:

- shell, arquivos, Git, apply patch e processos: executados pelo Codex CLI local;
- aprovações e sandbox: Codex CLI local;
- skills e MCP locais: máquina do usuário;
- web search hospedado pelo provider: passa pelo gateway/upstream;
- nenhum comando deve ser executado pelo app-server central no novo modo.

Inclua um teste de aceitação que peça ao Codex para criar um arquivo marcador. O arquivo deve existir na máquina cliente e não pode existir em `CODEX_HOME`, workspace ou filesystem do host.

### Medição, cota e revogação

Hoje o host mede tokens por notificações `thread/tokenUsage/updated` do app-server. No novo fluxo, extraia usage das respostas Responses/SSE no host, antes de devolver os eventos ao relay.

Requisitos:

- parser SSE incremental resistente a chunks partidos, CRLF e UTF-8 multibyte;
- reconhecer término e usage da versão real do upstream;
- deduplicar por `response.id`/request id;
- registrar input, cached input, output, reasoning e total quando disponíveis;
- não contar duas vezes em retry/reconexão;
- atualizar `AccessStore.recordUsage` ou criar método específico compatível;
- continuar usando `account/rateLimits/read` como autoridade da porcentagem semanal;
- após cada resposta concluída, atualizar imediatamente rate limits da conta, sem esperar apenas o polling de 60 segundos;
- preservar o acumulador monotônico já implementado para resets semanais durante a sessão;
- bloquear a próxima requisição assim que o orçamento for atingido;
- se o limite for detectado durante uma resposta, abortar/cortar conforme política existente e emitir `session.quota.exhausted` uma única vez;
- revogação, cancelamento e fim do horário devem abortar requests ativos em poucos segundos, não apenas impedir o próximo request.

Eventos mínimos, sem conteúdo sensível:

- `provider.request.started`
- `provider.request.completed`
- `provider.request.failed`
- `provider.model.denied`
- `session.quota.exhausted`
- `session.revoked`/equivalente existente

Metadados permitidos: IDs, conta, modelo, timestamps, status, latência e contadores de tokens. Proibido: prompt, resposta, comandos, caminhos locais, conteúdo de arquivo e cabeçalhos secretos.

### Experiência do usuário

No dashboard da reserva ativa, adicione uma opção destacada **Codex CLI local**.

Ela deve fornecer:

1. Um arquivo/perfil `fecart.config.toml` sem segredo persistido.
2. Um comando PowerShell e um Bash equivalente que definem o token apenas no ambiente do processo.
3. Um comando semelhante a:

```powershell
$env:FECART_CODEX_TOKEN = "TOKEN_TEMPORARIO"
codex --profile fecart -C "C:\caminho\do\projeto"
```

4. Instrução curta para instalar o perfil em `$CODEX_HOME/fecart.config.toml` ou usar um launcher seguro.
5. URL baseada na origem pública atual, nunca hardcoded para localhost.
6. Aviso de expiração e conta selecionada.
7. Nenhum OAuth, Supabase secret ou relay-agent token no cliente.

O token temporário já é exibido uma única vez. Não o grave automaticamente em arquivo, histórico ou log. Se gerar script para download, deixe claro que contém segredo e prefira launcher que receba o token por variável de ambiente.

Mantenha o fluxo legado `codex --remote` atrás de uma flag durante a migração, por exemplo:

- `PROVIDER_PROXY_ENABLED=1`
- `LEGACY_REMOTE_APP_SERVER_ENABLED=1`

O novo fluxo deve ser o recomendado na UI quando estiver pronto.

### Segurança obrigatória

- TLS obrigatório fora de localhost.
- Token FECART somente em header Bearer.
- OAuth e refresh token somente no host.
- Relay público armazena somente hash do token temporário, como hoje.
- Comparação de token resistente a timing, reutilizando `server/src/crypto.ts`.
- Nenhum proxy genérico de URL, método ou header.
- Bloquear SSRF, hop-by-hop headers, header smuggling e redirects para host não permitido.
- Limites de body, concorrência, duração e bytes de streaming.
- Não seguir redirects para domínio inesperado.
- Não aceitar `accountId`, `deviceId` ou `reservationId` fornecidos pelo cliente.
- Não aceitar tentativa de selecionar modelo fora da política.
- Cancelar upstream ao desconectar.
- Sanitizar mensagens de erro para não revelar endpoint interno, token ou estrutura do host.
- Não usar credenciais em query string ou argumentos de processo.
- Não armazenar conteúdo de conversas no Supabase.

### Banco e migrations

Evite mudança de schema na primeira versão. As estruturas atuais já possuem reserva, conta, dispositivo, cota, snapshots, auditoria e eventos de uso.

O repositório contém várias migrations locais ainda não necessariamente aplicadas no remoto. Antes de qualquer migration:

- compare migration history local/remota;
- não aplique migrations não relacionadas em lote;
- só crie migration se a implementação realmente exigir nova coluna/tabela;
- siga o fluxo Supabase e valide RLS/índices;
- nunca exponha secret/service-role no frontend.

### Ordem recomendada de implementação

1. Criar testes e fixtures de uma Responses API SSE mínima.
2. Criar tipos de protocolo `provider.*` e testes de encode/decode.
3. Implementar `OAuthResponsesBroker` isolado com upstream mock.
4. Implementar túnel streaming host-relay com abort e backpressure.
5. Implementar endpoint `/api/codex/v1/responses` autenticado e fail-closed.
6. Aplicar política de conta/modelo/cota nos dois lados.
7. Extrair usage e integrar com `AccessStore`/telemetria.
8. Atualizar dashboard e gerar perfil/comandos locais.
9. Manter o caminho legado sob flag.
10. Executar teste real com Codex CLI local e conta OAuth autenticada.
11. Reiniciar o ambiente local e validar `/readyz`.
12. Atualizar `README.md`, `PRODUCT.md`, `.env.example` e `SECURITY.md`.

### Testes automatizados mínimos

- Token válido abre `/responses`.
- Token inválido, revogado, desabilitado, expirado ou limitado é negado.
- Host desconectado falha fechado.
- Reserva de uma conta nunca usa outra conta.
- Modelo permitido passa; modelo bloqueado não chega ao host/upstream.
- Alteração de política afeta request seguinte de sessão aberta.
- SSE é retransmitido com ordem e bytes corretos.
- Parser funciona com chunks divididos em todas as posições relevantes.
- Usage é contado uma única vez.
- Retry 401 faz um único refresh e não duplica inferência indevidamente.
- Desconexão do cliente envia abort ao host.
- Revogação e fim do horário abortam request ativo.
- Limite de concorrência e payload retornam erros controlados.
- OAuth e headers secretos nunca aparecem em snapshots, protocolo, logs ou resposta HTTP.
- Duas contas funcionam simultaneamente e ficam isoladas.
- Testes existentes continuam passando.

### Teste manual de aceitação obrigatório

Use uma máquina/ambiente cliente separado do host sempre que possível.

1. Criar uma pasta temporária somente no cliente.
2. Instalar/usar o perfil FECART.
3. Emitir token de uma reserva aprovada para uma conta específica.
4. Rodar o Codex CLI local com `-C` apontando para a pasta cliente.
5. Pedir para criar e editar um arquivo.
6. Confirmar que o arquivo existe somente no cliente.
7. Confirmar modelo permitido.
8. Tentar modelo bloqueado e confirmar recusa antes do upstream.
9. Executar consulta que use web search, se o upstream OAuth atual suportar.
10. Confirmar telemetria de modelo/tokens sem conteúdo.
11. Revogar o token durante streaming e confirmar corte imediato.
12. Testar esgotamento de cota e reset semanal simulado.
13. Testar uma segunda conta e comprovar isolamento.

### Critérios de conclusão

O trabalho só está concluído quando:

- o Codex CLI oficial conecta usando o provider FECART;
- o agente cria/edita/executa exclusivamente na máquina cliente;
- o host mantém OAuth e seleciona a conta da reserva;
- modelos bloqueados não chegam ao upstream;
- streaming e web search compatível funcionam;
- uso e cota são monitorados;
- revogação/expiração/cota encerram requests ativos;
- segredos não aparecem no relay, banco, browser ou logs;
- os testes automatizados passam;
- há evidência do teste manual;
- documentação e comandos de instalação estão atualizados.

Ao finalizar, entregue:

- resumo da arquitetura implementada;
- lista de arquivos alterados;
- comandos exatos de configuração do host, relay e cliente;
- variáveis de ambiente novas;
- resultados dos testes;
- evidências do teste cliente versus host;
- limitações conhecidas do endpoint OAuth atual;
- instruções de rollback para o fluxo legado.

---

## Notas de arquitetura para revisão humana

### Por que não duplicar o WebSocket atual

O WebSocket atual transporta o protocolo JSON-RPC do `app-server`, isto é, o agente completo. Replicá-lo mantém shell e filesystem no host. O novo gateway precisa transportar o protocolo de provider (`Responses`) antes do loop de ferramentas; assim o loop permanece dentro do Codex CLI local.

### Papel exato do app-server no novo desenho

O app-server não será descartado. Ele continuará sendo a forma mais prática de:

- realizar login device-code;
- manter cada OAuth dentro do respectivo `CODEX_HOME`;
- renovar credenciais;
- consultar catálogo e rate limits oficiais da conta;
- detectar logout/login obrigatório.

Ele não deverá receber threads dos usuários no modo local-runtime.

### Risco técnico principal

O adaptador entre OAuth ChatGPT e Responses depende do comportamento atual do Codex open source e não de uma API pública estável. Por isso precisa ser pequeno, testado, configurável, versionado e substituível. Se o upstream mudar, o fluxo legado deve continuar disponível para rollback.

