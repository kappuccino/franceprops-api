import './app/db.js'

// One code, one image, two Coolify apps: MODE=api (default) serves http,
// MODE=worker processes the import queues
if(process.env.MODE === 'worker') await import('./app/worker.js')
else await import('./app/server.js')
