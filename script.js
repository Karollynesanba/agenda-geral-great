// =========================================================
// Agenda Great — sala de reunião
// =========================================================

// ---- Configuração ----
const START_HOUR = 9;   // primeiro horário
const END_TIME = "23:59"; // limite para o término de uma reunião
const STEP_MIN = 30;    // precisão dos horários (de 30 em 30 min)
const SECTORS = {
  operacional: { label: "Operacional", cls: "sec-op" },
  comercial:   { label: "Comercial",   cls: "sec-com" },
  organico:    { label: "Orgânico",    cls: "sec-org" },
};
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// ---- Utilidades ----
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const hhmm = (t) => String(t).slice(0, 5); // "09:00:00" -> "09:00"
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function times() { const out = []; for (let m = START_HOUR * 60; m < toMin(END_TIME); m += STEP_MIN) out.push(toTime(m)); return out; }
function rangeTimes(start, end) { const out = []; for (let m = toMin(start); m < toMin(end); m += STEP_MIN) out.push(toTime(m)); return out; }
function isPast(date, time) { const [y, mo, d] = date.split("-").map(Number); const m = Math.min(toMin(time) + STEP_MIN, toMin(END_TIME)); return new Date(y, mo - 1, d, Math.floor(m / 60), m % 60) <= new Date(); }
function fmtDate(date) { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }); }
function fmtDur(min) { const h = Math.floor(min / 60), m = min % 60; return (h ? h + "h" : "") + (m ? (h ? pad(m) : m + " min") : ""); }
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
function setStatus(msg, err) { const s = $("status"); s.textContent = msg; s.classList.toggle("err", !!err); }
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

// =========================================================
// Armazenamento: Supabase (oficial) ou navegador (modo de teste)
// Cada reserva: { id, day, start_time, end_time, name, sector, topic, participants[] }
// =========================================================
function supabaseStore(url, key) {
  const sb = window.supabase.createClient(url, key);
  return {
    async list(from, to) {
      const { data, error } = await sb.from("bookings").select("*").gte("day", from).lte("day", to);
      if (error) throw error;
      return data.map((b) => ({ ...b, start_time: hhmm(b.start_time), end_time: hhmm(b.end_time) }));
    },
    async create(b) {
      const { error } = await sb.from("bookings").insert(b);
      if (!error) return "ok";
      // 23P01 = conflito de horário (bloqueado pelo próprio banco)
      return error.code === "23P01" ? "taken" : "error";
    },
    async cancel(id, name) {
      const { data, error } = await sb.rpc("cancel_booking", { p_id: id, p_name: name });
      if (error) return "error";
      return data ? "ok" : "denied";
    },
    subscribe(onChange) {
      sb.channel("bookings-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, onChange)
        .subscribe();
    },
  };
}

function localStore() {
  const KEY = "agenda-great-reservas";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const write = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {} };
  return {
    async list(from, to) { return read().filter((b) => b.day >= from && b.day <= to); },
    async create(b) {
      const all = read();
      const clash = all.some((x) => x.day === b.day && toMin(x.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(x.end_time));
      if (clash) return "taken";
      all.push({ ...b, id: String(Date.now()) + Math.random().toString(36).slice(2, 6) });
      write(all);
      return "ok";
    },
    async cancel(id, name) {
      const all = read();
      const b = all.find((x) => x.id === id);
      if (!b) return "ok";
      const allowed = [b.name, ...(b.participants || [])].some((n) => norm(n) === norm(name));
      if (!allowed) return "denied";
      write(all.filter((x) => x.id !== id));
      return "ok";
    },
    subscribe(onChange) { window.addEventListener("storage", (e) => { if (e.key === KEY) onChange(); }); },
  };
}

const cfg = window.AGENDA_CONFIG || {};
const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
const store = useSupabase ? supabaseStore(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : localStore();
$("demo").hidden = useSupabase;

// =========================================================
// Estado e renderização
// =========================================================
let weekStart = mondayOf(new Date());
let selectedDay = Math.min((new Date().getDay() + 6) % 7, 5);
let slots = {};   // "AAAA-MM-DD_HH:MM" -> reserva
let count = 0;
if (new Date().getDay() === 0) { weekStart = addDays(weekStart, 7); selectedDay = 0; } // domingo: abre a próxima semana

const weekDays = () => WEEKDAYS.map((_, i) => addDays(weekStart, i));
const key = (date, time) => date + "_" + time;

async function load() {
  const from = ymd(weekStart), to = ymd(addDays(weekStart, 5));
  try {
    const list = await store.list(from, to);
    const next = {};
    list.forEach((b) => rangeTimes(b.start_time, b.end_time).forEach((t) => { next[key(b.day, t)] = b; }));
    slots = next;
    count = list.length;
    setStatus(count
      ? count + (count === 1 ? " reunião nesta semana" : " reuniões nesta semana")
      : "Nenhuma reunião nesta semana ainda. Clique num horário para marcar a primeira.");
  } catch (e) {
    setStatus("Não foi possível carregar a agenda. Verifique a conexão e recarregue a página.", true);
  }
  render();
}

function slotButton(date, time) {
  const b = document.createElement("button");
  b.className = "slot";
  const bk = slots[key(date, time)];
  if (bk) {
    const sec = SECTORS[bk.sector] || SECTORS.operacional;
    b.classList.add("taken", sec.cls);
    if (isPast(date, toTime(toMin(bk.end_time) - STEP_MIN))) b.classList.add("past");
    if (time === bk.start_time) {
      b.innerHTML = '<span class="n">' + esc(bk.name) + '</span><span class="s">' + sec.label + " · até " + bk.end_time + "</span>";
    }
    b.setAttribute("aria-label", time + ": reunião de " + bk.name + ", " + sec.label + ", " + bk.start_time + " às " + bk.end_time);
    b.onclick = () => openDetails(bk);
  } else if (isPast(date, time)) {
    b.classList.add("past");
    b.disabled = true;
    b.setAttribute("aria-label", time + " encerrado");
  } else {
    b.classList.add("free");
    b.innerHTML = '<span class="plus">+ Agendar</span>';
    b.setAttribute("aria-label", "Agendar às " + time);
    b.onclick = () => openForm(date, time);
  }
  return b;
}

// a meia hora seguinte é da mesma reunião? (esconde a linha divisória)
function continues(date, time) {
  const a = slots[key(date, time)], b = slots[key(date, toTime(toMin(time) + STEP_MIN))];
  return a && b && a.id === b.id;
}

function render() {
  const days = weekDays();
  const todayStr = ymd(new Date());
  const f = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
  $("range").textContent = f(days[0]) + " – " + f(days[5]);

  // computador: semana inteira
  const tbl = $("week");
  tbl.innerHTML = "";
  const hr = tbl.createTHead().insertRow();
  const th0 = document.createElement("th"); th0.className = "time"; hr.appendChild(th0);
  days.forEach((d, i) => {
    const th = document.createElement("th");
    if (ymd(d) === todayStr) th.className = "today";
    th.innerHTML = WEEKDAYS[i] + '<span class="d">' + f(d) + "</span>";
    hr.appendChild(th);
  });
  const tb = tbl.createTBody();
  times().forEach((t) => {
    const tr = tb.insertRow();
    const tc = tr.insertCell(); tc.className = "time"; tc.textContent = t;
    days.forEach((d) => {
      const td = tr.insertCell();
      if (continues(ymd(d), t)) td.className = "cont";
      td.appendChild(slotButton(ymd(d), t));
    });
  });

  const endRow = tbl.createTFoot().insertRow();
  const endTime = endRow.insertCell(); endTime.className = "time"; endTime.textContent = END_TIME;
  const endLabel = endRow.insertCell(); endLabel.colSpan = days.length; endLabel.textContent = "Fim dos horários de reserva";

  // celular: um dia por vez
  const dz = $("days");
  dz.innerHTML = "";
  days.forEach((d, i) => {
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", String(i === selectedDay));
    b.innerHTML = WEEKDAYS[i] + "<b>" + d.getDate() + "</b>";
    b.onclick = () => { selectedDay = i; render(); };
    dz.appendChild(b);
  });
  const dl = $("daylist");
  dl.innerHTML = "";
  const sd = ymd(days[selectedDay]);
  times().forEach((t) => {
    const r = document.createElement("div");
    r.className = "row" + (continues(sd, t) ? " cont" : "");
    const tc = document.createElement("div"); tc.className = "time"; tc.textContent = t;
    r.append(tc, slotButton(sd, t));
    dl.appendChild(r);
  });
  const dayEnd = document.createElement("div"); dayEnd.className = "day-end";
  dayEnd.innerHTML = '<time>' + END_TIME + '</time><span>Fim dos horários de reserva</span>';
  dl.appendChild(dayEnd);
}

// =========================================================
// Janelas
// =========================================================
function openPanel(html) { $("panel").innerHTML = html; $("overlay").hidden = false; }
function closePanel() { $("overlay").hidden = true; $("panel").innerHTML = ""; }
$("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closePanel(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("overlay").hidden) closePanel(); });

function openForm(date, start) {
  // términos possíveis: até o limite do dia ou até a próxima reunião
  const ends = [];
  const endMinute = toMin(END_TIME);
  for (let m = Math.min(toMin(start) + STEP_MIN, endMinute); m <= endMinute; m = Math.min(m + STEP_MIN, endMinute)) {
    ends.push(toTime(m));
    if (m === endMinute || slots[key(date, toTime(m))]) break;
  }
  const people = [];

  openPanel(`
    <h2 id="ptitle">Agendar reunião</h2>
    <p class="when">${fmtDate(date)} · início ${start}</p>
    <form class="form" id="bform" novalidate>
      <label class="f" for="fname">Seu nome <span class="req">*</span>
        <input type="text" id="fname" maxlength="60" autocomplete="name">
      </label>
      <fieldset>
        <legend>Setor <span class="req">*</span></legend>
        <div class="sectors">
          ${Object.entries(SECTORS).map(([k, s]) =>
            `<label class="${s.cls}"><input type="radio" name="sector" value="${k}"><span>${s.label}</span></label>`).join("")}
        </div>
      </fieldset>
      <label class="f" for="fend">Até que horas? <span class="req">*</span>
        <select id="fend">
          <option value="">Escolha o horário de término</option>
          ${ends.map((t) => `<option value="${t}">${t} (${fmtDur(toMin(t) - toMin(start))})</option>`).join("")}
        </select>
      </label>
      <div class="f">
        <label for="fpeople">Participantes <span class="hint">· também podem cancelar a reunião</span></label>
        <div class="addrow">
          <input type="text" id="fpeople" maxlength="60" placeholder="Nome do participante">
          <button type="button" class="btn" id="fadd">Adicionar</button>
        </div>
        <div class="people" id="fchips"></div>
      </div>
      <label class="f" for="ftopic">Assunto <span class="hint">(opcional)</span>
        <input type="text" id="ftopic" maxlength="80">
      </label>
      <p class="ferr" id="ferr" hidden></p>
      <div class="actions">
        <button type="button" class="btn" id="fcancel">Voltar</button>
        <button type="submit" class="btn btn-primary" id="fsubmit">Confirmar agendamento</button>
      </div>
    </form>`);

  try { const last = localStorage.getItem("agenda-great-nome"); if (last) $("fname").value = last; } catch (e) {}
  $("fname").focus();
  $("fcancel").onclick = closePanel;

  const drawChips = () => {
    const box = $("fchips");
    box.innerHTML = "";
    people.forEach((n, i) => {
      const c = document.createElement("span"); c.className = "person"; c.textContent = n;
      const x = document.createElement("button"); x.type = "button"; x.textContent = "×";
      x.setAttribute("aria-label", "Remover " + n);
      x.onclick = () => { people.splice(i, 1); drawChips(); };
      c.appendChild(x); box.appendChild(c);
    });
  };
  const addPerson = () => {
    const v = $("fpeople").value.trim();
    if (v && !people.some((p) => norm(p) === norm(v))) { people.push(v); drawChips(); }
    $("fpeople").value = "";
    $("fpeople").focus();
  };
  $("fadd").onclick = addPerson;
  $("fpeople").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });

  $("bform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fname").value.trim();
    const secEl = document.querySelector('input[name="sector"]:checked');
    const end = $("fend").value;
    const err = $("ferr");
    const missing = [];
    if (!name) missing.push("seu nome");
    if (!secEl) missing.push("o setor");
    if (!end) missing.push("o horário de término");
    if (missing.length) {
      err.textContent = "Preencha " + missing.join(", ").replace(/, ([^,]*)$/, " e $1") + " para agendar.";
      err.hidden = false;
      return;
    }
    if ($("fpeople").value.trim()) addPerson();
    err.hidden = true;
    const btn = $("fsubmit");
    btn.disabled = true; btn.textContent = "Reservando…";

    const result = await store.create({
      day: date, start_time: start, end_time: end, name,
      sector: secEl.value, topic: $("ftopic").value.trim() || null, participants: people,
    });

    if (result === "ok") {
      try { localStorage.setItem("agenda-great-nome", name); } catch (e) {}
      closePanel();
      await load();
      setStatus("Reunião agendada: " + fmtDate(date) + ", " + start + " às " + end + ".");
    } else {
      btn.disabled = false; btn.textContent = "Confirmar agendamento";
      err.textContent = result === "taken"
        ? "Esse horário acabou de ser reservado por outra pessoa. Escolha outro horário."
        : "Não foi possível salvar. Verifique a conexão e tente de novo.";
      err.hidden = false;
      if (result === "taken") { load(); setTimeout(closePanel, 2500); }
    }
  });
}

function openDetails(bk) {
  const sec = SECTORS[bk.sector] || SECTORS.operacional;
  const people = bk.participants || [];
  const ended = isPast(bk.day, toTime(toMin(bk.end_time) - STEP_MIN));
  openPanel(`
    <h2 id="ptitle">Sala reservada</h2>
    <p class="when">${fmtDate(bk.day)} · ${bk.start_time}–${bk.end_time} (${fmtDur(toMin(bk.end_time) - toMin(bk.start_time))})</p>
    <dl>
      <dt>Marcado por</dt><dd>${esc(bk.name)}</dd>
      <dt>Setor</dt><dd class="${sec.cls}" style="color:var(--c)">${sec.label}</dd>
      <dt>Participantes</dt><dd><div class="people">${people.length ? people.map((p) => `<span class="person">${esc(p)}</span>`).join("") : "—"}</div></dd>
      <dt>Assunto</dt><dd>${bk.topic ? esc(bk.topic) : "—"}</dd>
    </dl>
    ${ended ? "" : `
    <div class="cancelbox">
      <label class="f" for="cname">Cancelar reunião <span class="hint">· digite seu nome (quem marcou ou participante)</span>
        <input type="text" id="cname" maxlength="60">
      </label>
      <p class="ferr" id="cerr" hidden></p>
    </div>`}
    <div class="actions">
      <button type="button" class="btn" id="dclose">Fechar</button>
      ${ended ? "" : '<button type="button" class="btn btn-danger" id="dcancel">Cancelar reunião</button>'}
    </div>`);

  $("dclose").onclick = closePanel;
  $("dclose").focus();
  if (ended) return;

  $("dcancel").onclick = async () => {
    const who = $("cname").value.trim();
    const err = $("cerr");
    if (!who) { err.textContent = "Digite seu nome para cancelar."; err.hidden = false; $("cname").focus(); return; }
    const btn = $("dcancel");
    btn.disabled = true;
    const r = await store.cancel(bk.id, who);
    if (r === "ok") {
      closePanel();
      await load();
      setStatus("Reunião cancelada. O horário está livre.");
    } else {
      btn.disabled = false;
      err.textContent = r === "denied"
        ? "Só quem marcou ou os participantes podem cancelar. Confira se o nome está igual ao da reserva."
        : "Não foi possível cancelar. Tente de novo.";
      err.hidden = false;
    }
  };
}

// =========================================================
// Navegação e início
// =========================================================
function goWeek(d) { weekStart = d; slots = {}; render(); setStatus("Carregando…"); load(); }
$("prev").onclick = () => goWeek(addDays(weekStart, -7));
$("next").onclick = () => goWeek(addDays(weekStart, 7));
$("today").onclick = () => {
  const now = new Date();
  if (now.getDay() === 0) { selectedDay = 0; goWeek(addDays(mondayOf(now), 7)); }
  else { selectedDay = (now.getDay() + 6) % 7; goWeek(mondayOf(now)); }
};

render();
load();
store.subscribe(() => load());            // atualiza ao vivo quando alguém agenda ou cancela
setInterval(render, 5 * 60 * 1000);       // marca como encerrados os horários que já passaram
