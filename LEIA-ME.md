# Agenda Great

Agenda da sala de reunião. Segunda a sábado, das 9h às 23h59. A grade ocupa a largura disponível e mostra todos os horários, com rolagem pela página. Nome, setor e horário de término são obrigatórios. Dois agendamentos nunca ocupam o mesmo horário.

## Arquivos
- `index.html`: estrutura da página
- `style.css`: visual (as cores ficam todas no topo do arquivo)
- `assets/great-logo.png`: logo da Great Assessoria com fundo transparente, extraído do material da marca
- `script.js`: funcionamento da agenda
- `config.js`: onde você cola os dados do Supabase
- `supabase.sql`: cria a tabela e as regras no Supabase
- `supabase-edit-booking.sql`: habilita edição em um banco que já possui a agenda

## 1. Conectar o Supabase
1. Crie um projeto em supabase.com.
2. Abra **SQL Editor > New query**, cole todo o conteúdo de `supabase.sql` e clique em **Run**.
3. Abra **Project Settings > API** e copie o **Project URL** e a **anon public key**.
4. Cole os dois em `config.js`.

Enquanto o `config.js` estiver vazio, a agenda funciona em **modo de teste**: as reservas ficam salvas só no navegador de quem está usando.

## Editar agendamentos
Clique no lápis no bloco de uma reunião ou em **Editar agendamento** nos detalhes. O formulário permite alterar data, início, término, responsável, setor, assunto e participantes. Informe o nome de quem marcou ou de um participante atual para autorizar e clique em **Salvar alterações**. A autorização segue a regra de cancelamento existente, por nome, sem autenticação de identidade.

Se o banco já estava configurado, execute **somente** o conteúdo de `supabase-edit-booking.sql` no SQL Editor do mesmo projeto. Novas instalações com `supabase.sql` já incluem essa função. Nenhuma reserva existente é apagada. As alterações são feitas na mesma reserva, persistem no Supabase e são distribuídas pela assinatura Realtime já usada pela agenda. Conflitos de horário mantêm a reserva original. Reuniões encerradas não podem ser editadas.

## Verificação
Execute `node --test tests/bookings.test.cjs` para conferir persistência local, autorização, conflitos e integração da chamada de edição ao Supabase.

## 2. Publicar na Vercel
1. Suba a pasta para um repositório no GitHub (ou arraste a pasta em vercel.com/new).
2. Em **Framework Preset**, escolha **Other**. Não precisa de comando de build.
3. Clique em **Deploy**.

## Trocar as cores
No topo do `style.css` ficam `--accent` (vermelho principal) e as cores de cada setor (`--op`, `--com`, `--org`, cada uma com a versão `-soft` para o fundo). A paleta usa apenas as cores do documento da marca: vermelho `#FE0100`, preto `#000000`, branco `#FFFFFF` e cinza `#EEEEEE`. A base permanece clara, inclusive quando o dispositivo usa modo escuro. Operacional usa vermelho; Comercial usa preto; Orgânico usa preto com marcador vazado e borda tracejada nas reservas.

## Mudar horários
No topo do `script.js`: `START_HOUR` (primeiro horário), `END_TIME` (limite de término) e `STEP_MIN` (de quantos em quantos minutos). O último horário começa às 23h30 e pode terminar às 23h59. Se mudar esses valores, ajuste também a restrição `bookings_horario_check` no `supabase.sql`.
