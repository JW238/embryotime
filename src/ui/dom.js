// Small DOM helpers. `html` is a tagged template that escapes every interpolated
// value unless it is already Html (from another `html` call or `raw`).

class Html {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export const raw = (s) => new Html(String(s));

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += part(v) + strings[i + 1];
  });
  return new Html(out);
}

/** Replace the contents of `parent` with a fresh element so old listeners are dropped. */
export function mount(parent, content) {
  const root = document.createElement('div');
  root.className = 'view';
  root.innerHTML = String(content);
  parent.replaceChildren(root);
  return root;
}

export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(message, kind = 'info') {
  const region = document.getElementById('toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  region.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 5000);
}
