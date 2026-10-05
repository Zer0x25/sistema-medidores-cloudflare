const CACHE_NAME = "medidores-shell-v2";
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.css",
  "/app.js",
  "/css/tokens.css",
  "/css/components.css",
  "/js/theme.js",
  "/js/api.js",
  "/js/components.js",
  "/js/sync-manager.js",
  "/icon.svg",
  "/manifest.webmanifest"
];

// Instalación: Precargar shell de la aplicación
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activación: Limpieza de versiones obsoletas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepción de peticiones (Fetch)
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Las llamadas a la API jamás se guardan en cache HTTP del Service Worker
  if (url.pathname.startsWith("/api/")) {
    return; // Dejar pasar directo a la red (la capa SyncManager gestiona el offline de lecturas)
  }

  // 2. Solo interceptar recursos del mismo origen (App Shell y Assets locales)
  if (url.origin !== self.location.origin) {
    return; // Dejar pasar recursos externos (Google Fonts, etc.) para gestión nativa del navegador según CSP
  }

  // 3. Solo interceptar peticiones GET
  if (request.method !== "GET") {
    return;
  }

  // 3. Estrategia Network-First con Fallback a Cache para Shell y Assets
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // Si la respuesta es válida, clonamos y actualizamos el cache
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // Modo offline: devolver desde el cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }
        // Si era una navegación HTML y no hay red, devolver /index.html
        if (request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return new Response("Recurso no disponible fuera de línea", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
  );
});

// 4. Recepción de Notificaciones Web Push (W3C Push API)
self.addEventListener("push", (event) => {
  let data = {
    title: "Alerta del Sistema Medidores",
    body: "Nueva notificación recibida",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: "/",
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "/icon.svg",
    badge: data.badge || "/icon.svg",
    vibrate: [200, 100, 200],
    data: data.data || "/",
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// 5. Interacción con la notificación (apertura / enfoque de ventana)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
