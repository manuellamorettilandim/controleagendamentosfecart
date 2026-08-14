---
name: Remote Codex
description: Console operacional em português para reservar e controlar acesso temporário ao Codex.
colors:
  canvas-light: "#f3f6f4"
  surface-light: "#ffffff"
  surface-2-light: "#f8faf8"
  surface-3-light: "#edf2ef"
  text-light: "#1d2925"
  muted-light: "#687871"
  muted-strong-light: "#4c5c54"
  line-light: "#dce5df"
  line-strong-light: "#c7d5cd"
  accent-light: "#278764"
  accent-strong-light: "#146448"
  accent-soft-light: "#dff2e9"
  coral-light: "#d96f5f"
  coral-soft-light: "#fae5e0"
  amber-light: "#b97725"
  amber-soft-light: "#f8ecd9"
  danger-light: "#bd4f5c"
  danger-soft-light: "#f8e0e4"
  inverse-light: "#1b332b"
  canvas-dark: "#111614"
  surface-dark: "#181e1b"
  surface-2-dark: "#1d2521"
  surface-3-dark: "#242e29"
  text-dark: "#eef5f0"
  muted-dark: "#a1b0a8"
  muted-strong-dark: "#c5d3cb"
  line-dark: "#2c3832"
  line-strong-dark: "#3d4b43"
  accent-dark: "#72d6a2"
  accent-strong-dark: "#a1ebc1"
  accent-soft-dark: "#173c2e"
  coral-dark: "#ef8b78"
  coral-soft-dark: "#4a2824"
  amber-dark: "#e7bd75"
  amber-soft-dark: "#453622"
  danger-dark: "#f28b92"
  danger-soft-dark: "#48252a"
  inverse-dark: "#0a100d"
typography:
  display:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.9rem, 7vw, 6rem)"
    fontWeight: 850
    lineHeight: 0.95
    letterSpacing: "-0.05em"
  headline:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.8rem"
    fontWeight: 850
    lineHeight: 1
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.65rem"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "0.14em"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "1rem"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "tabular-nums"
rounded:
  micro: "5px"
  code: "6px"
  compact: "9px"
  control: "10px"
  field: "11px"
  surface-inner: "12px"
  surface: "16px"
  pill: "999px"
spacing:
  xs: "0.45rem"
  sm: "0.7rem"
  md: "1rem"
  lg: "1.25rem"
  xl: "1.7rem"
  2xl: "2.2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.inverse-light}"
    rounded: "{rounded.control}"
    padding: "0 1.1rem"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.muted-strong-light}"
    rounded: "{rounded.control}"
    padding: "0 0.8rem"
    height: "38px"
  input:
    backgroundColor: "{colors.surface-2-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.field}"
    padding: "0 1rem"
    height: "46px"
  card:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.surface}"
    padding: "1.4rem"
  state-chip:
    backgroundColor: "{colors.surface-3-light}"
    textColor: "{colors.muted-strong-light}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.65rem"
  nav-active:
    backgroundColor: "{colors.accent-soft-light}"
    textColor: "{colors.accent-strong-light}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.7rem"
---

# Design System: Remote Codex

## Overview

**Creative North Star: "A Mesa de Operações"**

A direção visual implementada é **Atlas de Operações**, registrada no trabalho com o seed `9019c2f2`. A interface funciona como um console de acesso: concentrada, legível e orientada a estado. O tema claro e o tema escuro são duas leituras do mesmo sistema, com superfícies tonais, bordas discretas e um mint reservado para disponibilidade, seleção e ações seguras.

O fluxo visual coloca a decisão operacional antes da explicação: login curto, relógio e estado atual, quota, próxima ação, agenda e histórico. A administração amplia essa lógica para um rail persistente, sinais de saúde, dados observados e ações confirmadas. Tipografia de sistema, números tabulares e cópia direta mantêm a leitura rápida sem transformar segurança em ornamentação.

**Seed registrado:** `9019c2f2`.

**Key Characteristics:**

- Superfícies claras ou grafite em camadas, unidas por bordas de baixo contraste.
- Mint operacional para disponibilidade, seleção e ações primárias; coral e âmbar para conflito e atenção.
- Dados temporais, percentuais, quota e tokens com leitura compacta e algarismos tabulares.
- Controles arredondados, densos e confortáveis ao toque, com confirmação explícita para ações destrutivas.

## Colors

A paleta é semântica e bifásica: a base clara usa papel frio e verde profundo; a base escura usa grafite esverdeado e mint luminoso. Os pares `light` e `dark` do frontmatter correspondem diretamente aos valores aplicados pelo tema.

### Primary

- **Mint operacional claro** (`{colors.accent-light}` / `{colors.accent-strong-light}`): ações primárias, seleção, estado online e progresso positivo.
- **Mint operacional escuro** (`{colors.accent-dark}` / `{colors.accent-strong-dark}`): a mesma função no tema escuro, com maior luminosidade para manter contraste sobre grafite.

### Secondary

- **Coral de conflito claro** (`{colors.coral-light}` / `{colors.coral-soft-light}`): slots ocupados e conflito de agenda.
- **Coral de conflito escuro** (`{colors.coral-dark}` / `{colors.coral-soft-dark}`): o mesmo estado em superfícies escuras.

### Tertiary

- **Âmbar de atenção claro** (`{colors.amber-light}` / `{colors.amber-soft-light}`): relay indisponível, snapshot desatualizado, credencial próxima da expiração e avisos de configuração.
- **Âmbar de atenção escuro** (`{colors.amber-dark}` / `{colors.amber-soft-dark}`): atenção equivalente no tema escuro.
- **Perigo claro e escuro** (`{colors.danger-light}` / `{colors.danger-dark}` e seus fundos suaves): erro, limite atingido, desabilitação e revogação.

### Neutral

- **Papel e grafite de fundo** (`{colors.canvas-light}` / `{colors.canvas-dark}`): canvas geral da aplicação.
- **Superfície principal** (`{colors.surface-light}` / `{colors.surface-dark}`): header, cards, consoles, tabelas e modais.
- **Superfícies de apoio** (`{colors.surface-2-light}`, `{colors.surface-3-light}` / `{colors.surface-2-dark}`, `{colors.surface-3-dark}`): campos, trilhos, áreas internas e estados neutros.
- **Texto principal e auxiliar** (`{colors.text-light}`, `{colors.muted-light}`, `{colors.muted-strong-light}` / equivalentes escuros): hierarquia de leitura, instruções e metadados.
- **Linhas** (`{colors.line-light}`, `{colors.line-strong-light}` / equivalentes escuros): divisores, contornos e campos.
- **Inverso operacional** (`{colors.inverse-light}` / `{colors.inverse-dark}`): palco de autenticação, código e texto sobre ações mint.

**The Signal Rule.** Mint comunica ação disponível, seleção ou estado online; não preenche grandes áreas sem função.

## Typography

**Display Font:** Aptos (com Segoe UI Variable, Segoe UI, ui-sans-serif e system-ui como fallback)
**Body Font:** Aptos (com Segoe UI Variable, Segoe UI, ui-sans-serif e system-ui como fallback)
**Label/Mono Font:** fonte monoespaçada do sistema para tokens, comandos, horários auxiliares e dados técnicos.

**Character:** A família de sistema mantém o produto direto e nativo no Windows. Pesos altos, entreletra negativa e alturas de linha apertadas dão prioridade a estado e ação; textos auxiliares recuam por tamanho e cor, não por excesso de ornamentação.

### Hierarchy

- **Display** (peso 850, `clamp(2.9rem, 7vw, 6rem)`, line-height `.95`): promessa e contexto do login público; o palco de autenticação usa uma variante até `5.8rem`.
- **Headline** (peso 850, `2.8rem`, line-height `1`): títulos de sessão e páginas de usuário; no admin, o topo reduz para `2.65rem`.
- **Title** (peso 800, `1.65rem`, line-height `1.08`): agenda, seções e títulos de bloco.
- **Body** (peso 400, `1rem`, line-height `1.55`): instruções, descrições e contexto, com parágrafos auxiliares limitados em geral a `62ch`.
- **Label** (peso 850, `.72rem`, letter-spacing `.14em`, uppercase): eyebrow, navegação de rail, cabeçalhos de tabela e estados compactos.
- **Data** (peso 800, fonte monoespaçada quando técnica, `tabular-nums`): relógio, percentuais, tokens, quotas e horários que mudam sem deslocar a interface.

**The Clock Rule.** Horários, percentuais e contadores usam algarismos tabulares para não saltarem visualmente durante atualizações.

## Layout

O sistema usa um atlas de superfícies, não um canvas único. A documentação pública e os fluxos amplos usam container de até `1240px`; o dashboard do usuário usa `min(1380px, calc(100% - 2rem))`; o admin trabalha em conteúdo de até `1400px` dentro de uma grade com rail de `248px`.

O login é bipartido no desktop, com palco contextual e painel de formulário em uma grade `1.12fr / .88fr`; o painel tem largura mínima de `390px`. O dashboard prioriza uma grade assimétrica de tempo e quota, depois acesso rápido, agenda e reservas. O admin começa com quatro sinais de operação, atividade próxima e atenção antes das tabelas.

Breakpoints observados:

- **`1020px`**: o login vira uma coluna e oculta o palco; tempo e quota do dashboard empilham; insights e overview administrativo reduzem a grade.
- **`820px`**: navegação pública quebra para uma faixa rolável; o rail administrativo vira uma barra sticky com navegação compacta; o topo administrativo empilha.
- **`620px`**: headers e intros reorganizam, o relógio reduz, a agenda de dias rola horizontalmente, controles de reserva empilham e tabelas administrativas viram cards rotulados por campo.

O ritmo espacial combina gaps compactos (`.45rem`–`.7rem`) em controles e listas com respiros de seção de `1rem`–`2.2rem`. A densidade cresce em tabelas e trilhos, mas a primeira vista preserva estado, quota e próxima ação.

## Elevation & Depth

A profundidade é híbrida, com tonalidade como primeira camada e sombra ambiental como segunda. Cards operacionais, agenda e containers usam a sombra padrão do tema; modais recebem uma sombra mais alta e backdrop escurecido com blur. Muitos painéis administrativos permanecem planos quando a borda e a diferença tonal já explicam a hierarquia.

### Shadow Vocabulary

- **Ambient panel** (`0 12px 30px rgba(26, 54, 43, .07)` no claro; `0 14px 34px rgba(0, 0, 0, .22)` no escuro): cards, consoles e containers de operação.
- **High dialog** (`0 18px 42px rgba(26, 54, 43, .13)` no claro; `0 22px 50px rgba(0, 0, 0, .34)` no escuro): dialogs e superfícies que precisam interromper o fluxo.
- **State lift** (elevação curta em hover e slots selecionados): reforça resposta, não cria uma nova camada permanente.

**The Tonal Stack Rule.** Primeiro separe superfícies por tom; use sombra apenas quando o painel precisa se destacar do fluxo.

## Shapes

O vocabulário de forma é suavemente arredondado, mas não infantilizado: surfaces principais usam `16px`, containers internos `12px`, campos `11px`, controles `10px` e compactos `9px`. Chips, badges e controles de status usam cápsulas completas. A marca `RC`, avatares, sinais vivos e marcadores de fluxo usam círculos ou quadrados arredondados; o rail e os dialogs mantêm o mesmo contorno discreto das superfícies.

Bordas de `1px` são a regra de separação. O preenchimento de campos fica na superfície de apoio; o foco altera a borda para mint. Slots de agenda usam retângulos estreitos de `5px` para que a grade de 24 horas permaneça legível.

## Components

### Buttons

Botões são densos, textuais e orientados à consequência da ação.

- **Shape:** controles arredondados (`10px`), com altura mínima de `44px` para ações de sessão, `42px` para o botão público e `38px` para ações secundárias/admin.
- **Primary:** mint preenchido, texto inverso, peso `900`, padding horizontal de `1.1rem`; usado para entrar, agendar, gerar, emitir e confirmar.
- **Secondary / Ghost:** superfície neutra, borda de linha forte e texto auxiliar; a variante ghost mantém o fundo transparente quando a ação é de apoio.
- **Danger:** contorno e texto de perigo; revogar, desabilitar e ações irreversíveis exigem confirmação em dialog.
- **Hover / Focus:** hover desloca o controle `1px` para cima e reforça cor/sombra; o foco global usa contorno mint de `3px` com offset `3px`. Botões desabilitados perdem opacidade (`.45`–`.5`) e não se movem.

### Chips

- **Style:** `state-chip` e `admin-badge` são cápsulas curtas com ponto ou texto explícito; o fundo neutro comunica repouso, mint sucesso, âmbar atenção e perigo erro/bloqueio.
- **State:** o texto sempre acompanha a cor: `Horário ativo`, `Desligado`, `ativo`, `limite atingido`, `revogado`, `expirado`, `snapshot desatualizado` ou `Offline`.

### Cards / Containers

- **Corner Style:** `16px` para consoles e seções, `13px` para cards administrativos e `12px` para linhas de reserva e superfícies internas.
- **Background:** `surface` como camada principal; `surface-2` e `surface-3` para conteúdo interno, trilhos e estados neutros.
- **Shadow Strategy:** seguir a camada tonal antes de aplicar `Ambient panel`; dialogs usam `High dialog`.
- **Border:** linha de `1px` por padrão; mint indica default, seleção ou estado pronto.
- **Internal Padding:** `1.05rem`–`1.4rem` em cards compactos, `clamp(1.35rem, 4vw, 2.5rem)` no console de tempo e `clamp(1.1rem, 3vw, 1.7rem)` em agenda.

### Inputs / Fields

- **Style:** campos de autenticação têm altura mínima de `46px`, raio `11px`, fundo `surface-2`, borda `line-strong` e padding horizontal de `1rem`; admin e busca usam altura mínima de `42px`/`40px` e raio `10px`.
- **Focus:** a borda muda para mint; a página aplica anel visível de foco de `3px` aos controles gerais, enquanto campos administrativos mantêm a borda mint e suprimem o outline nativo.
- **Error / Disabled:** mensagens ficam abaixo do campo em perigo; controles indisponíveis ficam desabilitados com opacidade reduzida. A tela de login desabilita o formulário quando o relay não está configurado e mostra uma chamada de atenção com retry.

### Navigation

- **Public:** header com identidade e links em cápsulas, container de `1240px`, divisor inferior e estado ativo em fundo mint suave.
- **User:** header compacto com identidade, avatar, alternância de tema e saída; em telas pequenas, a identidade e as ações quebram sem esconder a saída.
- **Admin:** rail de `248px` no desktop, label de seção em uppercase, ícones SVG inline e item ativo com borda/fundo mint. Em `820px`, o rail vira barra sticky; em `620px`, os itens ficam em uma coluna.

### Session Console

O dashboard coloca o relógio grande (`6.2rem`, reduzido para `4.3rem` no mobile), o estado atual, tempo restante e próxima reserva na mesma leitura. O medidor de quota traduz a franquia pessoal em percentual disponível e mantém a origem temporal no texto auxiliar.

O bloco de acesso rápido sempre oferece a próxima ação: quando a credencial ainda não está disponível, leva diretamente à agenda; quando está pronta, expõe o comando e as ações de cópia.

### Schedule Board

A agenda combina uma faixa de sete dias, grade horizontal de 24 horas, legenda textual e seletor de duração de uma a três horas. Slots livres, selecionados, ocupados e encerrados têm tratamento textual/estrutural além da cor; no mobile a grade aceita rolagem horizontal.

### Dialogs / Operational Modals

O admin usa dialogs nativos para emitir token, iniciar login de conta, adicionar conta, convidar administrador e confirmar desabilitação/revogação. Cada modal tem label de contexto, título, explicação de consequência, erro no formulário quando necessário e ações explícitas de cancelar/fechar.

## Do's and Don'ts

### Do:

- **Do** use mint only when the interface is communicating availability, selection, a safe primary action or a positive state.
- **Do** preserve immediate reading of time, quota, expiration, access state and data freshness at every breakpoint.
- **Do** keep tokens, commands, percentages and technical timestamps in a monospaced or tabular treatment when they change.
- **Do** pair state color with visible text, status labels, legends or explanatory copy.
- **Do** keep destructive actions behind confirmation and make the consequence explicit.
- **Do** respect the persisted light/dark preference, system preference fallback and `prefers-reduced-motion`.

### Don't:

- **Don't** use decorative gradients or introduce a second highlight color outside mint, coral, amber and danger semantics.
- **Don't** elevate every card; tonal layering and a quiet border should carry most hierarchy.
- **Don't** hide expiration, quota exhaustion, relay unavailability or revocation behind a secondary interaction.
- **Don't** rely on color alone for schedule, quota or access states.
- **Don't** replace the direct Portuguese operational vocabulary with promotional or ornamental copy.
