# Meu Financeiro IA — MVP Android

Aplicativo inicial para registrar receitas e despesas em banco SQLite local. **Ainda não possui IA, integração bancária, importação de extratos, backups ou autenticação.** Não é um produto pronto para armazenar dados financeiros sensíveis sem proteções adicionais.

## Como executar no Windows

1. Instale o Node.js LTS e o VS Code.
2. Extraia esta pasta e abra o terminal (PowerShell) dentro dela.
3. Execute `npm install`.
4. Execute `npx expo install --fix` para alinhar as dependências à versão do Expo instalada.
5. Execute `npx expo start`.
6. No Android, instale o Expo Go e escaneie o QR code. PC e celular devem estar na mesma rede. Se não conectar, tente `npx expo start --tunnel` (pode exigir pacote adicional).

## Funcionalidades
- Adicionar receita ou despesa com valor, descrição, categoria e data.
- Resumo do mês e saldo acumulado dos registros.
- Histórico e filtros de tipo.
- Excluir lançamento com toque longo e confirmação.
- Persistência local em SQLite.

## Observações
- O saldo é apenas a diferença entre receitas e despesas **cadastradas**. Não consulta seu banco.
- A exclusão é permanente. **Não há backup nesta versão.**
- Expo Go é para testes; gerar APK independente exige configurar build Android posteriormente.
- O código-fonte é seu para editar e expandir.
