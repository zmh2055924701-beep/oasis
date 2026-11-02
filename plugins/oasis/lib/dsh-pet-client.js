// Oasis adapter for the installed dsh-pet renderer.
// We do NOT duplicate its window/animation code: Oasis controls the same live pet
// through the plugin's local, already-authenticated DSH route (/dsh-pet-7340).
// This keeps the pet's visual layer reusable while all decisions stay in Oasis.
function baseOf(dshUrl) {
  const raw = String(dshUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try { return new URL(raw).origin + '/dsh-pet-7340'; } catch { return ''; }
}

export function createDshPetClient({ dshUrl = '', petId = 'main', log = () => {} } = {}) {
  const base = baseOf(dshUrl);
  let lastState = null;
  async function req(path, { method = 'GET', body = null, timeoutMs = 3500 } = {}) {
    if (!base) return { ok: false, error: 'dsh-pet renderer URL 未知' };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(base + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
      const text = await r.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
      return { ok: r.ok, status: r.status, data };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
    } finally { clearTimeout(timer); }
  }
  async function status() {
    const r = await req('/state');
    if (!r.ok) return { ok: false, error: r.error || 'dsh-pet 不在线' };
    const pets = r.data?.pets && typeof r.data.pets === 'object' ? r.data.pets : {};
    const ids = Object.keys(pets);
    const id = ids.includes(petId) ? petId : (ids[0] || petId);
    const p = pets[id] || {};
    lastState = { petId: id, present: Boolean(pets[id]), position: p.position?.data || null, say: p.say?.data || null, anim: p.anim?.data || null };
    return { ok: true, ...lastState };
  }
  async function move({ x, y, mode = 'line', duration = 1000, surface = 'desktop' } = {}) {
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return { ok: false, error: 'x/y 必须是 0..1 的数字' };
    const px = Math.max(0, Math.min(1, Number(x)));
    const py = Math.max(0, Math.min(1, Number(y)));
    const q = new URLSearchParams({ pet: petId, surface });
    const r = await req('/position?' + q.toString(), { method: 'POST', body: { x: px, y: py, mode, duration } });
    if (!r.ok || r.data?.ok === false) return { ok: false, error: r.data?.message || r.error || 'move failed' };
    return { ok: true, x: px, y: py, mode, duration };
  }
  async function say({ text = '', duration = 8000, surface = 'desktop' } = {}) {
    const s = String(text || '').trim();
    if (!s) return { ok: false, error: 'text 为空' };
    const q = new URLSearchParams({ pet: petId, surface });
    const r = await req('/broadcast?' + q.toString(), { method: 'POST', body: { text: s.slice(0, 500), duration } });
    if (!r.ok || r.data?.ok === false) return { ok: false, error: r.data?.message || r.error || 'say failed' };
    return { ok: true, text: s };
  }
  async function anim({ name = '', surface = 'desktop' } = {}) {
    const q = new URLSearchParams({ pet: petId, surface });
    const r = await req('/anim?' + q.toString(), { method: 'POST', body: name ? { name } : {} });
    if (!r.ok || r.data?.ok === false) return { ok: false, error: r.data?.message || r.error || 'anim failed' };
    return { ok: true, playbackId: r.data?.playbackId || '' };
  }
  async function clearBubble() {
    const q = new URLSearchParams({ pet: petId, surface: 'desktop' });
    return req('/bubble/clear?' + q.toString(), { method: 'POST', body: {} });
  }
  async function setDisplay(display = 'desktop') {
    const r = await req('/pet-display', { method: 'POST', body: { id: petId, display } });
    if (!r.ok || r.data?.ok === false) return { ok: false, error: r.data?.message || r.error || 'display failed' };
    return { ok: true, display };
  }
  return { base, status, move, say, anim, clearBubble, setDisplay, last: () => lastState, available: () => Boolean(base) };
}
