const version = "resound-003";
const assets = [
	"package.html",
	"img/icon.png",
	"img/sphere-down.png",
	"img/sphere-up.png"
];

self.addEventListener("install", (e) => e.waitUntil(install()));
self.addEventListener("activate", (e) => e.waitUntil(activate()));
self.addEventListener("fetch", (e) => e.respondWith(performFetch(e.request)));

// Cache assets on install (no-cors allows external assets to be cached)
async function install() {
	console.log("@install");
	const cache = await caches.open(version);
	await cache.addAll(assets);
}

// Uncache old assets when opened
async function activate() {
	console.log("@activate");
	for (const key of await caches.keys()) {
		if (key !== version) await caches.delete(key);
	}
}

/** @param {Request} request */
async function performFetch(request) {
	console.log("@fetch", request.url);

	let response = await caches.match(request);
	if (response) response;

	// TODO: could also cache these requests?
	return fetch(request);
}