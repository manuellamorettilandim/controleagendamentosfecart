---
name: Remote Codex
description: Console operacional escuro para reservar e controlar acesso temporário ao Codex.
colors:
  operational-black: "#07100d"
  surface: "#0d1814"
  surface-high: "#13221c"
  border: "#263a31"
  signal-green: "#70e0a3"
  signal-green-strong: "#35c980"
  primary-text: "#f2f8f5"
  secondary-text: "#91a69c"
  warning: "#f2c86f"
  danger: "#ff858d"
typography:
  display:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 4.5rem)"
    fontWeight: 760
    lineHeight: 0.95
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Aptos, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
rounded:
  control: "0.8rem"
  surface: "1rem"
  pill: "99px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-green}"
    textColor: "{colors.operational-black}"
    rounded: "{rounded.control}"
    padding: "0 1.15rem"
    height: "3.2rem"
  input:
    backgroundColor: "{colors.operational-black}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.control}"
    padding: "0 1rem"
    height: "3.45rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.surface}"
    padding: "1.5rem"
---

# Design System: Remote Codex

## Overview

**Creative North Star: "A Mesa de Operações"**

O produto se comporta como um console de acesso: escuro, concentrado e orientado a estado. Verde é um sinal operacional, não decoração; ele identifica disponibilidade, seleção e ações seguras. Tipografia grande e relógios tabulares tornam tempo e quota imediatamente legíveis.

**Key Characteristics:**

- Superfícies escuras em camadas, separadas por tom e bordas discretas.
- Verde luminoso reservado para ações e estados ativos.
- Dados temporais grandes, compactos e tabulares.
- Controles arredondados, densos e confortáveis ao toque.

## Colors

A paleta combina pretos esverdeados com texto frio e um único sinal verde vivo.

**The Signal Rule.** Verde vivo comunica ação disponível, seleção ou estado online; não preenche grandes áreas sem função.

## Typography

**Display Font:** Aptos (com Segoe UI Variable e Segoe UI como fallback)
**Body Font:** Aptos (com Segoe UI Variable e Segoe UI como fallback)
**Label/Mono Font:** fonte monoespaçada do sistema para credenciais e comandos

**Character:** A família de sistema mantém o console direto e nativo no Windows. Títulos usam peso alto, entreletra negativa e altura de linha apertada; textos auxiliares são menores e mais silenciosos.

**The Clock Rule.** Horários, percentuais e contadores usam algarismos tabulares para não saltarem visualmente durante atualizações.

## Layout

As superfícies principais usam um container amplo de até 1380px. O dashboard começa com uma grade assimétrica de tempo e quota, seguida por acesso rápido e agenda. Abaixo de 920px, a grade vira uma coluna; abaixo de 620px, cabeçalhos e controles se reorganizam verticalmente e a régua de dias aceita rolagem horizontal.

## Elevation & Depth

O sistema é plano por padrão e cria profundidade por variação tonal. Sombras ambientais suaves aparecem somente em painéis operacionais e diálogos; bordas de baixo contraste mantêm os limites perceptíveis.

**The Tonal Stack Rule.** Primeiro separe superfícies por tom; use sombra apenas quando o painel precisa se destacar do fluxo.

## Shapes

Cards usam cantos de 1rem. Inputs e botões usam 0.8rem; estados compactos usam cápsulas completas. Círculos são reservados para sinais, avatar e medidores de quota.

## Components

### Buttons

- Primários usam verde de sinal, texto escuro, peso alto e altura mínima confortável.
- Secundários são transparentes, com borda verde-acinzentada e texto frio.
- Foco visível usa contorno verde translúcido com deslocamento externo.

### Cards / Containers

- Painéis usam superfícies escuras tonais, raio de 1rem e sombra ambiental discreta.
- Cards de agenda e quota priorizam número, estado e prazo antes da explicação.

### Inputs / Fields

- Inputs têm fundo quase preto, borda discreta e raio de 0.8rem.
- O foco troca a borda para verde; erro usa rosa-avermelhado sem alterar o layout.

### Navigation

- Usuários comuns não recebem sidebar; o cabeçalho contém identidade e saída.
- Administração usa sidebar persistente no desktop e navegação horizontal no mobile.

### Quota Ring

- O anel mostra a franquia pessoal restante, não a quota bruta da conta.
- O centro mantém o percentual como leitura principal; texto adjacente esclarece bloqueio, uso ou encerramento.

## Do's and Don'ts

### Do:

- **Do** use verde apenas quando houver significado operacional.
- **Do** preserve leitura imediata de horário, quota e estado em qualquer breakpoint.
- **Do** mantenha tokens e comandos em fonte monoespaçada e com cópia explícita.

### Don't:

- **Don't** use gradientes decorativos ou múltiplas cores de destaque.
- **Don't** transforme todo card em um bloco elevado; profundidade deve indicar hierarquia.
- **Don't** esconda expiração, bloqueio ou indisponibilidade atrás de interação secundária.
