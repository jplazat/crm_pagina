// Service worker de la página publicada del CRM. Es corto a propósito y solo hace tres cosas:
//   1. Guarda en caché los archivos propios de la página (la página, el manifiesto y los iconos) y nada más.
//   2. Para esos archivos va primero a la red y, si la red falla, usa la caché: una versión nueva publicada se ve en cuanto hay
//      red, y sin red la página sigue abriendo (con la última copia de los datos que el propio navegador guardó).
//   3. No toca NUNCA lo demás: ni las peticiones a otros orígenes (api.github.com, raw.githubusercontent.com...), que son las de
//      los datos y la clave, ni las que no son GET, ni ningún archivo que no esté en la lista de abajo.
// La constante VERSION (abajo) lleva una marca que herramientas\construir_pagina.py sustituye por la fecha y hora de la
// construcción: cada publicación estrena su caché y, al activarse, se borran las de versiones anteriores (solo las de este
// service worker: lo distingue el prefijo).
'use strict';

const VERSION = '20261017-142412';
const PREFIJO = 'crm-pagina-';
const CACHE = PREFIJO + VERSION;
const ARCHIVOS = ['./', './index.html', './manifest.webmanifest', './CRM.ico', './CRM-192.png', './CRM-512.png', './CRM-180.png'];
const PAGINA = ['./', './index.html'];                // la misma página con dos direcciones: se guardan siempre juntas

const direccion = (ruta) => new URL(ruta, self.registration.scope).href;
const CLAVES = ARCHIVOS.map(direccion);
const CLAVES_PAGINA = PAGINA.map(direccion);

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // 'reload': que no salgan de la caché HTTP del navegador (GitHub Pages las da por buenas diez minutos)
      .then((cache) => cache.addAll(ARCHIVOS.map((a) => new Request(direccion(a), { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(
        nombres.filter((n) => n.startsWith(PREFIJO) && n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

async function guardar(clave, respuesta) {
  const cache = await caches.open(CACHE);
  const claves = CLAVES_PAGINA.includes(clave) ? CLAVES_PAGINA : [clave];
  await Promise.all(claves.map((c) => cache.put(c, respuesta.clone())));
}

// Primero la red; si falla (sin conexión) o no contesta bien, lo último que se guardó.
async function primeroLaRed(evento, clave) {
  let respuesta = null;
  try {
    // 'no-cache': que pregunte al servidor aunque la caché HTTP crea que lo que tiene aún vale
    respuesta = await fetch(evento.request, { cache: 'no-cache' });
    if (respuesta.ok) {
      if (!respuesta.redirected) evento.waitUntil(guardar(clave, respuesta.clone()));
      return respuesta;
    }
  } catch (error) {
    // sin red: se usa la caché
  }
  const guardada = await (await caches.open(CACHE)).match(clave);
  return guardada || respuesta || Response.error();
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;                                                // nunca POST, PUT, DELETE...
  if (peticion.cache === 'only-if-cached' && peticion.mode !== 'same-origin') return;  // (da error con las herramientas del navegador abiertas)
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;                                      // ni api.github.com ni ningún otro origen
  url.search = '';
  url.hash = '';
  if (!CLAVES.includes(url.href)) return;                                               // solo la página y sus archivos
  evento.respondWith(primeroLaRed(evento, url.href));
});
