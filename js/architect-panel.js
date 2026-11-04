// The Architect's test panel (only with ?qa=1): bring him in or send him away, give him an order by hand (go somewhere,
// on foot, by car or by helicopter; follow; patrol; stop), hand him the camera, and read his senses' latest events with
// their reproduction links. It stands in for Claude until the brain is plugged in (ARCHITECTE.md, step 2).

const BY = [['auto', 'Auto'], ['foot', 'À pied'], ['car', 'Voiture'], ['heli', 'Hélico']];

class ArchitectPanel {
  constructor(architect) {
    this.architect = architect;
    const places = architect.places.map((p) => `<option value="${p.id}">${p.label.replace(/^l’|^le /, '')}</option>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <section id="architect-panel" class="architect-panel" aria-label="Architecte, panneau de test">
        <header><b>L’ARCHITECTE</b><span>test</span><button data-a="fold" aria-label="Replier">–</button></header>
        <div class="ap-body">
          <p class="ap-state">Absent</p>
          <div class="ap-row"><button data-a="presence">Faire venir</button><button data-a="watch">Lui donner la caméra <kbd>L</kbd></button></div>
          <div class="ap-row"><select data-f="place" aria-label="Destination">${places}</select><select data-f="by" aria-label="Moyen">${BY.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><button data-a="go">Y aller</button></div>
          <div class="ap-row"><button data-a="follow">Suis-moi</button><button data-a="patrol">Patrouille</button><button data-a="stop">Stop</button></div>
          <h3>Capteurs</h3>
          <ol class="ap-events"><li class="ap-empty">Rien à signaler.</li></ol>
        </div>
      </section>`);
    const root = document.getElementById('architect-panel');
    this.root = root;
    this.state = root.querySelector('.ap-state');
    this.list = root.querySelector('.ap-events');
    this.presence = root.querySelector('[data-a="presence"]');
    this.watch = root.querySelector('[data-a="watch"]');
    // clicks here must not reach the game (a shot, the pointer lock)
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'wheel', 'keydown']) root.addEventListener(type, (e) => e.stopPropagation());
    root.addEventListener('click', (e) => this.act(e.target.closest('[data-a]')?.dataset.a, e.target));
    architect.senses.onEvent(() => this.renderEvents());
    this.timer = setInterval(() => this.renderState(), 500);
  }

  act(action, target) {
    const a = this.architect;
    if (!action) return;
    const field = (name) => this.root.querySelector(`[data-f="${name}"]`).value;
    if (action === 'fold') { this.root.classList.toggle('folded'); return; }
    if (action === 'presence') { if (a.present) a.dismiss(); else a.summon(); }
    if (action === 'watch') a.toggleSpectate();
    if (!a.alive && action !== 'presence' && action !== 'watch') return;
    if (action === 'go') a.goToPlace(field('place'), field('by'));
    if (action === 'follow') a.follow();
    if (action === 'patrol') a.patrol();
    if (action === 'stop') a.stop();
    if (action === 'copy') {
      const link = target.dataset.link;
      navigator.clipboard?.writeText(link).then(() => { target.textContent = 'Copié'; }, () => window.prompt('Lien de reproduction', link));
    }
    this.renderState();
  }

  renderState() {
    const a = this.architect, s = a.state();
    this.presence.textContent = a.present ? 'Renvoyer' : 'Faire venir';
    const watch = s.spectating ? 'Reprendre la caméra' : 'Lui donner la caméra';
    if (this.watch.firstChild.textContent.trim() !== watch) this.watch.firstChild.textContent = `${watch} `;
    let text = 'Absent';
    if (s.present && s.respawnIn !== null && !s.alive) text = `Hors service · revient dans ${s.respawnIn} s`;
    else if (s.present && s.alive) text = `${s.mode} · ${s.intent || '—'} · ${s.hp} PV${s.armor ? ` + ${s.armor}` : ''}${s.grudge ? ` · rancune ${s.grudge}` : ''}${s.spectating ? ' · a la caméra' : ''}\n${s.address || ''} (${s.x}, ${s.z})`;
    else if (s.present) text = 'Arrive…';
    text += `\nCerveau : ${a.link?.connected ? 'connecté' : 'hors ligne (npm run architecte)'}`;
    if (this.state.textContent !== text) this.state.textContent = text;
  }

  renderEvents() {
    const events = this.architect.senses.events.slice(-8).reverse();
    this.list.replaceChildren(...(events.length ? events.map((e) => {
      const li = document.createElement('li');
      const time = new Date(e.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      li.innerHTML = '<b></b><span></span><small></small><button data-a="copy">Lien</button>';
      li.querySelector('b').textContent = `${e.title}${e.count > 1 ? ` ×${e.count}` : ''}`;
      li.querySelector('span').textContent = `${e.who ? `${e.who} · ` : ''}${e.address || `${Math.round(e.x)}, ${Math.round(e.z)}`} · ${time}`;
      li.querySelector('small').textContent = e.detail;
      li.querySelector('button').dataset.link = e.link;
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'ap-empty', textContent: 'Rien à signaler.' })]));
  }
}

export { ArchitectPanel };
