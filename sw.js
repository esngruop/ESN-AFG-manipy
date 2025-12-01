const CACHE_NAME = 'accounting-app-v1.2.0';
const OFFLINE_URL = './';
const STATIC_CACHE_NAME = 'static-v1.2.0';
const DYNAMIC_CACHE_NAME = 'dynamic-v1.2.0';

const STATIC_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Vazir:wght@300;400;500;600;700&display=swap',
  'https://fonts.gstatic.com/s/vazir/v13/Dxx78j6PP2D_kU2muijPEeVu4Lo.woff2'
];

// Install Event
self.addEventListener('install', event => {
  console.log('[SW] Install Event');
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching offline page');
        return cache.addAll(STATIC_FILES);
      })
      .catch(error => {
        console.error('[SW] Failed to cache static files:', error);
      })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  console.log('[SW] Activate Event');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Claim all clients
      self.clients.claim()
    ])
  );
});

// Fetch Event - Network First Strategy for HTML, Cache First for assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
    return;
  }

  // Handle navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Put in cache
          const responseClone = response.clone();
          caches.open(DYNAMIC_CACHE_NAME)
            .then(cache => cache.put(request, responseClone));
          return response;
        })
        .catch(() => {
          // Return cached version or offline page
          return caches.match(request)
            .then(response => response || caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  // Handle other requests - Cache First Strategy
  event.respondWith(
    caches.match(request)
      .then(response => {
        if (response) {
          // Update cache in background
          fetch(request)
            .then(fetchResponse => {
              const responseClone = fetchResponse.clone();
              caches.open(DYNAMIC_CACHE_NAME)
                .then(cache => cache.put(request, responseClone));
            })
            .catch(() => {});
          return response;
        }

        // Not in cache, fetch from network
        return fetch(request)
          .then(fetchResponse => {
            // Don't cache non-successful responses
            if (!fetchResponse || fetchResponse.status !== 200) {
              return fetchResponse;
            }

            const responseClone = fetchResponse.clone();
            
            // Cache dynamic content
            caches.open(DYNAMIC_CACHE_NAME)
              .then(cache => {
                cache.put(request, responseClone);
              });

            return fetchResponse;
          })
          .catch(() => {
            // Return fallback for images
            if (request.destination === 'image') {
              return new Response(
                '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="200" fill="#ddd"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999">تصویر در دسترس نیست</text></svg>',
                { headers: { 'Content-Type': 'image/svg+xml' } }
              );
            }
          });
      })
  );
});

// Background Sync - for offline transactions
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncOfflineTransactions());
  }
  
  if (event.tag === 'sync-accounts') {
    event.waitUntil(syncOfflineAccounts());
  }
});

async function syncOfflineTransactions() {
  try {
    console.log('[SW] Syncing offline transactions');
    
    // Get offline transactions from IndexedDB
    const offlineTransactions = await getOfflineData('transactions');
    
    if (offlineTransactions && offlineTransactions.length > 0) {
      console.log(`[SW] Found ${offlineTransactions.length} offline transactions`);
      
      for (const transaction of offlineTransactions) {
        try {
          // Process each transaction
          await processOfflineTransaction(transaction);
          // Remove from offline storage
          await removeOfflineData('transactions', transaction.id);
        } catch (error) {
          console.error('[SW] Failed to sync transaction:', error);
        }
      }
      
      // Notify all clients about sync completion
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_COMPLETE',
          data: { type: 'transactions', count: offlineTransactions.length }
        });
      });
    }
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
  }
}

async function syncOfflineAccounts() {
  try {
    console.log('[SW] Syncing offline accounts');
    const offlineAccounts = await getOfflineData('accounts');
    
    if (offlineAccounts && offlineAccounts.length > 0) {
      console.log(`[SW] Found ${offlineAccounts.length} offline accounts`);
      
      for (const account of offlineAccounts) {
        try {
          await processOfflineAccount(account);
          await removeOfflineData('accounts', account.id);
        } catch (error) {
          console.error('[SW] Failed to sync account:', error);
        }
      }
      
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SYNC_COMPLETE',
          data: { type: 'accounts', count: offlineAccounts.length }
        });
      });
    }
  } catch (error) {
    console.error('[SW] Background sync failed:', error);
  }
}

// Push Notifications
self.addEventListener('push', event => {
  console.log('[SW] Push Received.');
  
  let notificationData = {};
  
  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (error) {
      notificationData = { title: event.data.text() };
    }
  }

  const notificationOptions = {
    body: notificationData.body || 'اطلاع‌رسانی جدید از حسابداری من',
    icon: './icons/icon-192x192.png',
    badge: './icons/icon-96x96.png',
    image: notificationData.image,
    data: notificationData.data || { url: './' },
    dir: 'rtl',
    lang: 'fa',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'باز کردن',
        icon: './icons/shortcut-dashboard.png'
      },
      {
        action: 'close',
        title: 'بستن',
        icon: './icons/close.png'
      }
    ],
    tag: notificationData.tag || 'accounting-notification',
    renotify: true,
    timestamp: Date.now()
  };

  event.waitUntil(
    self.registration.showNotification(
      notificationData.title || 'حسابداری من',
      notificationOptions
    )
  );
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification click Received.');
  
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data?.url || './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Check if there's already a window open
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(urlToOpen);
            return client.focus();
          }
        }
        // If no window is open, open new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Message Handler - for communication with main thread
self.addEventListener('message', event => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  
  if (event.data && event.data.type === 'SAVE_OFFLINE_DATA') {
    saveOfflineData(event.data.dataType, event.data.data)
      .then(() => {
        event.ports[0].postMessage({ success: true });
      })
      .catch(error => {
        event.ports[0].postMessage({ success: false, error: error.message });
      });
  }
});

// Helper functions for IndexedDB operations
async function getOfflineData(type) {
  // In a real implementation, you would use IndexedDB
  // For now, we'll just return empty array
  return [];
}

async function removeOfflineData(type, id) {
  // Implementation for removing data from IndexedDB
  console.log(`[SW] Removing ${type} with id: ${id}`);
}

async function saveOfflineData(type, data) {
  // Implementation for saving data to IndexedDB
  console.log(`[SW] Saving ${type}:`, data);
}

async function processOfflineTransaction(transaction) {
  // Implementation for processing offline transaction
  console.log('[SW] Processing offline transaction:', transaction);
}

async function processOfflineAccount(account) {
  // Implementation for processing offline account
  console.log('[SW] Processing offline account:', account);
}

// Periodic Background Sync (if supported)
self.addEventListener('periodicsync', event => {
  console.log('[SW] Periodic sync:', event.tag);
  
  if (event.tag === 'data-backup') {
    event.waitUntil(performPeriodicBackup());
  }
});

async function performPeriodicBackup() {
  console.log('[SW] Performing periodic backup');
  // Implementation for automatic data backup
}

// Share Target Handler
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Handle share target
  if (url.searchParams.has('title') || url.searchParams.has('text')) {
    event.respondWith(
      fetch('./').then(response => {
        // Handle shared content
        const title = url.searchParams.get('title') || '';
        const text = url.searchParams.get('text') || '';
        
        // Store shared data for main app
        caches.open('shared-data').then(cache => {
          cache.put('shared-content', new Response(JSON.stringify({ title, text })));
        });
        
        return response;
      })
    );
  }
});