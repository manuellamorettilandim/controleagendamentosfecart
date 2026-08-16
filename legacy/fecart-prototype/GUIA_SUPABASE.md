# 🚀 Passo a Passo para Conectar ao Banco de Dados no Supabase

Siga os passos abaixo para conectar o seu site ao **Supabase** (https://supabase.com):

---

### 1️⃣ Criar um Projeto no Supabase
1. Acesse **[https://supabase.com](https://supabase.com)** e faça login (ou crie uma conta gratuita).
2. Clique no botão **"New Project"**.
3. Escolha uma organização, defina o **Name** do projeto (ex: `fecart-agendamentos`) e crie uma **Database Password**.
4. Clique em **"Create new project"** e aguarde cerca de 1 minuto para o banco ser preparado.

---

### 2️⃣ Criar as Tabelas no Banco de Dados
1. No painel do seu projeto Supabase, acesse o menu lateral esquerdo e clique em **SQL Editor** (ícone `>_`).
2. Clique no botão **"New query"**.
3. Abra o arquivo **`SUPABASE_SETUP.sql`** do seu projeto, copie todo o código e cole no SQL Editor.
4. Clique em **"Run"** (ou pressione `Ctrl + Enter`).
5. As tabelas `users` e `appointments` serão criadas automaticamente com todas as travas e auditorias!

---

### 3️⃣ Obter a URL e a Key do Supabase
1. No painel do seu projeto Supabase, clique em **Project Settings** (ícone de engrenagem ⚙️ no canto inferior esquerdo).
2. Selecione a opção **API**.
3. Copie os dois dados exibidos na tela:
   - **Project URL** (ex: `https://xyzcompany.supabase.co`)
   - **Project API Keys** ➡️ **`anon` `public`** (ex: `eyJhbGciOiJIUzI...`)

---

### 4️⃣ Conectar o Seu Site ao Supabase
Você tem **duas opções** muito fáceis para conectar:

#### Opção A (Direto no Código):
Abra o arquivo **`app.js`** e cole nas linhas 5 e 6:
```javascript
const CONFIGURED_SUPABASE_URL = "SUA_URL_DO_SUPABASE_AQUI";
const CONFIGURED_SUPABASE_KEY = "SUA_ANON_KEY_DO_SUPABASE_AQUI";
```

#### Opção B (Pela Interface do Admin):
1. Faça login no seu site como `admin`.
2. Acesse a aba **"Supabase"**.
3. Cole a **URL** e a **Anon Key** e clique em **"Salvar e Conectar"**.

Pronto! Seu site estará 100% conectado ao banco de dados no Supabase com sincronização em nuvem e registro de auditoria! ⚡🛡️
