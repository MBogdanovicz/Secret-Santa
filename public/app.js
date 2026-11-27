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
async function participantView(token) {
  $app.innerHTML = `<p class="muted center">Carregando…</p>`;
  let data;
  try {
    data = await api("p/" + encodeURIComponent(token));
  } catch (e) {
    if (e.status === 404) storage("myToken", null);
    $app.innerHTML = `
      <div class="header"><div class="emoji">😕</div><h1>Link inválido</h1></div>
      <div class="card center"><p>${esc(e.message)}</p><p class="muted small">Peça um novo link ao organizador.</p></div>`;
    return;
  }
  document.title = data.title;
  const revealedKey = "revealed:" + token;
  const revealed = storage(revealedKey) === "1";

  $app.innerHTML = `
    <div class="header"><div class="emoji">🎄</div><h1>${esc(data.title)}</h1>
      <p class="muted">Olá, <strong>${esc(data.me.name)}</strong>!</p></div>
    <div id="matchBox"></div>
    <div class="card stack">
      <h2>🎁 Minhas sugestões de presente</h2>
      <p class="muted small">Quem tirou você vai ver o que você escrever aqui. Dê dicas de tamanho, cores, gostos…</p>
      <textarea id="mySug" maxlength="2000" placeholder="Ex.: livro de suspense, camiseta M, chocolate amargo…">${esc(data.me.suggestions)}</textarea>
      <button id="saveSug" class="block">Salvar sugestões</button>
    </div>`;

  const matchBox = document.getElementById("matchBox");
  function renderMatch(show) {
    if (!data.drawn || !data.match) {
      matchBox.innerHTML = `<div class="card center"><div style="font-size:3rem">⏳</div>
        <p>O sorteio ainda não foi feito.<br><span class="muted small">Volte neste mesmo link mais tarde. Enquanto isso, já pode deixar suas sugestões abaixo.</span></p></div>`;
      return;
    }
    if (!show) {
      matchBox.innerHTML = `<div class="card reveal" id="revealBtn" role="button" tabindex="0">
        <div class="gift">🎁</div><h2 style="margin-top:12px">Toque para revelar seu amigo secreto</h2>
        <p class="muted small">Confira se ninguém está olhando! 🤫</p></div>`;
      const btn = document.getElementById("revealBtn");
      const go = () => {
        btn.classList.add("shake");
        setTimeout(() => { storage(revealedKey, "1"); renderMatch(true); }, 650);
      };
      btn.addEventListener("click", go);
      btn.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && go());
      return;
    }
    const sug = data.match.suggestions.trim();
    matchBox.innerHTML = `<div class="card center">
        <p class="muted" style="margin:0">Você tirou</p>
        <div class="match-name">${esc(data.match.name)}</div>
        <p class="muted small" style="margin:0">Guarde segredo! 🤐</p>
      </div>
      <div class="card stack">
        <h2>💡 Sugestões de ${esc(data.match.name)}</h2>
        ${sug ? `<div class="suggestions">${esc(sug)}</div>` : `<p class="muted">${esc(data.match.name)} ainda não escreveu sugestões. Volte mais tarde!</p>`}
        <div class="actions"><button class="secondary" id="refresh">Atualizar</button>
        <button class="secondary" id="hide">Esconder nome</button></div>
      </div>`;
    document.getElementById("refresh").onclick = () => participantView(token);
    document.getElementById("hide").onclick = () => { storage(revealedKey, null); renderMatch(false); };
  }
  renderMatch(revealed);

  const saveBtn = document.getElementById("saveSug");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await api(`p/${encodeURIComponent(token)}/suggestions`, { method: "PUT", body: { text: document.getElementById("mySug").value } });
      toast("Sugestões salvas! ✅");
    } catch (e) {
      toast(e.message);
    } finally {
      saveBtn.disabled = false;
    }
  };
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

  const item = (p) => {
    const link = participantLink(p.token);
    const msg = `Oi, ${p.name}! 🎁 Este é o seu link do ${s.title}. Abra para descobrir quem você tirou e deixar suas sugestões de presente (não compartilhe com ninguém!):\n${link}`;
    return `<li>
      <div class="person"><span class="name">${esc(p.name)}</span>
        <span>${p.seen ? `<span class="badge ok">abriu o link</span>` : `<span class="badge">não abriu</span>`}
        ${p.hasSuggestions ? `<span class="badge ok">deu sugestões</span>` : ""}</span></div>
      <div class="actions">
        ${s.drawn
          ? `<a class="btn whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Enviar no WhatsApp</a>
             <button class="secondary" data-copy="${esc(msg)}">Copiar mensagem</button>`
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
           <p class="small muted">Cadastre todos e depois sorteie. Ninguém tira a si mesmo. Depois do sorteio aparecem os botões para enviar cada link pelo WhatsApp.</p>
           <button class="block" id="draw" ${n < 3 ? "disabled" : ""}>🎲 Sortear agora</button>
           ${n < 3 ? `<p class="small muted center">Mínimo de 3 participantes.</p>` : ""}`}
    </div>

    <div class="card stack">
      <h2>Nome do evento</h2>
      <form class="row" id="titleForm"><input id="title" value="${esc(s.title)}" maxlength="80"><button class="secondary">Salvar</button></form>
    </div>`;

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
  document.getElementById("titleForm").onsubmit = (e) => {
    e.preventDefault();
    run(() => api("admin/title", { method: "PUT", body: { title: document.getElementById("title").value }, admin: true }), "Nome salvo!");
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
