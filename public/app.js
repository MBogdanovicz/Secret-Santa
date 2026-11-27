"use strict";

const $app = document.getElementById("app");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  return null;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

async function api(path, { method = "GET", body, admin } = {}) {
  const headers = { "content-type": "application/json" };
  if (admin) headers.authorization = "Bearer " + (storage("adminPass") || "");
  const r = await fetch("/api/" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || "Erro de conexão.");
    e.status = r.status;
    throw e;
  }
  return data;
}

const participantLink = (token) => `${location.origin}/#p=${token}`;

// ---------- Rotas ----------
function route() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("p")) {
    storage("myToken", hash.get("p"));
    return participantView(hash.get("p"));
  }
  if (location.hash === "#admin") return adminView();
  // App instalado (abre em "/"): volta para o último link aberto neste aparelho.
  const saved = storage("myToken");
  if (saved) {
    history.replaceState(null, "", "#p=" + saved);
    return participantView(saved);
  }
  homeView();
}
window.addEventListener("hashchange", route);

function homeView() {
  $app.innerHTML = `
    <div class="header"><div class="emoji">🎁</div><h1>Amigo Secreto</h1></div>
    <div class="card center">
      <p>Para descobrir quem você tirou, abra o link individual que você recebeu pelo WhatsApp.</p>
    </div>
    <p class="center small"><a class="muted" href="#admin">Área do organizador</a></p>`;
}

// ---------- Participante ----------
function infoBlock(d) {
  const rows = [
    ["📅", "Quando", d.when],
    ["📍", "Onde", d.place],
    ["💰", "Valor do presente", d.budget],
  ].filter((r) => r[2]);
  if (!rows.length) return "";
  return `<div class="card"><dl class="info">${rows
    .map(([icon, label, value]) => `<div><dt>${icon}</dt><dd><strong>${label}</strong>${esc(value)}</dd></div>`)
    .join("")}</dl></div>`;
}

function everyoneBlock(list) {
  if (!list.length) return "";
  return `<div class="card stack">
    <h2>📝 O que cada um gostaria de ganhar</h2>
    <p class="muted">Ideias de toda a família, para ajudar também em outros presentes.</p>
    <ul class="list everyone">${list.map((p) => `<li><strong>${esc(p.name)}</strong>
      ${p.suggestions.trim() ? `<div class="suggestions">${esc(p.suggestions.trim())}</div>`
                             : `<div class="muted">Ainda não escreveu.</div>`}</li>`).join("")}</ul>
  </div>`;
}

async function participantView(token) {
  $app.innerHTML = `<p class="muted center">Carregando…</p>`;
  let data;
  try {
    data = await api("p/" + encodeURIComponent(token));
  } catch (e) {
    if (e.status === 404) storage("myToken", null);
    $app.innerHTML = `
      <div class="header"><div class="emoji">😕</div><h1>Link inválido</h1></div>
      <div class="card center"><p>${esc(e.message)}</p><p class="muted">Peça um novo link ao organizador.</p></div>`;
    return;
  }
  document.title = data.title;
  const revealedKey = "revealed:" + token;

  $app.innerHTML = `
    <div class="header"><div class="emoji">🎄</div><h1>${esc(data.title)}</h1>
      <p>Olá, <strong>${esc(data.me.name)}</strong>!</p></div>
    <div id="matchBox"></div>
    ${infoBlock(data)}
    <div class="card stack">
      <h2>🎁 O que eu gostaria de ganhar</h2>
      <p class="muted">Escreva aqui suas ideias de presente. Quem tirou você vai ler. Fica salvo sozinho.</p>
      <textarea id="mySug" maxlength="2000" placeholder="Exemplo: livro, camisa tamanho M, chocolate…">${esc(data.me.suggestions)}</textarea>
      <div id="saveStatus" class="save-status" role="status" aria-live="polite"></div>
    </div>
    ${everyoneBlock(data.everyone || [])}`;

  const matchBox = document.getElementById("matchBox");
  function renderMatch(show) {
    if (!data.drawn || !data.match) {
      matchBox.innerHTML = `<div class="card center"><div style="font-size:3rem">⏳</div>
        <p><strong>O sorteio ainda não foi feito.</strong></p>
        <p class="muted">Abra este mesmo link de novo mais tarde. Enquanto isso, já pode escrever o que gostaria de ganhar aqui embaixo.</p></div>`;
      return;
    }
    if (!show) {
      matchBox.innerHTML = `<button class="card reveal block" id="revealBtn" style="color:inherit;background:var(--card)">
        <div><div class="gift">🎁</div><h2 style="margin:12px 0 4px">Toque aqui para ver quem você tirou</h2>
        <p class="muted" style="margin:0">Confira se ninguém está olhando! 🤫</p></div></button>`;
      const btn = document.getElementById("revealBtn");
      btn.onclick = () => {
        btn.classList.add("shake");
        setTimeout(() => { storage(revealedKey, "1"); renderMatch(true); }, 650);
      };
      return;
    }
    const sug = data.match.suggestions.trim();
    matchBox.innerHTML = `<div class="card center">
        <p class="muted" style="margin:0">Você tirou</p>
        <div class="match-name">${esc(data.match.name)}</div>
        <p class="muted" style="margin:0">Guarde segredo! 🤐</p>
      </div>
      <div class="card stack">
        <h2>💡 O que ${esc(data.match.name)} gostaria de ganhar</h2>
        ${sug ? `<div class="suggestions">${esc(sug)}</div>`
              : `<p class="muted">${esc(data.match.name)} ainda não escreveu nada. Abra este link de novo outro dia para ver.</p>`}
      </div>`;
  }
  renderMatch(storage(revealedKey) === "1");

  // Salvamento automático das sugestões.
  const ta = document.getElementById("mySug");
  const status = document.getElementById("saveStatus");
  let lastSaved = data.me.suggestions;
  let timer;
  const setStatus = (text, cls = "") => { status.textContent = text; status.className = "save-status " + cls; };
  async function save(keepalive = false) {
    clearTimeout(timer);
    const text = ta.value;
    if (text === lastSaved) return;
    setStatus("Salvando…");
    try {
      if (keepalive) {
        fetch(`/api/p/${encodeURIComponent(token)}/suggestions`, {
          method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
        });
        lastSaved = text;
        return;
      }
      await api(`p/${encodeURIComponent(token)}/suggestions`, { method: "PUT", body: { text } });
      lastSaved = text;
      setStatus(ta.value === text ? "✅ Salvo" : "", "ok");
    } catch {
      setStatus("⚠️ Não foi possível salvar. Confira a internet e tente de novo.", "err");
    }
  }
  ta.addEventListener("input", () => { setStatus(""); clearTimeout(timer); timer = setTimeout(save, 1200); });
  ta.addEventListener("blur", () => save());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && save(true), { once: false });
}

// ---------- Admin ----------
function adminLogin(msg) {
  $app.innerHTML = `
    <div class="header"><div class="emoji">🔐</div><h1>Área do organizador</h1></div>
    <form class="card stack" id="loginForm">
      <label for="pass">Senha de administrador</label>
      <input id="pass" type="password" autocomplete="current-password" required>
      ${msg ? `<p class="error small">${esc(msg)}</p>` : ""}
      <button class="block">Entrar</button>
    </form>`;
  document.getElementById("loginForm").onsubmit = (e) => {
    e.preventDefault();
    storage("adminPass", document.getElementById("pass").value);
    adminView();
  };
}

async function adminView() {
  if (!storage("adminPass")) return adminLogin();
  let s;
  try {
    s = await api("admin/state", { admin: true });
  } catch (e) {
    if (e.status === 401) { storage("adminPass", null); return adminLogin(e.message); }
    $app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
    return;
  }
  document.title = "Organizador · " + s.title;
  const n = s.participants.length;
  const seenCount = s.participants.filter((p) => p.seen).length;

  const byId = Object.fromEntries(s.participants.map((p) => [p.id, p]));
  const partnerSelect = (p) => `
      <label class="partner small">❤️ Casal com
        <select data-partner="${esc(p.id)}">
          <option value="">ninguém</option>
          ${s.participants.filter((o) => o.id !== p.id).map((o) =>
            `<option value="${esc(o.id)}" ${p.partnerId === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
        </select></label>`;
  const details = [s.when && `📅 ${s.when}`, s.place && `📍 ${s.place}`, s.budget && `💰 Valor do presente: ${s.budget}`]
    .filter(Boolean).join("\n");
  const wa = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
  const item = (p) => {
    const link = participantLink(p.token);
    const msg = `Oi, ${p.name}! 🎁\nEste é o seu link do *${s.title}*. Toque nele para descobrir quem você tirou e escrever o que gostaria de ganhar.\n${details ? details + "\n" : ""}\nÉ só seu, não mostre para ninguém! 🤫\n${link}`;
    const reminder = !p.seen
      ? `Oi, ${p.name}! 😊 Lembrete do *${s.title}*: você ainda não abriu o seu link. Toque aqui para descobrir quem você tirou:\n${link}`
      : !p.hasSuggestions
      ? `Oi, ${p.name}! 😊 Lembrete do *${s.title}*: que tal escrever o que você gostaria de ganhar? Ajuda muito quem tirou você! Toque aqui:\n${link}`
      : "";
    return `<li>
      <div class="person"><span class="name">${esc(p.name)}</span>
        <span>${p.seen ? `<span class="badge ok">abriu o link</span>` : `<span class="badge">não abriu</span>`}
        ${p.hasSuggestions ? `<span class="badge ok">deu sugestões</span>` : ""}</span></div>
      ${s.drawn
        ? (p.partnerId && byId[p.partnerId] ? `<div class="muted small">❤️ casal com ${esc(byId[p.partnerId].name)}</div>` : "")
        : partnerSelect(p)}
      <div class="actions">
        ${s.drawn
          ? `<a class="btn whatsapp" target="_blank" rel="noopener" href="${wa(msg)}">Enviar no WhatsApp</a>
             <button class="secondary" data-copy="${esc(msg)}">Copiar mensagem</button>
             ${reminder ? `<a class="btn secondary" target="_blank" rel="noopener" href="${wa(reminder)}" style="border:1px solid var(--border);background:transparent;color:var(--text)">🔔 Mandar lembrete</a>` : ""}`
          : `<button class="secondary" data-copy="${esc(link)}">Copiar link</button>
             <button class="danger" data-del="${esc(p.id)}">Remover</button>`}
      </div></li>`;
  };

  $app.innerHTML = `
    <div class="header"><div class="emoji">🎅</div><h1>${esc(s.title)}</h1>
      <p class="muted small">Área do organizador · <a href="#" id="logout" class="muted">sair</a></p></div>

    ${s.drawn ? "" : `
    <form class="card stack" id="addForm">
      <h2>Adicionar participante</h2>
      <div class="row"><input id="newName" placeholder="Nome" maxlength="60" required autocomplete="off"><button>Adicionar</button></div>
    </form>`}

    <div class="card">
      <h2>Participantes (${n})</h2>
      ${n ? `<ul class="list">${s.participants.map(item).join("")}</ul>` : `<p class="muted">Nenhum participante ainda.</p>`}
    </div>

    <div class="card stack">
      ${s.drawn
        ? `<h2>✅ Sorteio realizado</h2>
           <p class="small muted">Feito em ${new Date(s.drawnAt).toLocaleString("pt-BR")}. ${seenCount} de ${n} já abriram o link.
           O resultado fica em segredo, nem o organizador consegue ver quem tirou quem.</p>
           <button class="secondary block" id="redraw">Refazer sorteio</button>
           <button class="danger block" id="undo">Desfazer sorteio (para editar participantes)</button>`
        : `<h2>Sorteio</h2>
           <p class="small muted">Cadastre todos e depois sorteie. Ninguém tira a si mesmo nem o próprio par (marque os casais em “Casal com”). Depois do sorteio aparecem os botões para enviar cada link pelo WhatsApp.</p>
           <button class="block" id="draw" ${n < 3 ? "disabled" : ""}>🎲 Sortear agora</button>
           ${n < 3 ? `<p class="small muted center">Mínimo de 3 participantes.</p>` : ""}`}
    </div>

    <form class="card stack" id="infoForm">
      <h2>Informações do evento</h2>
      <p class="small muted">Aparecem na página de cada participante e na mensagem do WhatsApp. Deixe em branco o que não quiser mostrar.</p>
      <div><label class="field" for="title">Nome do evento</label><input id="title" value="${esc(s.title)}" maxlength="80" required></div>
      <div><label class="field" for="when">📅 Quando</label><input id="when" value="${esc(s.when)}" maxlength="80" placeholder="Ex.: 24 de dezembro, às 20h"></div>
      <div><label class="field" for="place">📍 Onde</label><input id="place" value="${esc(s.place)}" maxlength="120" placeholder="Ex.: Casa da vó Maria"></div>
      <div><label class="field" for="budget">💰 Valor do presente</label><input id="budget" value="${esc(s.budget)}" maxlength="40" placeholder="Ex.: até R$ 100"></div>
      <button class="block">Salvar informações</button>
    </form>`;

  const run = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message); }
    adminView();
  };

  document.getElementById("logout").onclick = (e) => { e.preventDefault(); storage("adminPass", null); adminLogin(); };
  const addForm = document.getElementById("addForm");
  if (addForm) {
    addForm.onsubmit = (e) => {
      e.preventDefault();
      const name = document.getElementById("newName").value;
      run(() => api("admin/participants", { method: "POST", body: { name }, admin: true }), "Adicionado!").then(() =>
        document.getElementById("newName")?.focus()
      );
    };
  }
  document.getElementById("infoForm").onsubmit = (e) => {
    e.preventDefault();
    const v = (id) => document.getElementById(id).value;
    run(() => api("admin/info", { method: "PUT", body: { title: v("title"), when: v("when"), place: v("place"), budget: v("budget") }, admin: true }), "Informações salvas!");
  };
  $app.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => confirm("Remover este participante?") &&
      run(() => api("admin/participants/" + encodeURIComponent(b.dataset.del), { method: "DELETE", admin: true }));
  });
  $app.querySelectorAll("[data-copy]").forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copiado!"); }
      catch { prompt("Copie:", b.dataset.copy); }
    };
  });
  $app.querySelectorAll("[data-partner]").forEach((sel) => {
    sel.onchange = () =>
      run(() => api(`admin/participants/${encodeURIComponent(sel.dataset.partner)}/partner`,
        { method: "PUT", body: { partnerId: sel.value || null }, admin: true }), "Casal salvo!");
  });
  const drawBtn = document.getElementById("draw");
  if (drawBtn) drawBtn.onclick = () =>
    confirm(`Sortear entre ${n} participantes? Confira se todos foram cadastrados.`) &&
    run(() => api("admin/draw", { method: "POST", admin: true }), "Sorteio feito! 🎉");
  const redraw = document.getElementById("redraw");
  if (redraw) redraw.onclick = () =>
    confirm("Refazer o sorteio? Os links continuam os mesmos, mas quem já viu o resultado vai ter um amigo diferente.") &&
    run(() => api("admin/draw", { method: "POST", admin: true }), "Novo sorteio feito!");
  const undo = document.getElementById("undo");
  if (undo) undo.onclick = () =>
    confirm("Desfazer o sorteio? Os links continuam valendo, mas mostrarão “sorteio ainda não feito”.") &&
    run(() => api("admin/draw", { method: "DELETE", admin: true }), "Sorteio desfeito.");
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
