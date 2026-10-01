/**
 * Account widget and edit link, for pages served by ursa-server.
 *
 * A static Ursa site has no one to sign in to, so the profile button and the
 * edit link stay hidden and nothing here makes a request. A server that signs
 * people in announces itself by putting a JSON block in the page:
 *
 *   <script type="application/json" id="ursa-server">
 *     {"auth": "/auth", "edit": "/edit/", "profile": "/auth/profile"}
 *   </script>
 *
 * Then the profile button appears, and the panel asks `<auth>/me` who is
 * signed in: { signedIn, name, email, roles }. Signed out, it offers to sign
 * in; signed in, it shows who, links to the profile page and signs out. An
 * editor (or admin) also gets the edit link in the topbar, pointing at
 * `<edit>?page=<this page's path>`.
 *
 * A server with an editor but no sign-in (local use) sends only `edit`: the
 * edit link shows and the account button doesn't.
 *
 * Runs before widgets.js, so the button is visible by the time the widget
 * manager decides which panels to restore.
 */
(function () {
  var configEl = document.getElementById('ursa-server');
  if (!configEl) return;
  var config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch (e) {
    return;
  }
  if (!config) return;

  var button = document.querySelector('.ursa-button[data-widget="profile"]');
  var panel = document.querySelector('.ursa-panel[data-widget="profile"] .ursa-profile');
  var editLink = document.querySelector('.ursa-edit-link');

  if (!config.auth) {
    if (config.edit && editLink) {
      editLink.href = editHref();
      editLink.hidden = false;
    }
    return;
  }
  if (button) button.hidden = false;

  var here = location.pathname + location.search + location.hash;
  var auth = config.auth.replace(/\/$/, '');

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function render(me) {
    if (!panel) return;
    panel.textContent = '';
    if (!me || !me.signedIn) {
      panel.dataset.state = 'signed-out';
      panel.append(
        el('span', { class: 'ursa-profile-avatar', 'aria-hidden': 'true' }, '👤'),
        el('p', null, 'Not signed in'),
        el('a', { class: 'ursa-profile-action', href: auth + '/login?returnTo=' + encodeURIComponent(here) }, 'Sign in')
      );
      return;
    }
    panel.dataset.state = 'signed-in';
    var roles = me.roles || [];
    var role = roles[roles.length - 1];
    var initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    var actions = el('ul', { class: 'ursa-profile-actions' });
    if (canEdit(me) && config.edit) {
      actions.append(li(el('a', { href: editHref() }, 'Edit this page')));
    }
    if (config.profile) actions.append(li(el('a', { href: config.profile }, 'Profile')));
    actions.append(li(el('a', { href: auth + '/logout' }, 'Sign out')));
    panel.append(
      el('span', { class: 'ursa-profile-avatar', 'aria-hidden': 'true' }, initial),
      el('p', { class: 'ursa-profile-name' }, me.name || me.email),
      me.email && me.email !== me.name ? el('p', { class: 'ursa-profile-email' }, me.email) : '',
      role ? el('p', { class: 'ursa-profile-role' }, role) : '',
      actions
    );
  }

  function li(child) {
    var item = el('li');
    item.append(child);
    return item;
  }

  function canEdit(me) {
    var roles = me.roles || [];
    return roles.indexOf('editor') >= 0 || roles.indexOf('admin') >= 0;
  }

  function editHref() {
    var sep = config.edit.indexOf('?') >= 0 ? '&' : '?';
    return config.edit + sep + 'page=' + encodeURIComponent(location.pathname);
  }

  fetch(auth + '/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      render(me);
      if (me && me.signedIn && canEdit(me) && config.edit && editLink) {
        editLink.href = editHref();
        editLink.hidden = false;
      }
    })
    .catch(function () { render(null); });
})();
