/** Portable project paths, shared by imports, tools, assets and compilers. */
export function projectPath(value: string): string {
  const path = value.replace(/\\/g, '/').trim();
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || Array.from(path).some((c) => c.charCodeAt(0) < 32 || '<>:"|?*'.includes(c))) throw new Error('Use a relative project path, such as assets/photo.png.');
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('Project paths cannot contain empty, . or .. segments.');
  return parts.join('/');
}

export function resolveProjectPath(document: string, reference: string): string {
  const ref = reference.replace(/\\/g, '/');
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(ref)) throw new Error('Expected a relative project reference.');
  const parts = document.split('/').slice(0, -1);
  for (const part of ref.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('Reference leaves the project.');
      parts.pop();
    } else parts.push(part);
  }
  return projectPath(parts.join('/'));
}

export function relativeProjectPath(document: string, target: string): string {
  const from = projectPath(document).split('/').slice(0, -1);
  const to = projectPath(target).split('/');
  while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
  return [...from.map(() => '..'), ...to].join('/');
}
