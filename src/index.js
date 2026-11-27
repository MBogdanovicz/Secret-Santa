// Amigo Secreto: API (Cloudflare Worker + KV)
// Chaves no KV:
//   "event"      -> { title, participants: [{id, name, token}], assignments: {giverId: receiverId} | null, drawnAt }
//   "sug:<id>"   -> texto das sugestões de presente do participante
//   "seen:<id>"  -> data em que o participante abriu o link pela primeira vez

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const err = (msg, status = 400) => json({ error: msg }, status);

function randomToken(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function getEvent(env) {
  return (
    (await env.DB.get("event", "json")) || {
      title: "Amigo Secreto da Família",
      participants: [],
      assignments: null,
      drawnAt: null,
    }
  );
}

const eventInfo = (ev) => ({
  title: ev.title,
  when: ev.when || "",
  date: ev.date || "",
  place: ev.place || "",
  budget: ev.budget || "",
});

// Dados ligados ao sorteio: compra do presente e perguntas anônimas (do "giver" para o amigo dele).
const DRAW_KEYS = ["bought:", "q:", "a:"];
const ALL_KEYS = ["sug:", "seen:", ...DRAW_KEYS];
const clearKeys = (env, ids, prefixes) =>
  Promise.all(ids.flatMap((id) => prefixes.map((k) => env.DB.delete(k + id))));
const getList = async (env, key) => (await env.DB.get(key, "json")) || [];
const getMap = async (env, key) => (await env.DB.get(key, "json")) || {};

const saveEvent = (env, ev) => env.DB.put("event", JSON.stringify(ev));

// Sorteio: permutação aleatória em que ninguém tira a si mesmo nem o próprio par (casal).
// Usa amostragem por rejeição (distribuição uniforme entre os sorteios válidos).
function randInt(n) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

function draw(participants) {
  const ids = participants.map((p) => p.id);
  const partner = Object.fromEntries(participants.map((p) => [p.id, p.partnerId || null]));
  for (let attempt = 0; attempt < 20000; attempt++) {
    const perm = ids.slice();
    for (let i = perm.length - 1; i > 0; i--) {
      const r = randInt(i + 1);
      [perm[i], perm[r]] = [perm[r], perm[i]];
    }
    if (ids.every((id, i) => perm[i] !== id && perm[i] !== partner[id])) {
      return Object.fromEntries(ids.map((id, i) => [id, perm[i]]));
    }
  }
  return null;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// O participante tem pergunta do amigo secreto dele ainda sem resposta?
async function hasPendingQuestion(env, ev, id) {
  if (!ev.assignments) return false;
  const giver = Object.keys(ev.assignments).find((g) => ev.assignments[g] === id);
  if (!giver) return false;
  const [qs, ans] = await Promise.all([getList(env, "q:" + giver), getMap(env, "a:" + giver)]);
  return qs.some((q) => !(ans[q.id] || "").trim());
}

async function handleAdmin(request, env, parts) {
  const auth = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_PASSWORD) return err("ADMIN_PASSWORD não configurada no servidor.", 500);
  if (!safeEqual(auth, env.ADMIN_PASSWORD)) return err("Senha incorreta.", 401);

  const ev = await getEvent(env);
  const method = request.method;
  const [resource, id] = parts;

  if (resource === "state" && method === "GET") {
    const participants = await Promise.all(
      ev.participants.map(async (p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        partnerId: p.partnerId || null,
        seen: !!(await env.DB.get("seen:" + p.id)),
        hasSuggestions: !!((await env.DB.get("sug:" + p.id)) || "").trim(),
        bought: !!(await env.DB.get("bought:" + p.id)),
        pendingQuestion: await hasPendingQuestion(env, ev, p.id),
      }))
    );
    // As duplas sorteadas NÃO são enviadas ao admin (ele também participa).
    return json({ ...eventInfo(ev), drawn: !!ev.assignments, drawnAt: ev.drawnAt, participants });
  }

  if (resource === "info" && method === "PUT") {
    const body = await readBody(request);
    const clean = (v, max) => String(v || "").trim().slice(0, max);
    const title = clean(body.title, 80);
    if (!title) return err("Informe o nome do evento.");
    ev.title = title;
    ev.when = clean(body.when, 80);
    ev.place = clean(body.place, 120);
    ev.budget = clean(body.budget, 40);
    ev.date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || "") ? body.date : "";
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "participants" && method === "POST") {
    if (ev.assignments) return err("O sorteio já foi feito. Desfaça o sorteio para alterar os participantes.");
    const { name } = await readBody(request);
    const clean = String(name || "").trim().slice(0, 60);
    if (!clean) return err("Informe um nome.");
    if (ev.participants.some((p) => p.name.toLowerCase() === clean.toLowerCase()))
      return err("Já existe um participante com esse nome.");
    ev.participants.push({ id: randomToken(6), name: clean, token: randomToken(16) });
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "participants" && method === "DELETE" && id) {
    if (ev.assignments) return err("O sorteio já foi feito. Desfaça o sorteio para alterar os participantes.");
    ev.participants = ev.participants.filter((p) => p.id !== id);
    ev.participants.forEach((p) => p.partnerId === id && (p.partnerId = null));
    await clearKeys(env, [id], ALL_KEYS);
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "participants" && method === "PUT" && id && parts[2] === "partner") {
    if (ev.assignments) return err("O sorteio já foi feito. Desfaça o sorteio para alterar os casais.");
    const { partnerId } = await readBody(request);
    const me = ev.participants.find((p) => p.id === id);
    const other = partnerId ? ev.participants.find((p) => p.id === partnerId) : null;
    if (!me || (partnerId && (!other || other.id === me.id))) return err("Participante não encontrado.", 404);
    // Desfaz pares antigos dos dois lados e cria o novo par (simétrico).
    ev.participants.forEach((p) => {
      if (p.partnerId === me.id || (other && p.partnerId === other.id)) p.partnerId = null;
    });
    me.partnerId = other ? other.id : null;
    if (other) other.partnerId = me.id;
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "draw" && method === "POST") {
    if (ev.participants.length < 3) return err("São necessários pelo menos 3 participantes.");
    const assignments = draw(ev.participants);
    if (!assignments) return err("Não foi possível sortear com essas restrições de casais. Adicione mais participantes ou revise os casais.");
    await clearKeys(env, ev.participants.map((p) => p.id), DRAW_KEYS);
    ev.assignments = assignments;
    ev.drawnAt = new Date().toISOString();
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "draw" && method === "DELETE") {
    await clearKeys(env, ev.participants.map((p) => p.id), DRAW_KEYS);
    ev.assignments = null;
    ev.drawnAt = null;
    await saveEvent(env, ev);
    return json({ ok: true });
  }

  if (resource === "all" && method === "DELETE") {
    await clearKeys(env, ev.participants.map((p) => p.id), ALL_KEYS);
    await env.DB.delete("event");
    return json({ ok: true });
  }

  return err("Rota não encontrada.", 404);
}

async function handleParticipant(request, env, token, sub, subId) {
  const ev = await getEvent(env);
  const me = ev.participants.find((p) => safeEqual(p.token, token));
  if (!me) return err("Link inválido.", 404);
  const method = request.method;
  const matchId = ev.assignments ? ev.assignments[me.id] : null;
  const giverId = ev.assignments ? Object.keys(ev.assignments).find((g) => ev.assignments[g] === me.id) : null;

  if (sub === "bought" && method === "PUT") {
    if (!matchId) return err("O sorteio ainda não foi feito.");
    const { bought } = await readBody(request);
    if (bought) await env.DB.put("bought:" + me.id, new Date().toISOString());
    else await env.DB.delete("bought:" + me.id);
    return json({ ok: true });
  }

  // Pergunta anônima para o amigo que eu tirei.
  if (sub === "questions" && method === "POST") {
    if (!matchId) return err("O sorteio ainda não foi feito.");
    const { text } = await readBody(request);
    const clean = String(text || "").trim().slice(0, 300);
    if (!clean) return err("Escreva a pergunta.");
    const qs = await getList(env, "q:" + me.id);
    if (qs.length >= 10) return err("Você já fez 10 perguntas, o limite.");
    qs.push({ id: randomToken(6), text: clean, at: new Date().toISOString() });
    await env.DB.put("q:" + me.id, JSON.stringify(qs));
    return json({ ok: true });
  }

  if (sub === "questions" && method === "DELETE" && subId) {
    const qs = (await getList(env, "q:" + me.id)).filter((q) => q.id !== subId);
    await env.DB.put("q:" + me.id, JSON.stringify(qs));
    return json({ ok: true });
  }

  // Resposta a uma pergunta feita pelo meu amigo secreto (quem me tirou).
  if (sub === "answers" && method === "PUT" && subId) {
    if (!giverId) return err("O sorteio ainda não foi feito.");
    const qs = await getList(env, "q:" + giverId);
    if (!qs.some((q) => q.id === subId)) return err("Pergunta não encontrada.", 404);
    const { text } = await readBody(request);
    const ans = await getMap(env, "a:" + giverId);
    ans[subId] = String(text || "").trim().slice(0, 1000);
    await env.DB.put("a:" + giverId, JSON.stringify(ans));
    return json({ ok: true });
  }

  if (sub === "suggestions" && request.method === "PUT") {
    const { text } = await readBody(request);
    await env.DB.put("sug:" + me.id, String(text || "").slice(0, 2000));
    return json({ ok: true });
  }

  if (!sub && request.method === "GET") {
    if (!(await env.DB.get("seen:" + me.id))) await env.DB.put("seen:" + me.id, new Date().toISOString());
    let match = null;
    if (ev.assignments && ev.assignments[me.id]) {
      const m = ev.participants.find((p) => p.id === ev.assignments[me.id]);
      if (m) {
        const [qs, ans] = await Promise.all([getList(env, "q:" + me.id), getMap(env, "a:" + me.id)]);
        match = {
          name: m.name,
          suggestions: (await env.DB.get("sug:" + m.id)) || "",
          questions: qs.map((q) => ({ id: q.id, text: q.text, answer: ans[q.id] || "" })),
        };
      }
    }
    let questionsToMe = [];
    if (giverId) {
      const [qs, ans] = await Promise.all([getList(env, "q:" + giverId), getMap(env, "a:" + giverId)]);
      questionsToMe = qs.map((q) => ({ id: q.id, text: q.text, answer: ans[q.id] || "" }));
    }
    // Sugestões de todos os outros participantes (a lista inclui todo mundo, então não revela o sorteio).
    const everyone = await Promise.all(
      ev.participants
        .filter((p) => p.id !== me.id)
        .map(async (p) => ({
          name: p.name,
          suggestions: (await env.DB.get("sug:" + p.id)) || "",
          bought: !!(ev.assignments && (await env.DB.get("bought:" + p.id))),
        }))
    );
    everyone.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return json({
      ...eventInfo(ev),
      everyone,
      me: { name: me.name, suggestions: (await env.DB.get("sug:" + me.id)) || "" },
      drawn: !!ev.assignments,
      match,
      bought: !!(await env.DB.get("bought:" + me.id)),
      questionsToMe,
    });
  }

  return err("Rota não encontrada.", 404);
}

// Prévia do link no WhatsApp: injeta título e imagem (URL absoluta) no index.html.
async function serveIndex(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const origin = new URL(request.url).origin;
  const ev = await getEvent(env);
  const title = ev.title;
  const desc = "Toque no link para descobrir quem você tirou e deixar suas sugestões de presente. 🎁";
  const set = (attr) => ({ element: (el) => el.setAttribute("content", attr) });
  return new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(title) })
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[name="description"]', set(desc))
    .on('meta[property="og:image"]', set(origin + "/og.jpg"))
    .on('meta[property="og:url"]', set(origin + "/"))
    .transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        try {
          return await serveIndex(request, env);
        } catch {
          return env.ASSETS.fetch(request);
        }
      }
      return env.ASSETS.fetch(request);
    }
    const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent);
    try {
      if (parts[0] === "admin") return await handleAdmin(request, env, parts.slice(1));
      if (parts[0] === "p" && parts[1]) return await handleParticipant(request, env, parts[1], parts[2], parts[3]);
      return err("Rota não encontrada.", 404);
    } catch (e) {
      return err("Erro interno: " + e.message, 500);
    }
  },
};
