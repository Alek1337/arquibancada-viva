# Armazenamento de objetos

O pacote `@arquibancada-viva/storage` define a fronteira `ObjectStorage` e contém o adapter
S3-compatible. API e worker recebem a mesma configuração, enquanto regras de domínio não
dependem do AWS SDK nem de um provedor comercial.

## Estágios privados

O bucket inteiro permanece privado e com bloqueio de acesso público. Os prefixes representam
estado de workflow, não permissões S3:

```text
quarantine/originals/{uuid}
private/processed/{uuid}
public/approved/{uuid}
```

Todo upload nasce em `quarantine/originals`. A aplicação gera o UUID e ignora o nome original
para a composição da chave. Referências com traversal, prefixo desconhecido, UUID inválido ou
estágio divergente são rejeitadas antes de qualquer chamada S3.

A promoção copia somente a chave validada para o próximo prefixo e depois remove exatamente a
origem. São aceitas as transições quarentena para privado/aprovado e privado para aprovado; uma
transição regressiva é inválida.

## Leitura e configuração

Não existe URL pública permanente no contrato. A leitura autorizada usa `GetObject` assinado,
após confirmar a existência do objeto, por no máximo 300 segundos. O ambiente local usa path
style (`S3_FORCE_PATH_STYLE=true`) com RustFS; provedores gerenciados podem selecionar virtual
host style com `false` sem mudar consumidores.

O teste integrado aceita apenas endpoint em loopback e credenciais `TEST_S3_*`, com os valores
locais fictícios como fallback. Assim, a suíte não pode apontar acidentalmente para um bucket de
produção.
