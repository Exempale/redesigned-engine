const cluster = require('cluster');
const os = require('os');

if (cluster.isMaster) {
    const numWorkers = Math.min(os.cpus().length, 8); // Use 8 cores max
    
    console.log(`🚀 Starting ${numWorkers} workers`);
    
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        console.log(`Worker ${worker.process.pid} died, restarting...`);
        cluster.fork();
    });
} else {
    require('./server.js'); // Your existing server
}