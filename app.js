const app = document.querySelector("#app");
const assetCount = document.querySelector("#asset-count");
const state = { files: [], tree: null, search: "" };
const assetBase = new URL("pages/", document.baseURI);
const manifestUrl = new URL("manifest.json", document.baseURI);

if (location.pathname === "/index.html") {
  history.replaceState({}, "", `/${location.search}`);
}

const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const visibleName = (path) => path.split("/").at(-1).replace(/\.png$/i, "");
const labelFor = (name) => name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const route = (kind, path = "") => path ? `?${kind}=${encodeURI(path)}` : "./";
const imageUrl = (path) => new URL(path.split("/").map(encodeURIComponent).join("/"), assetBase).href;

function createTree(files) {
  const root = { name: "", path: "", folders: new Map(), files: [] };
  files.forEach((filePath) => {
    const parts = filePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    let node = root;
    parts.forEach((part) => {
      if (!node.folders.has(part)) node.folders.set(part, { name: part, path: node.path ? `${node.path}/${part}` : part, folders: new Map(), files: [] });
      node = node.folders.get(part);
    });
    node.files.push({ name: fileName, path: filePath });
  });
  return root;
}

function findNode(path) {
  let node = state.tree;
  path.split("/").filter(Boolean).forEach((part) => { node = node?.folders.get(part); });
  return node;
}

function descendantFiles(node) {
  return node ? [...node.files, ...[...node.folders.values()].flatMap(descendantFiles)] : [];
}

function sortedFolders(node) { return [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)); }
function sortedFiles(files) { return [...files].sort((a, b) => a.name.localeCompare(b.name)); }

function fileRow(file) {
  return `<article class="file-row"><a class="file-link" href="${route("file", file.path)}"><span class="file-name">${escapeHtml(visibleName(file.path))}</span></a><span class="file-meta">${escapeHtml(file.path.split("/").slice(0, -1).join("/") || "root")}</span></article>`;
}

function folderCard(folder) {
  const count = descendantFiles(folder).length;
  return `<a class="folder-card" href="${route("folder", folder.path)}"><span class="folder-icon" aria-hidden="true">↳</span><span><strong>${escapeHtml(labelFor(folder.name))}</strong><small>${count} ${count === 1 ? "page" : "pages"}</small></span></a>`;
}

function breadcrumbs(path) {
  let current = "";
  const items = [`<a href="./">All pages</a>`];
  path.split("/").filter(Boolean).forEach((part) => {
    current = current ? `${current}/${part}` : part;
    items.push(`<span class="crumb-separator">/</span><a href="${route("folder", current)}">${escapeHtml(labelFor(part))}</a>`);
  });
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${items.join("")}</nav>`;
}

function searchBar(value, placeholder) {
  return `<label class="search-wrap"><span class="sr-only">Search pages</span><input class="search-input" data-search type="search" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>`;
}

function sectionHeading(title, count) { return `<div class="section-heading"><h2>${escapeHtml(title)}</h2><span>${count} ${count === 1 ? "entry" : "entries"}</span></div>`; }

function matchesSearch(value, query) { return !query || value.toLowerCase().startsWith(query); }

function renderRoot() {
  const query = state.search.trim().toLowerCase();
  const folders = sortedFolders(state.tree).filter((folder) => matchesSearch(folder.name, query));
  const files = sortedFiles(state.files.filter((file) => matchesSearch(visibleName(file.path), query)));
  app.innerHTML = `<div class="toolbar">${searchBar(state.search, "Search every page...")}</div>${folders.length ? `${sectionHeading(query ? "Matching folders" : "Folders", folders.length)}<div class="folder-grid">${folders.map(folderCard).join("")}</div>` : ""}${sectionHeading(query ? "Matching pages" : "All pages", files.length)}${files.length ? `<div class="file-list">${files.map(fileRow).join("")}</div>` : `<div class="empty-state"><strong>No pages found</strong><span>Try a different name or folder.</span></div>`}`;
}

function renderFolder(path) {
  const node = findNode(path);
  if (!node) return renderError("That folder is no longer in the library.");
  const query = state.search.trim().toLowerCase();
  const folders = sortedFolders(node).filter((folder) => matchesSearch(folder.name, query));
  const files = sortedFiles(descendantFiles(node).filter((file) => matchesSearch(visibleName(file.path), query)));
  const parent = path.includes("/") ? route("folder", path.split("/").slice(0, -1).join("/")) : "./";
  app.innerHTML = `<a class="back-link" href="${parent}"><span class="back-arrow" aria-hidden="true">←</span> Back</a>${breadcrumbs(path)}<div class="toolbar">${searchBar(state.search, `Search in ${labelFor(node.name)}...`)}</div>${folders.length ? `${sectionHeading("Folders", folders.length)}<div class="folder-grid">${folders.map(folderCard).join("")}</div>` : ""}${sectionHeading(query ? "Matching pages" : "Pages in this folder", files.length)}${files.length ? `<div class="file-list">${files.map(fileRow).join("")}</div>` : `<div class="empty-state"><strong>No pages found</strong><span>This folder has no matching pages.</span></div>`}`;
}

function renderFile(path) {
  const file = state.files.find((item) => item.path === path);
  if (!file) return renderError("That page is no longer in the library.");
  const parent = path.split("/").slice(0, -1).join("/");
  app.innerHTML = `<div class="viewer-shell"><a class="back-link" href="${parent ? route("folder", parent) : "./"}"><span class="back-arrow" aria-hidden="true">←</span> Back to ${escapeHtml(parent ? labelFor(parent.split("/").at(-1)) : "all pages")}</a><div class="viewer-heading"><div><h1>${escapeHtml(visibleName(path))}</h1><p>${escapeHtml(path)}</p></div></div><div class="viewer-frame"><img src="${imageUrl(path)}" alt="${escapeHtml(visibleName(path))}" loading="eager"></div></div>`;
}

function renderError(message) { app.innerHTML = `<div class="error-state"><strong>Unable to open this view</strong><span>${escapeHtml(message)}</span></div>`; }

function readRoute() {
  const params = new URLSearchParams(location.search);
  if (params.has("file")) return { kind: "file", path: params.get("file") || "" };
  if (params.has("folder")) return { kind: "folder", path: params.get("folder") || "" };
  return { kind: "root", path: "" };
}

function render() {
  if (!state.tree) return;
  const current = readRoute();
  if (current.kind === "file") return renderFile(current.path);
  if (current.kind === "folder") return renderFolder(current.path);
  renderRoot();
}

function setSearch(value) {
  state.search = value;
  render();
  const input = document.querySelector("[data-search]");
  if (input) { input.focus(); input.setSelectionRange(value.length, value.length); }
}

app.addEventListener("input", (event) => { if (event.target.matches("[data-search]")) setSearch(event.target.value); });
app.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;

  event.preventDefault();
  history.pushState({}, "", url.pathname + url.search);
  render();
});
window.addEventListener("popstate", render);
document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement.tagName !== "INPUT") { event.preventDefault(); document.querySelector("[data-search]")?.focus(); } });

function loadManifest() {
  return fetch(manifestUrl).then((response) => {
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    return response.json().then((manifest) => manifest.files || []);
  });
}

loadManifest()
  .then((files) => {
    const paths = [...new Set(files)].filter((path) => /\.png$/i.test(path));
    state.files = paths.map((path) => ({ name: path.split("/").at(-1), path }));
    state.tree = createTree(paths);
    assetCount.textContent = `${state.files.length} pages indexed`;
    render();
  })
  .catch((error) => { assetCount.textContent = "Library unavailable"; renderError(`The page index could not be loaded: ${error.message}`); console.error(error); });
