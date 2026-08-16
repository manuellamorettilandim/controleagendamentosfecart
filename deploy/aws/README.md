# Deploy AWS Lightsail

Este deploy executa o site, o relay e o host-agent na mesma Lightsail, mantendo o Supabase externo.

## Tamanho recomendado para o credito atual

- Ubuntu 24.04 LTS
- Oregon (`us-west-2`)
- Linux/Unix de 2 GB RAM, 2 vCPU e 60 GB SSD
- IPv4 estatico
- Firewall publico em TCP 80, 443 e 22. O SSH aceita somente chaves; o usuário do Codex App não possui senha nem shell irrestrito.

## Deploy e atualizacoes

Baixe a chave SSH padrao da regiao pelo Lightsail e execute no PowerShell:

```powershell
.\scripts\deploy-aws.ps1 `
  -IpAddress 'IP_ESTATICO' `
  -KeyPath 'CAMINHO_DA_CHAVE.pem'
```

O script:

1. le somente as variaveis necessarias do `.env` local;
2. calcula o hash do token do relay;
3. empacota o projeto sem `.env`, `.git`, dependencias ou builds;
4. instala Node.js 22, Codex CLI, OpenSSH e Caddy;
5. cria usuarios Linux separados para relay e host;
6. transmite os ambientes pela conexao SSH, sem coloca-los no pacote;
7. registra e inicia os servicos systemd;
8. publica em `https://fecart.IP-COM-HIFENS.sslip.io` e habilita o acesso temporário do Codex App por SSH.

O mesmo comando atualiza o codigo futuramente criando uma nova release e reiniciando os servicos.

## Operacao

```bash
sudo systemctl status fecart-relay fecart-host caddy
sudo journalctl -u fecart-relay -u fecart-host -f
sudo systemctl restart fecart-relay fecart-host
```

Depois do primeiro deploy, abra `/admin` e autentique cada conta Codex por device-code. Os grupos, administradores, reservas e auditoria continuam no Supabase atual.

No Lightsail, confirme que a regra TCP 22 está liberada. Cada sessão recebe uma chave Ed25519 diferente; o host mantém apenas a chave pública em `authorized_keys`. O comando forçado aceita somente a inicialização do Codex App e a chave deixa de ser autorizada quando a sessão é desabilitada, revogada ou expira.
