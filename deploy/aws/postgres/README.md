# PostgreSQL e backups na Lightsail

O bootstrap instala PostgreSQL 17 e as units, mas **não restaura o dump, não
habilita os timers e não troca o runtime automaticamente**.
Veja o plano e os critérios de corte em
[`docs/DATABASE_MIGRATION.md`](../../../docs/DATABASE_MIGRATION.md).

## Agenda e retenção

| Classe | Agenda UTC | Retenção local | Prefixo S3 |
| --- | --- | ---: | --- |
| `six-hour` | 00:15, 06:15, 12:15, 18:15 | 8 dumps | `fecart/postgres/six-hour/` |
| `daily` | 03:30 | 30 dumps | `fecart/postgres/daily/` |

O atraso aleatório dos timers reduz colisões com outras tarefas. Um backup
parcial nunca recebe o nome final. A limpeza local só acontece depois que dump
e checksum chegam ao S3.

## Preparação futura

1. Criar um bucket privado em região separada quando possível, com Block Public
   Access, versionamento e criptografia padrão.
2. Aplicar `s3-lifecycle.json`, ajustando o prefixo se `S3_PREFIX` mudar.
3. Criar credencial AWS exclusiva com permissão mínima para gravar e listar
   somente esse prefixo. Guardá-la no environment file protegido, nunca no
   repositório ou no pacote de release.
4. Criar role PostgreSQL `fecart_backup` com `CONNECT`, `USAGE` nos schemas e
   `SELECT` nas tabelas/sequences necessárias. Ela não deve escrever no banco.
5. Instalar `postgresql-client`, `awscli`, o script, o service e os dois timers.
6. Criar `/etc/fecart/postgres-backup.env` a partir do exemplo, com mode `0640`.
7. Testar manualmente as duas classes antes de habilitar os timers.

Exemplo de validação futura:

```bash
sudo -u fecart-backup systemctl start fecart-db-backup@six-hour.service
sudo systemctl status fecart-db-backup@six-hour.service
sudo -u fecart-backup sha256sum --check /var/backups/fecart/postgres/six-hour/*.sha256
aws s3 ls s3://SEU_BUCKET/fecart/postgres/six-hour/
```

Depois, fazer uma restauração real em um banco descartável e comparar o
inventário. Listar o dump com `pg_restore --list` detecta corrupção estrutural,
mas não substitui um teste de restauração.
